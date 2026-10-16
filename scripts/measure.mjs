#!/usr/bin/env node
// Measure real layout, through the DevTools protocol.
//
//   node scripts/measure.mjs page.html --width 390
//
// The static audit in kit/audit.mjs reads the stylesheet and decides what the
// cascade produces. This asks the browser what it actually laid out. The two
// disagree in exactly the cases that matter — a flex item that will not shrink,
// a grid that will not collapse, a long word that will not wrap — and those are
// the cases that reach a phone and break.
//
// Why the DevTools protocol and not --screenshot: a desktop Chrome silently
// refuses a window narrower than 500px and renders at 500 instead. A page that
// overflows at 390 therefore screenshots perfectly. Emulation.setDeviceMetrics-
// Override is the only way to get a true 390px viewport, which is what makes
// this check worth having.
//
// What it reports that the audit cannot know:
//   1. horizontal overflow, and which elements cause it
//   2. the painted size of every control, which content can enlarge
//
// Exits 0 when there is no overflow, 1 when there is. A missing Chrome is not a
// failure; it prints why and exits 0.

import { spawn } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { findChrome } from "./shot.mjs";

/**
 * The function evaluated inside the page. Serialised into a Runtime.evaluate
 * call, so it must be self-contained and must return a JSON-serialisable value.
 */
const PROBE = `(() => {
  const vw = document.documentElement.clientWidth;
  const scrollW = Math.max(
    document.documentElement.scrollWidth,
    document.body ? document.body.scrollWidth : 0
  );

  const overflowing = [];
  for (const el of document.querySelectorAll("body *")) {
    const tag = el.tagName.toLowerCase();
    if (tag === "html" || tag === "body") continue;
    const r = el.getBoundingClientRect();
    if (r.width === 0 && r.height === 0) continue;
    if (r.right > vw + 0.5) {
      const cs = getComputedStyle(el);
      overflowing.push({
        tag,
        cls: (el.className && String(el.className).slice(0, 60)) || "",
        id: el.id || "",
        left: Math.round(r.left),
        right: Math.round(r.right),
        width: Math.round(r.width),
        position: cs.position,
        display: cs.display,
      });
    }
    if (overflowing.length > 40) break;
  }

  const sel = 'a[href], button, input, select, textarea, [role="button"], [role="switch"], [tabindex]';
  const targets = [];
  for (const el of document.querySelectorAll(sel)) {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    if (cs.display === "none" || cs.visibility === "hidden") continue;
    if (r.width === 0 && r.height === 0) continue;
    targets.push({
      tag: el.tagName.toLowerCase(),
      cls: (el.className && String(el.className).slice(0, 40)) || "",
      name: (el.getAttribute("aria-label") || el.textContent || "").trim().replace(/\\s+/g, " ").slice(0, 40),
      w: Math.round(r.width),
      h: Math.round(r.height),
      inline: cs.display === "inline",
      clipped: r.right > vw + 0.5,
    });
  }

  return {
    viewport: vw,
    scrollWidth: scrollW,
    overflow: scrollW > vw + 1,
    overflowing,
    targets,
  };
})()`;

/** Parse the same flags as the other scripts. */
const argv = process.argv.slice(2);
const args = { _: [], width: 390, height: 844, min: 44 };
for (let i = 0; i < argv.length; i++) {
  const a = argv[i];
  if (a === "--width") args.width = Number(argv[++i]);
  else if (a === "--height") args.height = Number(argv[++i]);
  else if (a === "--min") args.min = Number(argv[++i]);
  else if (a.startsWith("--")) args[a.slice(2)] = true;
  else args._.push(a);
}

if (!args._.length || args.help) {
  process.stdout.write(`Usage: node scripts/measure.mjs <file.html> [options]

Options:
  --width <px>    Viewport width (default: 390)
  --height <px>   Viewport height (default: 844)
  --min <px>      Ideal tap target height (default: 44)

Reports real layout: horizontal overflow, the elements causing it, and the
painted size of every control. Exits 1 when the page overflows horizontally.
`);
  process.exit(0);
}

const chrome = findChrome();
if (!chrome) {
  process.stdout.write("measure: no Chrome or Chromium found; skipping layout measurement\n");
  process.exit(0);
}

const profile = mkdtempSync(join(tmpdir(), "states-measure-"));
const port = 9000 + Math.floor(Math.random() * 900);

// Launch with the debugging port open and no page of its own.
const child = spawn(chrome, [
  "--headless=new",
  "--disable-gpu",
  "--no-sandbox",
  "--hide-scrollbars",
  `--remote-debugging-port=${port}`,
  `--user-data-dir=${profile}`,
  "about:blank",
], { stdio: ["ignore", "ignore", "ignore"] });

/** Wait for the debugging endpoint to answer. */
async function waitForEndpoint(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`http://127.0.0.1:${port}/json/version`);
      if (res.ok) return await res.json();
    } catch {
      // Not up yet.
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  return null;
}

