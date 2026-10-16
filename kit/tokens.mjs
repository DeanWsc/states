// Design tokens that cannot fail the audit. No dependencies.
//
// The reason this module exists: a colour palette chosen by eye is a palette
// that will eventually ship a 2.8:1 label. Here a contrast ratio is an input, not
// an outcome. Ask for a text colour at 4.5:1 and you get one, computed by moving
// lightness until it passes.
//
// Everything else here follows the same idea. Spacing is a scale, not a set of
// numbers someone picked. Tap targets are 44px by default because that is the
// number the check enforces.

import { parse as parseColor, contrast, toHex, composite, luminance, wcagLevel } from "./color.mjs";

/** The spacing scale. Every gap in the examples is one of these. */
export const SPACE = {
  0: "0",
  1: "4px",
  2: "8px",
  3: "12px",
  4: "16px",
  5: "20px",
  6: "24px",
  8: "32px",
  10: "40px",
  12: "48px",
  16: "64px",
};

/** The type scale, with the line height that belongs to each step. */
export const TYPE = {
  xs: { size: "12px", line: "1.4", weight: "500" },
  sm: { size: "13px", line: "1.45", weight: "400" },
  base: { size: "15px", line: "1.5", weight: "400" },
  md: { size: "16px", line: "1.5", weight: "400" },
  lg: { size: "18px", line: "1.4", weight: "500" },
  xl: { size: "22px", line: "1.3", weight: "600" },
  "2xl": { size: "28px", line: "1.2", weight: "650" },
  "3xl": { size: "34px", line: "1.15", weight: "700" },
};

export const RADIUS = { none: "0", sm: "6px", md: "8px", lg: "10px", xl: "14px", full: "999px" };

/** The size the audit enforces. */
export const TAP = "44px";

/**
 * How much lighter or darker a colour is, on a 0..1 scale.
 * Positive lightens toward white, negative darkens toward black.
 */
export function shade(color, amount) {
  const c = typeof color === "string" ? parseColor(color) : color;
  if (!c) return null;
  const target = amount > 0 ? { r: 255, g: 255, b: 255 } : { r: 0, g: 0, b: 0 };
  const t = Math.abs(amount);
  return {
    r: Math.round(c.r + (target.r - c.r) * t),
    g: Math.round(c.g + (target.g - c.g) * t),
    b: Math.round(c.b + (target.b - c.b) * t),
    a: 1,
  };
}

/**
 * The surface a soft fill actually appears as when it sits inside a tinted row.
 *
 * A status pill inside a selected row is not on `--ok-soft`. It is on
 * `--ok-soft` composited over `--selected`, which is a third colour that nobody
 * chose and everybody has to read against. This is where a palette quietly
 * drops under 4.5:1 without anybody noticing.
 */
export function softOn(softBase, tint) {
  const soft = typeof softBase === "string" ? parseColor(softBase) : softBase;
  const under = typeof tint === "string" ? parseColor(tint) : tint;
  if (!soft || !under) return null;
  return composite(soft, under);
}

/**
 * Mix two colours in sRGB.
 *
 * `weight` is how much of `b` ends up in the result: 0 gives `a`, 1 gives `b`,
 * and 0.5 is the even blend. So a 92% surface tint is mix(danger, surface, 0.92),
 * which reads backwards if you imagine the weight as belonging to `a`.
 */
export function mix(a, b, weight = 0.5) {
  const ca = typeof a === "string" ? parseColor(a) : a;
  const cb = typeof b === "string" ? parseColor(b) : b;
  if (!ca || !cb) return null;
  const w = clamp01(weight);
  return {
    r: Math.round(ca.r + (cb.r - ca.r) * w),
    g: Math.round(ca.g + (cb.g - ca.g) * w),
    b: Math.round(ca.b + (cb.b - ca.b) * w),
    a: 1,
  };
}

const clamp01 = (n) => (n < 0 ? 0 : n > 1 ? 1 : n);

/**
 * Move a colour along its lightness until it reaches a contrast ratio against
 * `background`, searching whichever direction is shorter.
 *
 * Returns the original colour when it already passes, so a palette that is
 * already correct is left alone. This is the function that makes "readable" a
 * parameter instead of a hope.
 */
