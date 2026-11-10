#!/usr/bin/env node
// Render an HTML composition to an MP4, frame by frame.
//
//   node scripts/render.mjs examples/title-card/title-card.html --out out/title-card.mp4
//   node scripts/render.mjs comp.html --still 2.5 --out frame.png   # one frame, to look at
//   node scripts/render.mjs comp.html --frames 0-59 --out part.mp4  # a slice
//   node scripts/render.mjs comp.html --audio music.mp3 --out with-music.mp4
//
// Every frame is a screenshot taken after the page has been moved to exactly
// frame / fps seconds (kit/runtime.mjs). The PNGs are piped to ffmpeg, which
// encodes H.264 in yuv420p: the format every phone, browser and editor plays.

import { mkdirSync, writeFileSync, existsSync } from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import { dirname, resolve } from "node:path";
import { availableParallelism } from "node:os";
import { openComposition } from "../kit/composition.mjs";

export function parseArgs(argv) {
  const args = { _: [], audio: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith("--")) { args._.push(a); continue; }
    const key = a.slice(2);
    const next = argv[i + 1];
    const value = next !== undefined && !next.startsWith("--") ? (i++, next) : true;
    if (key === "audio") args.audio.push(value);
    else args[key] = value;
  }
  return args;
}

/** "12-40" → [12, 40], clamped to the composition. */
export function frameRange(spec, total) {
  if (!spec || spec === true) return [0, total - 1];
  const m = String(spec).match(/^(\d+)(?:-(\d+))?$/);
  if (!m) throw new Error(`--frames takes N or N-M, got ${spec}`);
  const a = Math.min(Number(m[1]), total - 1);
  const b = Math.min(m[2] === undefined ? a : Number(m[2]), total - 1);
  if (b < a) throw new Error(`--frames ${spec} ends before it starts`);
  return [a, b];
}

/**
 * The ffmpeg arguments for a PNG stream on stdin plus any audio tracks.
 * Each track is { src, at = 0, volume = 1 }; they are delayed into place and
 * mixed, and the result is cut to the picture's length.
 */
export function ffmpegArgs({ fps, out, audio = [], crf = 18, startSeconds = 0 }) {
  const args = ["-y", "-hide_banner", "-loglevel", "error", "-f", "image2pipe", "-framerate", String(fps), "-i", "-"];
  for (const track of audio) args.push("-i", track.src);
  if (audio.length) {
    const parts = audio.map((track, i) => {
      const delay = Math.max(0, Math.round(((track.at ?? 0) - startSeconds) * 1000));
      const trim = Math.max(0, startSeconds - (track.at ?? 0));
      const vol = track.volume ?? 1;
      return `[${i + 1}:a]atrim=start=${trim},asetpts=PTS-STARTPTS,adelay=${delay}:all=1,volume=${vol}[a${i}]`;
    });
    const mix = audio.length === 1
      ? "[a0]anull[aout]"
      : `${audio.map((_, i) => `[a${i}]`).join("")}amix=inputs=${audio.length}:normalize=0:duration=longest[aout]`;
    args.push("-filter_complex", [...parts, mix].join(";"), "-map", "0:v", "-map", "[aout]", "-c:a", "aac", "-b:a", "192k", "-shortest");
  }
  args.push("-c:v", "libx264", "-preset", "medium", "-crf", String(crf), "-pix_fmt", "yuv420p", "-movflags", "+faststart", out);
  return args;
}

function hasFfmpeg() {
  return spawnSync("ffmpeg", ["-version"]).status === 0;
}

