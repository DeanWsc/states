// The checks, as pure functions over what scripts/check.mjs collected from the
// page. Nothing here touches a browser, so every rule is unit-tested directly.
//
// A sample is { t, frame, texts: [TextBox] } where a TextBox is what PROBE
// (below) measured for one element with text in it at that moment.

/** Runs in the page: every element with its own visible text, measured. */
export const PROBE = String.raw`(() => {
  const ids = (window.__reelIds ??= new WeakMap());
  const byEl = new Map();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node; (node = walker.nextNode()); ) {
    if (!node.textContent.trim()) continue;
    const el = node.parentElement;
    if (!el || el.closest("script, style, noscript, template")) continue;
    if (!byEl.has(el)) byEl.set(el, []);
    byEl.get(el).push(node);
  }
  const out = [];
  for (const [el, nodes] of byEl) {
    const cs = getComputedStyle(el);
    if (cs.visibility !== "visible") continue;
    let opacity = 1;
    for (let e = el; e; e = e.parentElement) {
      const s = getComputedStyle(e);
      if (s.display === "none") { opacity = 0; break; }
      opacity *= parseFloat(s.opacity);
    }
    if (opacity < 0.02) continue;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const node of nodes) {
      const range = document.createRange();
      range.selectNodeContents(node);
      for (const b of range.getClientRects()) {
        if (b.width < 0.5 || b.height < 0.5) continue;
        x0 = Math.min(x0, b.left); y0 = Math.min(y0, b.top);
        x1 = Math.max(x1, b.right); y1 = Math.max(y1, b.bottom);
      }
    }
    if (x0 === Infinity) continue;
    if (!ids.has(el)) ids.set(el, (window.__reelNextId = (window.__reelNextId || 0) + 1));
    const box = el.getBoundingClientRect();
    const scale = el.offsetHeight ? box.height / el.offsetHeight : 1;
    const text = nodes.map((n) => n.textContent).join("").replace(/\s+/g, " ").trim();
    const name = el.tagName.toLowerCase() + (el.id ? "#" + el.id : el.classList.length ? "." + [...el.classList].join(".") : "");
    out.push({
      id: ids.get(el), name, text,
      x0, y0, x1, y1, opacity,
      fontPx: parseFloat(cs.fontSize) * (Number.isFinite(scale) && scale > 0 ? scale : 1),
      color: cs.color,
      decorative: !!el.closest("[data-reel-decorative]"),
    });
  }
  return out;
})()`;

// ---------------------------------------------------------------- colour

/** "rgb(1 2 3 / 0.5)" or "rgba(1, 2, 3, 0.5)" → [r, g, b, a], else null. */
export function parseRgb(css) {
  const m = String(css).match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:[\s,/]+([\d.]+%?))?\s*\)$/);
  if (!m) return null;
  let a = m[4] === undefined ? 1 : m[4].endsWith("%") ? parseFloat(m[4]) / 100 : parseFloat(m[4]);
  return [Number(m[1]), Number(m[2]), Number(m[3]), a];
}

const channel = (c) => {
  const s = c / 255;
  return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
};
/** WCAG relative luminance of an sRGB colour, 0..1. */
export const luminance = ([r, g, b]) => 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
/** WCAG contrast ratio between two luminances, 1..21. */
export const ratio = (l1, l2) => (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);

/**
 * The background a text box sits on, read from the frame: the pixels in a thin
 * ring just outside the box. Returns the luminance at the percentile closest to
 * the text's own luminance — the worst case, not the average, because a light
 * caption over a sky is unreadable where the sky is brightest.
 */
export function backgroundLuminance(image, box, textLum, gap = 4) {
  const { width, height, data } = image;
  const x0 = Math.max(0, Math.floor(box.x0 - gap)), x1 = Math.min(width - 1, Math.ceil(box.x1 + gap));
  const y0 = Math.max(0, Math.floor(box.y0 - gap)), y1 = Math.min(height - 1, Math.ceil(box.y1 + gap));
  const lums = [];
  const take = (x, y) => {
    const i = (y * width + x) * 4;
    lums.push(luminance([data[i], data[i + 1], data[i + 2]]));
  };
  for (let x = x0; x <= x1; x += 2) { take(x, y0); take(x, y1); }
  for (let y = y0; y <= y1; y += 2) { take(x0, y); take(x1, y); }
  if (!lums.length) return null;
  lums.sort((a, b) => a - b);
  const pick = (p) => lums[Math.min(lums.length - 1, Math.floor(p * lums.length))];
  return textLum > pick(0.5) ? pick(0.9) : pick(0.1);
}

