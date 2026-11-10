// node --test scripts/*.test.mjs
//
// The pure parts are tested directly. The parts that need Chrome and ffmpeg
// skip, with a reason, when either is missing — CI has both.

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, mkdtempSync } from "node:fs";
import { deflateSync } from "node:zlib";
import { join, dirname } from "node:path";
import { tmpdir } from "node:os";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import vm from "node:vm";

import { readingSeconds, parseRgb, luminance, ratio, settled, checkSafeArea, checkFontSize,
  checkReadingTime, checkContrast, checkDeterminism, backgroundLuminance, safeBox } from "../kit/checks.mjs";
import { parseConfig } from "../kit/runtime.mjs";
import { decodePng } from "../kit/png.mjs";
import { findChrome } from "../kit/chrome.mjs";
import { ffmpegArgs, frameRange, render } from "./render.mjs";
import { check } from "./check.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const root = join(here, "..");

// motion.js is a classic browser script; run it in a sandbox to get Reel.
const sandbox = {};
vm.runInNewContext(readFileSync(join(root, "kit/motion.js"), "utf8"), sandbox);
const { interpolate, spring, Easing, scene, typewriter } = sandbox.Reel;

test("interpolate maps, clamps and eases", () => {
  assert.equal(interpolate(0.5, [0, 1], [0, 100]), 50);
  assert.equal(interpolate(-1, [0, 1], [0, 100]), 0);
  assert.equal(interpolate(2, [0, 1], [0, 100]), 100);
  assert.equal(interpolate(2, [0, 1], [0, 100], { clamp: false }), 200);
  assert.equal(interpolate(0.75, [0, 0.5, 1], [0, 1, 0]), 0.5);
  assert.ok(interpolate(0.5, [0, 1], [0, 1], { easing: Easing.in }) < 0.5);
  assert.throws(() => interpolate(0, [1, 0], [0, 1]));
});

test("CSS bezier easings hit their ends and are monotonic", () => {
  for (const name of ["ease", "in", "out", "inOut"]) {
    const e = Easing[name];
    assert.equal(e(0), 0);
    assert.equal(e(1), 1);
    let prev = 0;
    for (let x = 0.05; x < 1; x += 0.05) {
      assert.ok(e(x) >= prev - 1e-9, `${name} goes backwards at ${x}`);
      prev = e(x);
    }
  }
});

test("spring starts at rest, settles at the target, and is order-free", () => {
  assert.equal(spring(0), 0);
  assert.equal(spring(0.3, { delay: 0.5 }), 0);
  assert.ok(Math.abs(spring(3) - 1) < 1e-3);
  assert.ok(Math.abs(spring(3, { from: 10, to: 20 }) - 20) < 1e-2);
  const bouncy = spring(0.35, { damping: 8 });
  assert.ok(bouncy > 1, "an underdamped spring overshoots");
  assert.equal(spring(0.42), spring(0.42));
  for (const damping of [10, 26, 2 * Math.sqrt(170), 60]) assert.ok(Math.abs(spring(5, { damping }) - 1) < 1e-2);
});

test("scene and typewriter are pure functions of time", () => {
  assert.deepEqual({ ...scene(2.5, 2, 1) }, { active: true, local: 0.5, progress: 0.5 });
  assert.equal(scene(3.5, 2, 1).active, false);
  assert.equal(typewriter("你好世界", 0.25, { cps: 8 }), "你好");
});

test("reading time: alphabetic text, CJK text and a floor", () => {
  assert.equal(readingSeconds("Hi"), 0.8);
  assert.ok(Math.abs(readingSeconds("a".repeat(34)) - 2) < 1e-9);
  assert.ok(Math.abs(readingSeconds("一".repeat(18)) - 2) < 1e-9);
});

test("colour parsing and WCAG contrast", () => {
  assert.deepEqual(parseRgb("rgb(255, 0, 10)"), [255, 0, 10, 1]);
  assert.deepEqual(parseRgb("rgba(1, 2, 3, 0.5)"), [1, 2, 3, 0.5]);
  assert.deepEqual(parseRgb("rgb(1 2 3 / 50%)"), [1, 2, 3, 0.5]);
  assert.equal(parseRgb("oklch(0.5 0.1 20)"), null);
  assert.ok(Math.abs(ratio(luminance([0, 0, 0]), luminance([255, 255, 255])) - 21) < 1e-9);
});