export async function render({ file, out, frames, still, audio = [], crf = 18, concurrency = defaultConcurrency(), onProgress = () => {} }) {
  const comp = await openComposition(file);
  const extra = [];
  try {
    if (comp.problems.length) throw new Error(comp.problems.join("; "));
    const { config } = comp;
    mkdirSync(dirname(resolve(out)), { recursive: true });

    if (still !== undefined) {
      const frame = Math.min(Math.round(Number(still) * config.fps), config.frames - 1);
      writeFileSync(out, await comp.still(frame));
      return { out, frames: 1, config };
    }

    if (!hasFfmpeg()) throw new Error("ffmpeg is not installed; --still works without it");
    const [first, last] = frameRange(frames, config.frames);
    const base = dirname(resolve(file));
    const tracks = [...config.audio, ...audio.map((src) => ({ src }))].map((t) => ({
      ...t,
      src: resolve(t.src.startsWith("/") ? t.src : resolve(base, t.src)),
    }));
    for (const t of tracks) if (!existsSync(t.src)) throw new Error(`audio not found: ${t.src}`);

    const ff = spawn("ffmpeg", ffmpegArgs({ fps: config.fps, out, audio: tracks, crf, startSeconds: first / config.fps }), {
      stdio: ["pipe", "ignore", "pipe"],
    });
    let stderr = "";
    ff.stderr.on("data", (d) => (stderr += d));
    const done = new Promise((ok, no) => {
      ff.on("error", no);
      ff.on("close", (code) => (code === 0 ? ok() : no(new Error(`ffmpeg exited ${code}: ${stderr.trim()}`))));
    });

    // Several pages render frames side by side; ffmpeg still gets them in order.
    // Each page is a separate Chrome, so one page's state cannot leak into
    // another's frames — which is also a free determinism check.
    const total = last - first + 1;
    const workers = Math.max(1, Math.min(concurrency, total));
    for (let i = 1; i < workers; i++) extra.push(await openComposition(file));
    const pages = [comp, ...extra];

    const ready = new Map();
    let next = first;
    let wake = null;
    const started = Date.now();
    const worker = async (page, offset) => {
      for (let f = first + offset; f <= last; f += workers) {
        while (f - next >= workers * 3) await new Promise((r) => setTimeout(r, 5));
        ready.set(f, await page.still(f));
        wake?.();
      }
    };
    const writer = (async () => {
      while (next <= last) {
        if (!ready.has(next)) { await new Promise((r) => (wake = r)); wake = null; continue; }
        const png = ready.get(next);
        ready.delete(next);
        if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once("drain", r));
        next++;
        onProgress(next - first, total, Date.now() - started);
      }
      ff.stdin.end();
    })();
    await Promise.all([...pages.map((p, i) => worker(p, i)), writer]);
    await done;
    return { out, frames: total, config, ms: Date.now() - started, workers };
  } finally {
    comp.close();
    for (const c of extra) c.close();
  }
}

export function defaultConcurrency() {
  return Math.max(1, Math.min(4, Math.floor(availableParallelism() / 2)));
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const args = parseArgs(process.argv.slice(2));
  if (!args._.length || args.help) {
    process.stdout.write(`Usage: node scripts/render.mjs <composition.html> [options]

  --out <file>        output .mp4, or .png with --still (default: out/<name>.mp4)
  --still <seconds>   render one frame as a PNG instead of a video
  --frames <N-M>      render only frames N to M
  --audio <file>      add an audio track (repeatable); also read from __reel.audio
  --crf <n>           H.264 quality, lower is better (default 18)
  --concurrency <n>   pages rendering at once (default: half the cores, at most 4)

Run scripts/check.mjs first: it exits 1 while a frame is unreadable or unstable.
`);
    process.exit(0);
  }
  const name = args._[0].split("/").pop().replace(/\.html?$/, "");
  const out = args.out || (args.still !== undefined ? `out/${name}.png` : `out/${name}.mp4`);
  try {
    const tty = process.stderr.isTTY;
    const result = await render({
      file: args._[0],
      out,
      frames: args.frames,
      still: args.still === true ? 0 : args.still,
      audio: args.audio,
      crf: args.crf ? Number(args.crf) : 18,
      concurrency: args.concurrency ? Number(args.concurrency) : undefined,
      onProgress: (n, total) => {
        if (tty) process.stderr.write(`\rframe ${n}/${total}`);
        else if (n === total || n % 60 === 0) process.stderr.write(`frame ${n}/${total}\n`);
      },
    });
    if (process.stderr.isTTY) process.stderr.write("\n");
    const { width, height, fps } = result.config;
    const speed = result.ms ? ` in ${(result.ms / 1000).toFixed(1)}s` : "";
    process.stdout.write(`wrote ${result.out} · ${width}×${height} · ${fps} fps · ${result.frames} frame(s)${speed}\n`);
  } catch (err) {
    process.stderr.write(`render: ${err.message}\n`);
    process.exit(err.code === "NO_CHROME" ? 2 : 1);
  }
}