// ------------------------------------------------------------- reading time

const CJK = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu;
const WORDY = /[\p{L}\p{N}]/u;

/**
 * Seconds a viewer needs to read `text`. Subtitle practice: about 17
 * characters a second for alphabetic text, 9 for Chinese and Japanese, and
 * never less than 0.8s for anything at all.
 */
export function readingSeconds(text, { latinCps = 17, cjkCps = 9, floor = 0.8 } = {}) {
  const cjk = (text.match(CJK) || []).length;
  const rest = text.replace(CJK, "").replace(/\s+/g, "").length;
  return Math.max(floor, cjk / cjkCps + rest / latinCps);
}

// ------------------------------------------------------------------ checks

/** The title-safe box for a frame. Portrait video also loses its edges to app UI. */
export function safeBox({ width, height }, margin = 0.05) {
  return { x0: width * margin, y0: height * margin, x1: width * (1 - margin), y1: height * (1 - margin) };
}
export function platformBox({ width, height }) {
  // Where Reels, TikTok and Shorts put captions, names and buttons on a 9:16 video.
  return { x0: width * 0.06, y0: height * 0.1, x1: width * 0.86, y1: height * 0.8 };
}

const visibleFraction = (b, { width, height }) => {
  const w = Math.max(0, Math.min(b.x1, width) - Math.max(b.x0, 0));
  const h = Math.max(0, Math.min(b.y1, height) - Math.max(b.y0, 0));
  const area = (b.x1 - b.x0) * (b.y1 - b.y0);
  return area > 0 ? (w * h) / area : 0;
};

/**
 * Text is "settled" when it is fully opaque, fully on screen and has not moved
 * for `hold` samples. Settled text is what a viewer is meant to read, so it is
 * what the layout checks judge; text mid-entrance is allowed to be anywhere.
 */
export function settled(samples, config, hold) {
  const out = [];
  for (let i = 0; i + hold < samples.length; i++) {
    const later = new Map(samples[i + hold].texts.map((b) => [b.id, b]));
    for (const b of samples[i].texts) {
      const c = later.get(b.id);
      if (!c || b.opacity < 0.95 || c.opacity < 0.95) continue;
      if (visibleFraction(b, config) < 0.999) continue;
      const moved = Math.max(Math.abs(b.x0 - c.x0), Math.abs(b.y0 - c.y0), Math.abs(b.x1 - c.x1), Math.abs(b.y1 - c.y1));
      if (moved <= 1.5) out.push({ ...b, t: samples[i].t, sample: i });
    }
  }
  return out;
}

const fmt = (t) => `${t.toFixed(2)}s`;
const quote = (text) => `“${text.length > 32 ? text.slice(0, 31) + "…" : text}”`;

