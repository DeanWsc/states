// Headless Chrome over the DevTools protocol, with nothing to install.
//
// The renderer and the checker both need the same thing: a page at an exact
// pixel size, a way to run code in it and wait for the answer, and a way to
// photograph it. Node 22 has fetch and WebSocket built in, so that is all this
// file uses.

import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { join } from "node:path";
import { tmpdir } from "node:os";

const CHROME_PATHS = [
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/Applications/Microsoft Edge.app/Contents/MacOS/Microsoft Edge",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
  "/usr/bin/chromium-browser",
  "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe",
  "C:\\Program Files (x86)\\Google\\Chrome\\Application\\chrome.exe",
];

/** A usable Chrome or Chromium, or null. CHROME_PATH wins when it is set. */
export function findChrome(env = process.env) {
  if (env.CHROME_PATH && existsSync(env.CHROME_PATH)) return env.CHROME_PATH;
  for (const p of CHROME_PATHS) if (existsSync(p)) return p;
  // Playwright's bundled Chromium, where a machine has it and nothing else.
  for (const root of [env.PLAYWRIGHT_BROWSERS_PATH, "/opt/pw-browsers", join(env.HOME ?? "", ".cache/ms-playwright")]) {
    if (!root || !existsSync(root)) continue;
    for (const dir of readdirSync(root).filter((d) => /^chromium-\d+$/.test(d)).sort().reverse()) {
      for (const sub of ["chrome-linux64/chrome", "chrome-linux/chrome"]) {
        const p = join(root, dir, sub);
        if (existsSync(p)) return p;
      }
    }
  }
  for (const name of ["google-chrome", "chromium", "chrome"]) {
    const r = spawnSync(process.platform === "win32" ? "where" : "which", [name]);
    if (r.status === 0) {
      const line = String(r.stdout).split("\n")[0].trim();
      if (line && existsSync(line)) return line;
    }
  }
  return null;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/**
 * Open `url` in a fresh headless Chrome at exactly width × height CSS pixels.
 * `init` is source code that runs before any of the page's own scripts.
 * Returns { send, evaluate, screenshot, close }.
 */
export async function openPage({ url, width, height, init = "", chrome = findChrome() }) {
  if (!chrome) throw Object.assign(new Error("no Chrome or Chromium found (set CHROME_PATH)"), { code: "NO_CHROME" });
  const profile = mkdtempSync(join(tmpdir(), "reel-chrome-"));
  const child = spawn(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--mute-audio",
    "--no-sandbox",
    "--no-first-run",
    "--font-render-hinting=none",
    "--force-color-profile=srgb",
    "--disable-background-timer-throttling",
    "--disable-renderer-backgrounding",
    "--remote-debugging-port=0",
    `--user-data-dir=${profile}`,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "ignore"] });

  const close = () => {
    try { socket?.close(); } catch {}
    child.kill();
    try { rmSync(profile, { recursive: true, force: true }); } catch {}
  };

  let socket;
  try {
    // Port 0 lets Chrome pick a free port and write it to DevToolsActivePort,
    // so two renders (or two workers in one render) can never share a browser.
    let port = null;
    for (let i = 0; i < 150 && !port; i++) {
      try {
        port = Number(readFileSync(join(profile, "DevToolsActivePort"), "utf8").split("\n")[0]) || null;
      } catch {}
      if (!port) await sleep(100);
    }
    if (!port) throw new Error("Chrome did not open a debugging port");

    let target = null;
    for (let i = 0; i < 50 && !target; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/new?about:blank`, { method: "PUT" });
        if (res.ok) target = await res.json();
      } catch {
        await sleep(100);
      }
    }
    if (!target) throw new Error("Chrome did not open a debugging port");

    socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((ok, no) => {
      socket.addEventListener("open", ok, { once: true });
      socket.addEventListener("error", () => no(new Error("DevTools websocket failed")), { once: true });
    });

    let nextId = 1;
    const pending = new Map();
    const waiters = [];
    const errors = [];
    socket.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { ok, no } = pending.get(msg.id);
        pending.delete(msg.id);
        msg.error ? no(new Error(msg.error.message)) : ok(msg.result ?? {});
      } else if (msg.method) {
        if (msg.method === "Runtime.exceptionThrown") errors.push(msg.params.exceptionDetails);
        for (const w of waiters.splice(0)) (w.method === msg.method ? w.ok(msg.params) : waiters.push(w));
      }
    });
    const send = (method, params = {}) =>
      new Promise((ok, no) => {
        const id = nextId++;
        pending.set(id, { ok, no });
        socket.send(JSON.stringify({ id, method, params }));
      });
    const once = (method, ms = 15000) =>
      new Promise((ok, no) => {
        waiters.push({ method, ok });
        setTimeout(() => no(new Error(`timed out waiting for ${method}`)), ms);
      });

    await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    await send("Page.enable");
    await send("Runtime.enable");
    if (init) await send("Page.addScriptToEvaluateOnNewDocument", { source: init });
    const loaded = once("Page.loadEventFired", 30000);
    await send("Page.navigate", { url });
    await loaded;

    /** Run an expression in the page and return its value, awaiting promises. */
    const evaluate = async (expression) => {
      const r = await send("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
      if (r.exceptionDetails) {
        const d = r.exceptionDetails;
        throw new Error(d.exception?.description ?? d.text ?? "page threw");
      }
      return r.result?.value;
    };

    /** Change the viewport, for when the page itself says how big it is. */
    const resize = async (w, h) => {
      width = w; height = h;
      await send("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile: false });
    };

    /** A PNG of the viewport, as a Buffer. */
    const screenshot = async () => {
      const r = await send("Page.captureScreenshot", {
        format: "png",
        clip: { x: 0, y: 0, width, height, scale: 1 },
        captureBeyondViewport: false,
        optimizeForSpeed: true,
      });
      return Buffer.from(r.data, "base64");
    };

    return { send, evaluate, screenshot, resize, close, errors };
  } catch (err) {
    close();
    throw err;
  }
}
