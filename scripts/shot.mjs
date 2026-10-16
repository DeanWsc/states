#!/usr/bin/env node
// Screenshots with headless Chrome.
//
//   node scripts/shot.mjs page.html --out shots/
//   node scripts/shot.mjs page.html --theme dark --width 390
//   node scripts/shot.mjs page.html --states hover,focus,disabled
//
// This exists because the audit in kit/audit.mjs is static. It reads the markup
// and the stylesheet; it does not lay anything out. Everything that only shows
// up once a browser has run — text that wraps into three lines, a grid that
// refuses to collapse, a focus ring clipped by an overflow: hidden — needs a
// real render. Take the shots, then look at them.
//
// Degrades honestly: if no Chrome is found, it says so and exits 0, because a
// missing browser is not a reason to fail someone's build.

import { mkdirSync, existsSync, readdirSync, writeFileSync, mkdtempSync } from "node:fs";
import { execFileSync, spawnSync, spawn } from "node:child_process";
import { dirname, join, resolve } from "node:path";
import { tmpdir } from "node:os";

/** Where Chrome usually lives on each platform. */
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

/** Find a usable Chrome, or return null. */
export function findChrome() {
  for (const p of CHROME_PATHS) if (existsSync(p)) return p;
  // A single-letter executable may be on PATH.
  for (const name of ["google-chrome", "chromium", "chrome"]) {
    const r = spawnSync(process.platform === "win32" ? "where" : "which", [name]);
    if (r.status === 0) {
      const line = String(r.stdout).split("\n")[0].trim();
      if (line && existsSync(line)) return line;
    }
  }
  return null;
}

/**
 * Screenshot a page at one size, through the DevTools protocol.
 *
 * `--window-size` cannot be used for the narrow shots. A desktop Chrome refuses
 * a window narrower than 500px and silently renders at 500, so a page that
 * overflows badly at 390 screenshots perfectly and the PNG looks like evidence
 * of a bug that is not there. Page.captureScreenshot with
 * Emulation.setDeviceMetricsOverride is the only way to get a true 390px
 * viewport, and it is the same mechanism scripts/measure.mjs uses, so the two
 * agree about what the page actually does.
 */
export async function shot(chrome, { file, url, width, height, theme = null, scale = 2, port }) {
  const out = resolve(file);
  mkdirSync(dirname(out), { recursive: true });

  const child = spawn(chrome, [
    "--headless=new",
    "--disable-gpu",
    "--hide-scrollbars",
    "--no-sandbox",
    `--remote-debugging-port=${port}`,
    `--user-data-dir=${mkdtempSync(join(tmpdir(), "states-shot-"))}`,
    "about:blank",
  ], { stdio: ["ignore", "ignore", "ignore"] });

  try {
    // Wait for the debugging endpoint.
    let version = null;
    for (let i = 0; i < 100 && !version; i++) {
      try {
        const res = await fetch(`http://127.0.0.1:${port}/json/version`);
        if (res.ok) version = await res.json();
      } catch {
        await new Promise((r) => setTimeout(r, 100));
      }
    }
    if (!version) throw new Error("chrome did not expose a debugging port");

    const targetRes = await fetch(
      `http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`,
      { method: "PUT" },
    );
    const target = await targetRes.json();

    const socket = new WebSocket(target.webSocketDebuggerUrl);
    await new Promise((res, rej) => {
      socket.addEventListener("open", res, { once: true });
      socket.addEventListener("error", () => rej(new Error("websocket failed")), { once: true });
    });

    let nextId = 1;
    const pending = new Map();
    socket.addEventListener("message", (event) => {
      const msg = JSON.parse(event.data);
      if (msg.id && pending.has(msg.id)) {
        const { resolve: ok, reject: no } = pending.get(msg.id);
        pending.delete(msg.id);
        if (msg.error) no(new Error(msg.error.message));
        else ok(msg);
      }
    });
    const send = (method, params = {}, sessionId) =>
      new Promise((res, rej) => {
        const id = nextId++;
        pending.set(id, { resolve: res, reject: rej });
        socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
      });

    const { result: session } = await send("Target.attachToTarget", { targetId: target.id, flatten: true });
    const sessionId = session.sessionId;

    // This is the line that makes a 390px screenshot真 390px.
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height,
      deviceScaleFactor: scale,
      mobile: width < 768,
    }, sessionId);
    await send("Page.enable", {}, sessionId);
    await send("Page.navigate", { url }, sessionId);
    await new Promise((r) => setTimeout(r, 700));

    // Full page, so a long card is not cut off at the fold.
    const metrics = await send("Page.getLayoutMetrics", {}, sessionId);
    const content = metrics.result?.contentSize || { width, height };
    await send("Emulation.setDeviceMetricsOverride", {
      width,
      height: Math.min(Math.ceil(content.height), 20000),
      deviceScaleFactor: scale,
      mobile: width < 768,
    }, sessionId);

    const shotResult = await send("Page.captureScreenshot", {
      format: "png",
      captureBeyondViewport: true,
    }, sessionId);

    const data = shotResult.result?.data;
    if (!data) throw new Error("chrome returned no image");
    writeFileSync(out, Buffer.from(data, "base64"));
    socket.close();
    return { ok: true, out };
  } finally {
    child.kill();
  }
}