test("config: needs the four numbers and even dimensions", () => {
  assert.match(parseConfig(null).problems[0], /window.__reel/);
  assert.deepEqual(parseConfig({ width: 1920, height: 1080, fps: 30, duration: 2 }).problems, []);
  assert.equal(parseConfig({ width: 1920, height: 1080, fps: 30, duration: 2 }).config.frames, 60);
  assert.match(parseConfig({ width: 1921, height: 1080, fps: 30, duration: 2 }).problems.join(), /even/);
  assert.match(parseConfig({ width: 1920, height: 1080, duration: 0 }).problems.join(), /duration/);
});

const cfg = { width: 1920, height: 1080, fps: 30, duration: 2 };
const box = (over = {}) => ({ id: 1, name: "p", text: "Hello there", x0: 300, y0: 300, x1: 700, y1: 360, opacity: 1, fontPx: 48, color: "rgb(255, 255, 255)", decorative: false, ...over });
const samplesOf = (boxes, step = 0.1) => boxes.map((texts, i) => ({ t: i * step, frame: i * 3, texts }));

test("settled: text that has stopped moving, opaque and on screen", () => {
  const moving = samplesOf([[box({ y0: 400, y1: 460 })], [box({ y0: 350, y1: 410 })], [box()], [box()], [box()]]);
  const s = settled(moving, cfg, 2);
  assert.deepEqual(s.map((b) => b.t), [0.2]);
  assert.equal(settled(samplesOf([[box({ opacity: 0.5 })], [box({ opacity: 0.5 })], [box({ opacity: 0.5 })]]), cfg, 2).length, 0);
});

test("safe area: the 5% margin, and app UI on portrait video", () => {
  assert.deepEqual(safeBox(cfg), { x0: 96, y0: 54, x1: 1824, y1: 1026 });
  assert.equal(checkSafeArea([{ ...box(), t: 0 }], cfg).length, 0);
  const out = checkSafeArea([{ ...box({ x0: 20 }), t: 0 }], cfg);
  assert.equal(out[0].level, "error");
  const portrait = { width: 1080, height: 1920 };
  const low = checkSafeArea([{ ...box({ x0: 200, x1: 600, y0: 1700, y1: 1760 }), t: 0 }], portrait);
  assert.equal(low[0].level, "warning");
});

test("font size scales with the short side", () => {
  assert.equal(checkFontSize([{ ...box({ fontPx: 20 }), t: 0 }], cfg)[0].level, "error");
  assert.equal(checkFontSize([{ ...box({ fontPx: 28 }), t: 0 }], cfg)[0].level, "warning");
  assert.equal(checkFontSize([{ ...box({ fontPx: 40 }), t: 0 }], cfg).length, 0);
  assert.equal(checkFontSize([{ ...box({ fontPx: 10, decorative: true }), t: 0 }], cfg).length, 0);
});

test("reading time counts the run each element is readable for", () => {
  const long = "This sentence takes a while to read properly";
  const brief = samplesOf([[], [box({ text: long })], [box({ text: long })], []]);
  assert.equal(checkReadingTime(brief, cfg, 0.1).length, 1);
  const ample = samplesOf(Array.from({ length: 40 }, () => [box({ text: long })]));
  assert.equal(checkReadingTime(ample, cfg, 0.1).length, 0);
  const symbol = samplesOf([[box({ text: "·" })]]);
  assert.equal(checkReadingTime(symbol, cfg, 0.1).length, 0);
});

test("contrast is judged against the pixels, at the worst point", () => {
  const image = { width: 10, height: 10, data: Buffer.alloc(400, 0) };
  for (let i = 3; i < 400; i += 4) image.data[i] = 255;
  // A bright patch in one corner of the ring.
  image.data.set([250, 250, 250, 255], 0);
  const b = { x0: 4, y0: 4, x1: 6, y1: 6 };
  // Dark text is judged against the darkest part of the ring, light text
  // against the brightest: the bright corner is what a white caption fights.
  assert.equal(backgroundLuminance(image, b, 0), 0);
  assert.ok(backgroundLuminance(image, b, 1) > 0.9);
  const ok = checkContrast([{ box: { ...box(), t: 0 }, bgLum: 0 }], cfg);
  assert.equal(ok.length, 0);
  const bad = checkContrast([{ box: { ...box({ color: "rgb(90, 90, 90)", fontPx: 30 }), t: 0 }, bgLum: 0.05 }], cfg);
  assert.equal(bad.length, 1);
});