export function ensureContrast(foreground, background, { ratio = 4.5, steps = 100 } = {}) {
  const fg = typeof foreground === "string" ? parseColor(foreground) : foreground;
  const bg = typeof background === "string" ? parseColor(background) : background;
  if (!fg || !bg) return null;

  if (contrast(fg, bg) >= ratio) return toHex(fg);

  // Whichever way needs less movement.
  const towardsWhite = contrast(shade(fg, 1), bg);
  const towardsBlack = contrast(shade(fg, -1), bg);
  const direction = towardsWhite >= towardsBlack ? 1 : -1;

  let best = fg;
  for (let i = 1; i <= steps; i++) {
    const candidate = shade(fg, direction * (i / steps));
    if (contrast(candidate, bg) >= ratio) return toHex(candidate);
    best = candidate;
  }
  return toHex(best);
}

/**
 * A text colour that is readable on a translucent surface.
 *
 * Over a background that is itself translucent, the text must be composited
 * against the real result, which is what this does before searching.
 */
export function readableOn(fg, layeredBackground, backdrop, { ratio = 4.5 } = {}) {
  const surface = composite(
    typeof layeredBackground === "string" ? parseColor(layeredBackground) : layeredBackground,
    typeof backdrop === "string" ? parseColor(backdrop) : backdrop,
  );
  return ensureContrast(fg, surface, { ratio });
}

/**
 * Build a full palette for a theme.
 *
 * The point is that every token in here is guaranteed to pass the contrast check
 * it is used for: body text at 4.5, large text and non-text edges at 3.
 */
export function palette({
  surface = "#ffffff",
  brand = "#1d4ed8",
  danger = "#b42318",
  ok = "#15803d",
  warn = "#a16207",
} = {}) {
  const ink = ensureContrast("#111111", surface, { ratio: 15 });
  const body = ensureContrast("#1a1a1a", surface, { ratio: 4.5 });
  const muted = ensureContrast("#3f4652", surface, { ratio: 4.5 });
  const faint = ensureContrast("#5b6472", surface, { ratio: 4.5 });

  const brandInk = ensureContrast("#ffffff", brand, { ratio: 4.5 });
  const brandHover = toHex(shade(brand, -0.12));
  const brandQuiet = ensureContrast(brand, surface, { ratio: 4.5 });

  const dangerInk = ensureContrast("#5c120c", surface, { ratio: 4.5 });
  // A soft background is mostly surface with a little danger in it. The weight
  // belongs to the second colour, so this is 92% surface.
  const dangerSoft = toHex(mix(danger, surface, 0.92));
  // The ink that sits on that soft background must still be readable on it,
  // which is a different question from being readable on the page.
  const dangerOnSoft = ensureContrast(dangerInk, dangerSoft, { ratio: 4.5 });
  const dangerEdge = ensureContrast(danger, surface, { ratio: 3 });

  // Row tints.
  //
  // A tint is not free: it sits under text, so the text colour has to be
  // judged against the tinted row and not against the plain surface.
  //
  // The weight is the share of the *second* colour, so a faint wash is a high
  // number: mix(brand, surface, 0.92) is 8% brand on 92% paper. Getting this
  // backwards produces a nearly solid blue row, which is both ugly and 3:1
  // instead of 12:1 under the text.
  const hover = toHex(mix("#808080", surface, 0.94));
  const bodyOnHover = ensureContrast(body, hover, { ratio: 4.5 });
  const mutedOnHover = ensureContrast(muted, hover, { ratio: 4.5 });
  const selected = toHex(mix(brand, surface, 0.92));
  const bodyOnSelected = ensureContrast(body, selected, { ratio: 4.5 });
  const mutedOnSelected = ensureContrast(muted, selected, { ratio: 4.5 });

  // Status inks, judged on their own soft backgrounds, and on the tint too:
  // a status pill inside a selected row sits on the tint, not the surface.
  const okSoft = toHex(mix(ok, surface, 0.92));
  const okInk = ensureContrast(ok, okSoft, { ratio: 4.5 });
  const okInkOnSelected = ensureContrast(ok, selected, { ratio: 4.5 });
  const warnSoft = toHex(mix(warn, surface, 0.92));
  const warnInk = ensureContrast(warn, warnSoft, { ratio: 4.5 });
  const warnInkOnSelected = ensureContrast(warn, selected, { ratio: 4.5 });
  const dangerInkOnSelected = ensureContrast(dangerInk, selected, { ratio: 4.5 });

  // A non-text edge needs 3:1 to be perceivable at all.
  const edge = ensureContrast("#8a919d", surface, { ratio: 3 });
  const edgeStrong = ensureContrast("#5d6470", surface, { ratio: 3 });
  const focus = ensureContrast(brand, surface, { ratio: 3 });

  const disabledSurface = toHex(mix(edge, surface, 0.55));

  // A control inside a tinted row: its fill is the quiet button's, which is
  // transparent, so what it sits on is the tint itself. The border and the
  // label are both judged there.
  const bodyOnSelectedFill = ensureContrast(body, selected, { ratio: 4.5 });
  const edgeStrongOnSelected = ensureContrast(edgeStrong, selected, { ratio: 3 });

  return {
    surface,
    ink,
    body,
    muted,
    faint,
    edge,
    edgeStrong,
    hover,
    selected,
    // Text colours re-judged against the tints, so a row keeps its contrast
    // when it is hovered or selected rather than only at rest.
    bodyOnHover,
    mutedOnHover,
    bodyOnSelected,
    mutedOnSelected,
    bodyOnBrandSoft: bodyOnSelectedFill,
    edgeStrongOnSelected,
    brand,
    brandInk,
    brandHover,
    brandQuiet,
    focus,
    danger: dangerEdge,
    dangerInk: dangerOnSoft,
    dangerInkOnSelected,
    dangerSoft,
    okSoft,
    okInk,
    okInkOnSelected,
    warnSoft,
    warnInk,
    warnInkOnSelected,
    // The fill a disabled control sits on. Pale, so it reads as unavailable
    // rather than as a button you are meant to press.
    disabledSurface,
    // Disabled text is exempt from 1.4.3, but a label nobody can read is a bug
    // people notice. 3:1 keeps it legible without pretending it is active.
    disabled: ensureContrast(muted, disabledSurface, { ratio: 3.2 }),
  };
}