/** One finding per element per check: the first time it happens. */
function firstPer(findings) {
  const seen = new Set();
  return findings.filter((f) => {
    const key = `${f.check}:${f.id}:${f.level}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function checkSafeArea(still, config, margin = 0.05) {
  const box = safeBox(config, margin);
  const findings = [];
  for (const b of still) {
    if (b.x0 < box.x0 - 0.5 || b.y0 < box.y0 - 0.5 || b.x1 > box.x1 + 0.5 || b.y1 > box.y1 + 0.5) {
      findings.push({ check: "safe-area", level: "error", id: b.id, t: b.t, element: b.name,
        message: `${quote(b.text)} sits outside the ${Math.round(margin * 100)}% title-safe margin, where TVs and players crop` });
    } else if (config.height > config.width) {
      const p = platformBox(config);
      if (b.x0 < p.x0 || b.y0 < p.y0 || b.x1 > p.x1 || b.y1 > p.y1) {
        findings.push({ check: "safe-area", level: "warning", id: b.id, t: b.t, element: b.name,
          message: `${quote(b.text)} is where short-video apps put their own captions and buttons` });
      }
    }
  }
  return firstPer(findings);
}

export function checkFontSize(still, config) {
  const short = Math.min(config.width, config.height);
  const min = short * 0.022, ideal = short * 0.03;
  const findings = [];
  for (const b of still) {
    if (b.decorative) continue;
    if (b.fontPx < min - 0.01) {
      findings.push({ check: "font-size", level: "error", id: b.id, t: b.t, element: b.name,
        message: `${quote(b.text)} is ${b.fontPx.toFixed(1)}px; below ${min.toFixed(0)}px nobody reads it on a phone` });
    } else if (b.fontPx < ideal - 0.01) {
      findings.push({ check: "font-size", level: "warning", id: b.id, t: b.t, element: b.name,
        message: `${quote(b.text)} is ${b.fontPx.toFixed(1)}px; ${ideal.toFixed(0)}px or more reads comfortably` });
    }
  }
  return firstPer(findings);
}

/** Runs of consecutive samples in which each element was readable. */
export function readableRuns(samples, config) {
  const runs = new Map(); // id → [{ start, end, text, box }]
  const open = new Map();
  samples.forEach((s, i) => {
    const here = new Set();
    for (const b of s.texts) {
      if (b.opacity < 0.6 || visibleFraction(b, config) < 0.5 || !WORDY.test(b.text)) continue;
      here.add(b.id);
      const run = open.get(b.id);
      if (run && run.end === i - 1) {
        run.end = i;
        if (b.text.length > run.text.length) run.text = b.text;
      } else {
        const fresh = { id: b.id, start: i, end: i, text: b.text, name: b.name, decorative: b.decorative };
        open.set(b.id, fresh);
        if (!runs.has(b.id)) runs.set(b.id, []);
        runs.get(b.id).push(fresh);
      }
    }
  });
  return [...runs.values()].flat();
}

export function checkReadingTime(samples, config, step) {
  const findings = [];
  for (const run of readableRuns(samples, config)) {
    if (run.decorative) continue;
    const shown = (run.end - run.start + 1) * step;
    const need = readingSeconds(run.text);
    if (shown + step / 2 < need) {
      findings.push({ check: "reading-time", level: "error", id: run.id, t: samples[run.start].t, element: run.name,
        message: `${quote(run.text)} is readable for ${shown.toFixed(1)}s; it needs ${need.toFixed(1)}s` });
    }
  }
  return firstPer(findings);
}

/** `measured` is [{ box, bgLum }] for settled text whose frame was read. */
export function checkContrast(measured, config) {
  const short = Math.min(config.width, config.height);
  const findings = [];
  for (const { box: b, bgLum } of measured) {
    if (b.decorative || bgLum === null) continue;
    const rgb = parseRgb(b.color);
    if (!rgb) continue;
    const textLum = luminance(rgb);
    // Translucent text is the text colour mixed into what is behind it.
    const lum = rgb[3] < 1 ? textLum * rgb[3] + bgLum * (1 - rgb[3]) : textLum;
    const r = ratio(lum, bgLum);
    const need = b.fontPx >= short * 0.045 ? 3 : 4.5;
    if (r < need) {
      findings.push({ check: "contrast", level: "error", id: b.id, t: b.t, element: b.name,
        message: `${quote(b.text)} is ${r.toFixed(2)}:1 against what is behind it; needs ${need}:1` });
    }
  }
  return firstPer(findings);
}

/** Frames rendered twice, in a different order, must be the same pixels. */
export function checkDeterminism(first, second) {
  const bad = [];
  for (const [frame, { t, hash }] of first) {
    const again = second.get(frame);
    if (again && again.hash !== hash) bad.push({ frame, t });
  }
  if (!bad.length) return [];
  const list = bad.length > 4 ? `${bad.slice(0, 4).map((b) => b.frame).join(", ")} and ${bad.length - 4} more` : bad.map((b) => b.frame).join(", ");
  return [{ check: "determinism", level: "error", id: "frames", t: bad[0].t, element: `frame ${list}`,
    message: `${bad.length} of ${first.size} frames rendered differently the second time; something depends on render order or the real clock` }];
}

export function format(findings, { file, config, samples }) {
  const lines = [`${file} · ${config.width}×${config.height} · ${config.fps} fps · ${config.duration}s · ${samples} samples`];
  const sorted = [...findings].sort((a, b) => (a.level === b.level ? a.t - b.t : a.level === "error" ? -1 : 1));
  for (const f of sorted) {
    lines.push(`${f.level === "error" ? "✗" : "!"} ${f.check.padEnd(13)} ${fmt(f.t).padStart(7)}  ${f.element}: ${f.message}`);
  }
  const errors = findings.filter((f) => f.level === "error").length;
  const warnings = findings.length - errors;
  lines.push(errors ? `check failed: ${errors} error(s), ${warnings} warning(s)` : `check passed: 0 errors, ${warnings} warning(s)`);
  return lines.join("\n");
}