test("determinism collapses to one finding", () => {
  const a = new Map([[0, { t: 0, hash: "x" }], [9, { t: 0.3, hash: "y" }]]);
  assert.equal(checkDeterminism(a, new Map([[0, { hash: "x" }], [9, { hash: "y" }]])).length, 0);
  const out = checkDeterminism(a, new Map([[0, { hash: "x" }], [9, { hash: "z" }]]));
  assert.equal(out.length, 1);
  assert.match(out[0].message, /1 of 2/);
});

test("frame ranges and ffmpeg arguments", () => {
  assert.deepEqual(frameRange(undefined, 90), [0, 89]);
  assert.deepEqual(frameRange("10-20", 90), [10, 20]);
  assert.deepEqual(frameRange("5", 90), [5, 5]);
  assert.deepEqual(frameRange("80-200", 90), [80, 89]);
  assert.throws(() => frameRange("20-10", 90));
  const plain = ffmpegArgs({ fps: 30, out: "o.mp4" });
  assert.ok(plain.includes("yuv420p") && plain.includes("libx264") && !plain.includes("-filter_complex"));
  const mixed = ffmpegArgs({ fps: 30, out: "o.mp4", audio: [{ src: "a.mp3", at: 1.5 }, { src: "b.wav", volume: 0.3 }] });
  const graph = mixed[mixed.indexOf("-filter_complex") + 1];
  assert.match(graph, /adelay=1500/);
  assert.match(graph, /amix=inputs=2/);
  assert.match(graph, /volume=0.3/);
});

test("PNG decoding: RGB with every filter type", () => {
  const w = 3, h = 5, rows = [];
  for (let y = 0; y < h; y++) {
    const line = Buffer.alloc(1 + w * 3);
    line[0] = y; // filter type y: 0..4; the decoder must undo each
    for (let x = 0; x < w * 3; x++) line[1 + x] = 0; // all-zero deltas
    rows.push(line);
  }
  const chunk = (type, body) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(body.length);
    return Buffer.concat([len, Buffer.from(type, "latin1"), body, Buffer.alloc(4)]);
  };
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2;
  const png = Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    chunk("IHDR", ihdr), chunk("IDAT", deflateSync(Buffer.concat(rows))), chunk("IEND", Buffer.alloc(0)),
  ]);
  const img = decodePng(png);
  assert.equal(img.width, 3);
  assert.equal(img.data.length, 3 * 5 * 4);
  assert.equal(img.data[3], 255);
});

// ------------------------------------------------- with Chrome (and ffmpeg)

const chrome = findChrome();
const ffmpeg = spawnSync("ffmpeg", ["-version"]).status === 0;

test("the title card passes every check", { skip: !chrome && "no Chrome" }, async () => {
  const { findings } = await check(join(root, "examples/title-card/title-card.html"));
  assert.deepEqual(findings.filter((f) => f.level === "error"), []);
});

test("the broken fixture fails each check it was built to fail", { skip: !chrome && "no Chrome" }, async () => {
  const { findings } = await check(join(root, "examples/broken/broken.html"));
  const fired = new Set(findings.filter((f) => f.level === "error").map((f) => f.check));
  assert.deepEqual([...fired].sort(), ["contrast", "determinism", "font-size", "reading-time", "safe-area"]);
});

test("a slice renders to a playable H.264 file", { skip: (!chrome && "no Chrome") || (!ffmpeg && "no ffmpeg") }, async () => {
  const out = join(mkdtempSync(join(tmpdir(), "reel-test-")), "slice.mp4");
  const result = await render({ file: join(root, "examples/title-card/title-card.html"), out, frames: "30-44", concurrency: 2 });
  assert.equal(result.frames, 15);
  const probe = spawnSync("ffprobe", ["-v", "error", "-select_streams", "v:0", "-count_frames",
    "-show_entries", "stream=codec_name,width,height,pix_fmt,nb_read_frames", "-of", "json", out]);
  const stream = JSON.parse(String(probe.stdout)).streams[0];
  assert.equal(stream.codec_name, "h264");
  assert.equal(stream.pix_fmt, "yuv420p");
  assert.equal(Number(stream.nb_read_frames), 15);
});