/**
 * Render a palette as CSS custom properties, for a :root block.
 * `indent` keeps it readable when embedded in a stylesheet.
 */
export function tokensCss(p, { indent = "  ", selector = ":root" } = {}) {
  const lines = [`${selector} {`];
  for (const [name, value] of Object.entries(p)) {
    const prop = `--${name.replace(/[A-Z]/g, (m) => `-${m.toLowerCase()}`)}`;
    lines.push(`${indent}${prop}: ${value};`);
  }
  lines.push("}");
  return lines.join("\n");
}

/**
 * Both themes as one block: light by default, dark under the media query.
 * Shipping only light is how an interface ends up unreadable at 11pm.
 */
export function themesCss(light, dark, { indent = "  " } = {}) {
  return [
    tokensCss(light, { indent }),
    "",
    `${indent}@media (prefers-color-scheme: dark) {`,
    tokensCss(dark, { indent: indent + "  ", selector: ":root" }).split("\n").map((l) => (l ? indent + l : l)).join("\n"),
    `${indent}}`,
  ].join("\n");
}

/**
 * The reset every page in this skill starts with.
 *
 * `box-sizing: border-box` is not optional decoration. A `width: 100%` input
 * with horizontal padding is 30px wider than its container without it, and that
 * is the single most common cause of a page that scrolls sideways on a phone.
 */
export function resetCss({ indent = "  " } = {}) {
  return [
    `${indent}*, *::before, *::after { box-sizing: border-box; }`,
    `${indent}body { margin: 0; }`,
    `${indent}img, svg, video { display: block; max-width: 100%; }`,
    `${indent}input, button, textarea, select { font: inherit; }`,
  ].join("\n");
}

/**
 * The focus ring, generated so it always clears 3:1 against its own surface.
 * A ring nobody can see is the same as no ring.
 */
export function focusRing(p, { width = 2, offset = 2 } = {}) {
  return [
    `:focus-visible {`,
    `  outline: ${width}px solid ${p.focus};`,
    `  outline-offset: ${offset}px;`,
    `}`,
  ].join("\n");
}

/**
 * The reduced-motion block. Put it at the end of the stylesheet so it wins
 * without needing !important everywhere.
 */
export function reducedMotionCss({ indent = "  " } = {}) {
  return [
    `${indent}@media (prefers-reduced-motion: reduce) {`,
    `${indent}  *, *::before, *::after {`,
    `${indent}    animation-duration: 1ms !important;`,
    `${indent}    animation-iteration-count: 1 !important;`,
    `${indent}    transition-duration: 1ms !important;`,
    `${indent}    scroll-behavior: auto !important;`,
    `${indent}  }`,
    `${indent}}`,
  ].join("\n");
}

export { contrast, toHex, wcagLevel };
