#!/usr/bin/env node
// Check a composition before rendering it. Exits 1 while anything is wrong.
//
//   node scripts/check.mjs examples/title-card/title-card.html
//   node scripts/check.mjs comp.html --json
//   node scripts/check.mjs comp.html --safe 0.1     # stricter title-safe margin
//
// Six checks, each something a viewer would notice and an author would not:
//
//   contract      the page says how big, how fast and how long it is, in a shape H.264 can encode
//   determinism   a frame rendered twice, out of order, is the same pixels
//   safe-area     settled text stays inside the title-safe margin
//   font-size     settled text is big enough to read on a phone
//   reading-time  every piece of text stays up long enough to be read
//   contrast      settled text against the actual pixels behind it, not the CSS

import { createHash } from "node:crypto";
import { openComposition } from "../kit/composition.mjs";
import { decodePng } from "../kit/png.mjs";
import {
  PROBE, settled, checkSafeArea, checkFontSize, checkReadingTime, checkContrast,
  checkDeterminism, backgroundLuminance, parseRgb, luminance, format,
} from "../kit/checks.mjs";

const hash = (buf) => createHash("sha1").update(buf).digest("hex");

export async function check(file, { safe = 0.05, rate = 10 } = {}) {
  const comp = await openComposition(file);
  try {
    if (comp.problems.length || !comp.config) {
      const config = comp.config ?? { width: 0, height: 0, fps: 0, duration: 0 };
      return {
        config,
        samples: 0,
        findings: comp.problems.map((message, i) => ({ check: "contract", level: "error", id: i, t: 0, element: "window.__reel", message })),
      };
    }
    const { config } = comp;
    const findings = [];
    if (![24, 25, 30, 50, 60].includes(config.fps)) {
      findings.push({ check: "contract", level: "warning", id: "fps", t: 0, element: "window.__reel",
        message: `${config.fps} fps is unusual; players and platforms expect 24, 25, 30, 50 or 60` });
    }
    if (Math.abs(config.frames - config.duration * config.fps) > 1e-6) {
      findings.push({ check: "contract", level: "warning", id: "frames", t: 0, element: "window.__reel",
        message: `${config.duration}s at ${config.fps} fps is not a whole number of frames; it will be ${config.frames} frames` });
    }

    // Sample on a grid of whole frames, about `rate` times a second.
    const every = Math.max(1, Math.round(config.fps / rate));
    const step = every / config.fps;
    const frames = [];
    for (let f = 0; f < config.frames; f += every) frames.push(f);

    const samples = [];
    const shots = new Map();
    const first = new Map();
    for (const frame of frames) {
      const t = await comp.seek(frame);
      const texts = await comp.page.evaluate(PROBE);
      const png = await comp.page.screenshot();
      shots.set(samples.length, png);
      first.set(frame, { t, hash: hash(png) });
      samples.push({ t, frame, texts });
    }

    // Determinism: the same frames again, backwards, in the same page.
    const picks = frames.filter((_, i) => i % Math.max(1, Math.floor(frames.length / 8)) === 0);
    const second = new Map();
    for (const frame of [...picks].reverse()) {
      await comp.seek(frame);
      second.set(frame, { hash: hash(await comp.page.screenshot()) });
    }
    findings.push(...checkDeterminism(new Map(picks.map((f) => [f, first.get(f)])), second));

    const hold = Math.max(1, Math.round(0.2 / step));
    const still = settled(samples, config, hold);
    findings.push(...checkSafeArea(still, config, safe));
    findings.push(...checkFontSize(still, config));
    findings.push(...checkReadingTime(samples, config, step));

    // Contrast: each settled element once, in the first frame it settled.
    const measured = [];
    const done = new Set();
    const decoded = new Map();
    for (const box of still) {
      if (done.has(box.id) || box.decorative) continue;
      done.add(box.id);
      const rgb = parseRgb(box.color);
      if (!rgb) continue;
      if (!decoded.has(box.sample)) decoded.set(box.sample, decodePng(shots.get(box.sample)));
      measured.push({ box, bgLum: backgroundLuminance(decoded.get(box.sample), box, luminance(rgb)) });
    }
    findings.push(...checkContrast(measured, config));

    return { config, samples: samples.length, findings };
  } finally {
    comp.close();
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const args = { _: [] };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith("--")) {
      const next = argv[i + 1];
      args[argv[i].slice(2)] = next !== undefined && !next.startsWith("--") ? argv[++i] : true;
    } else args._.push(argv[i]);
  }
  if (!args._.length || args.help) {
    process.stdout.write(`Usage: node scripts/check.mjs <composition.html> [--json] [--safe 0.05] [--quiet]

Exits 1 on any error, 2 when no Chrome is available. Warnings never fail.
Mark purely decorative text with data-reel-decorative to exempt it from the
font-size, reading-time and contrast checks.
`);
    process.exit(0);
  }
  try {
    const result = await check(args._[0], { safe: args.safe ? Number(args.safe) : 0.05 });
    const errors = result.findings.filter((f) => f.level === "error").length;
    if (args.json) process.stdout.write(JSON.stringify(result, null, 2) + "\n");
    else if (!args.quiet || errors) process.stdout.write(format(result.findings, { file: args._[0], ...result }) + "\n");
    process.exit(errors ? 1 : 0);
  } catch (err) {
    process.stderr.write(`check: ${err.message}\n`);
    process.exit(err.code === "NO_CHROME" ? 2 : 1);
  }
}