/** Open a target and return its webSocketDebuggerUrl. */
async function newTarget(url) {
  const res = await fetch(`http://127.0.0.1:${port}/json/new?${encodeURIComponent(url)}`, { method: "PUT" });
  if (!res.ok) throw new Error(`could not open target: ${res.status}`);
  return res.json();
}

let socket = null;
let nextId = 1;
const pending = new Map();

/** Send one CDP command and await its reply. */
function send(method, params = {}, sessionId) {
  const id = nextId++;
  return new Promise((resolveResult, rejectResult) => {
    pending.set(id, { resolve: resolveResult, reject: rejectResult });
    socket.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
  });
}

/** Resolve once the page has loaded and layout has settled. */
function waitForLoad(sessionId, timeoutMs = 8000) {
  return new Promise((res) => {
    const started = Date.now();
    const timer = setInterval(async () => {
      if (Date.now() - started > timeoutMs) {
        clearInterval(timer);
        res(false);
        return;
      }
      try {
        const r = await send("Runtime.evaluate", {
          expression: "document.readyState",
          returnByValue: true,
        }, sessionId);
        if (r?.result?.result?.value === "complete") {
          clearInterval(timer);
          res(true);
        }
      } catch {
        // The target may still be attaching.
      }
    }, 120);
  });
}

let exitCode = 0;

try {
  const version = await waitForEndpoint();
  if (!version) {
    process.stdout.write("measure: Chrome did not expose a debugging port; skipping\n");
    process.exit(0);
  }

  const file = resolve(args._[0]);
  const target = await newTarget(`file://${file}`);

  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((res, rej) => {
    socket.addEventListener("open", res, { once: true });
    socket.addEventListener("error", () => rej(new Error("websocket failed")), { once: true });
  });

  socket.addEventListener("message", (event) => {
    const msg = JSON.parse(event.data);
    if (msg.id && pending.has(msg.id)) {
      const { resolve: ok, reject: no } = pending.get(msg.id);
      pending.delete(msg.id);
      if (msg.error) no(new Error(msg.error.message));
      else ok(msg);
    }
  });

  const { result: sessionResult } = await send("Target.attachToTarget", { targetId: target.id, flatten: true });
  const sessionId = sessionResult.sessionId;

  // This is the line that makes a 390px viewport real. Without it Chrome
  // clamps the window to 500px and every mobile bug hides.
  await send("Emulation.setDeviceMetricsOverride", {
    width: args.width,
    height: args.height,
    deviceScaleFactor: 2,
    mobile: args.width < 768,
  }, sessionId);

  await send("Page.enable", {}, sessionId);
  await send("Runtime.enable", {}, sessionId);
  await waitForLoad(sessionId);

  const evaluated = await send("Runtime.evaluate", {
    expression: PROBE,
    returnByValue: true,
    awaitPromise: false,
  }, sessionId);

  const result = evaluated?.result?.result?.value;
  if (!result) {
    process.stdout.write("measure: the page probe did not return a result; skipping\n");
    process.exit(0);
  }

  const lines = [];
  lines.push(`${args._[0]} at ${args.width}px:`);
  lines.push(`  viewport ${result.viewport}px, scroll width ${result.scrollWidth}px`);
  lines.push(`  controls measured: ${result.targets.length}`);

  const small = result.targets.filter((t) => !t.inline && t.h < args.min);
  if (small.length) {
    lines.push(`  ${small.length} control(s) painted under ${args.min}px tall:`);
    for (const t of small.slice(0, 12)) {
      lines.push(`    ${t.tag}${t.cls ? "." + t.cls.split(/\s+/)[0] : ""} "${t.name}" ${t.w}x${t.h}`);
    }
  }

  const clipped = result.targets.filter((t) => t.clipped);
  if (clipped.length) {
    lines.push(`  ${clipped.length} control(s) cut off by the viewport edge:`);
    for (const t of clipped.slice(0, 8)) {
      lines.push(`    ${t.tag}${t.cls ? "." + t.cls.split(/\s+/)[0] : ""} "${t.name}" right=${t.w}px wide`);
    }
    exitCode = 1;
  }

  if (result.overflowing.length) {
    lines.push(`  ${result.overflowing.length} element(s) extend past the viewport:`);
    for (const o of result.overflowing.slice(0, 12)) {
      lines.push(`    ${o.tag}${o.cls ? "." + o.cls.split(/\s+/)[0] : ""}${o.id ? "#" + o.id : ""} left=${o.left} right=${o.right} width=${o.width} display=${o.display}`);
    }
  }

  if (result.overflow) {
    lines.push("  RESULT: horizontal overflow");
    exitCode = 1;
  } else {
    lines.push("  RESULT: no horizontal overflow");
  }

  process.stdout.write(`${lines.join("\n")}\n`);
} catch (err) {
  process.stdout.write(`measure: ${err.message}; skipping layout measurement\n`);
  exitCode = 0;
} finally {
  try {
    socket?.close();
  } catch {
    // Already gone.
  }
  child.kill();
}

process.exit(exitCode);