/**
 * Capture the set of shots worth looking at for any interface: desktop, phone,
 * and the narrowest phone anyone ships on.
 *
 * 320 is in the list on purpose. It is the width at which a missing
 * `flex-wrap`, a table that did not collapse, or a padding that did not shrink
 * finally shows itself.
 */
export async function shootAll({ file, outDir, theme = null, scale = 2 }) {
  const chrome = findChrome();
  if (!chrome) return { ok: false, reason: "no-chrome" };

  mkdirSync(outDir, { recursive: true });
  const url = `file://${resolve(file)}`;
  const slug = file.split("/").pop().replace(/\.html$/, "");
  const suffix = theme ? `-${theme}` : "";

  const shots = [
    { name: `${slug}${suffix}-desktop.png`, width: 1280, height: 900 },
    { name: `${slug}${suffix}-phone.png`, width: 390, height: 844 },
    { name: `${slug}${suffix}-narrow-320.png`, width: 320, height: 720 },
  ];

  const results = [];
  for (const [i, s] of shots.entries()) {
    try {
      // A distinct port per shot: the previous Chrome may still be shutting down.
      const port = 9100 + (process.pid % 500) * 4 + i;
      results.push(await shot(chrome, { file: join(outDir, s.name), url, width: s.width, height: s.height, theme, scale, port }));
    } catch (err) {
      results.push({ ok: false, out: join(outDir, s.name), error: err.message });
    }
  }

  return { ok: results.every((r) => r.ok), results, outDir, chrome };
}

// ------------------------------------------------------------------- the CLI

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        args[key] = next;
        i++;
      } else args[key] = true;
    } else args._.push(a);
  }

  if (!args._.length || args.help) {
    process.stdout.write(`Usage: node scripts/shot.mjs <file.html> [options]

Options:
  --out <dir>      Directory for the PNGs (default: shots/)
  --theme <name>   Note a theme in the filename
  --scale <n>      Device pixel ratio (default: 2)

Captures desktop (1280), phone (390) and a narrow 320 view, each at a true
emulated viewport rather than a window size Chrome would clamp. Exits 0 when no
Chrome is available, so it never blocks a build for want of a browser.
`);
    process.exit(0);
  }

  const result = await shootAll({
    file: args._[0],
    outDir: args.out || "shots",
    theme: args.theme || null,
    scale: args.scale ? Number(args.scale) : 2,
  });

  if (!result.ok && result.reason === "no-chrome") {
    process.stdout.write("shot: no Chrome or Chromium found; skipping screenshots\n");
    process.exit(0);
  }
  for (const r of result.results) {
    process.stdout.write(`${r.ok ? "ok  " : "FAIL"} ${r.out}${r.ok ? "" : `: ${r.error}`}\n`);
  }
  process.exit(result.ok ? 0 : 1);
}
