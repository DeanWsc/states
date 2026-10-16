// Token tests.
//
// The contract is simple and worth protecting: any colour this module hands out
// must already pass the check it is used for. If a future change lets a token
// ship at 3.9:1, every page built on it fails the audit, and the fix belongs
// here rather than in each stylesheet.
import test from "node:test";
import assert from "node:assert/strict";
import { palette, ensureContrast, mix, shade, readableOn, tokensCss, themesCss, resetCss, reducedMotionCss } from "../kit/tokens.mjs";
import { parse, contrast, composite } from "../kit/color.mjs";

/** WCAG ratio between two colours. */
const ratio = (a, b) => contrast(parse(a), parse(b));

test("ensureContrast leaves a colour that already passes alone", () => {
  const black = ensureContrast("#000000", "#ffffff", { ratio: 4.5 });
  assert.equal(black, "#000000");
});

test("ensureContrast darkens a colour until it passes", () => {
  const out = ensureContrast("#bbbbbb", "#ffffff", { ratio: 4.5 });
  assert.ok(ratio(out, "#ffffff") >= 4.5, `got ${ratio(out, "#ffffff")}`);
  assert.ok(out < "#bbbbbb", "it should have moved darker");
});

test("ensureContrast lightens when that is the shorter way", () => {
  const out = ensureContrast("#333333", "#000000", { ratio: 4.5 });
  assert.ok(ratio(out, "#000000") >= 4.5, `got ${ratio(out, "#000000")}`);
});

test("ensureContrast can reach a hard target", () => {
  // 7:1 is AAA for body text, and some brand palettes genuinely need it.
  const out = ensureContrast("#cccccc", "#ffffff", { ratio: 7 });
  assert.ok(ratio(out, "#ffffff") >= 7, `got ${ratio(out, "#ffffff")}`);
});

test("mix weights toward the second colour", () => {
  // weight 0 is the first colour, 1 is the second.
  assert.deepEqual(mix("#ff0000", "#0000ff", 0), parse("#ff0000"));
  assert.deepEqual(mix("#ff0000", "#0000ff", 1), parse("#0000ff"));
  const mid = mix("#ff0000", "#0000ff", 0.5);
  assert.ok(Math.abs(mid.r - 128) <= 1 && Math.abs(mid.b - 128) <= 1);
  // A 92% surface tint is mostly surface, which is the direction that matters
  // for a soft background.
  const tint = mix("#b42318", "#ffffff", 0.92);
  assert.ok(tint.r > 240, `a soft tint should be pale, got r=${tint.r}`);
});

test("shade moves toward white or black", () => {
  const lighter = shade("#808080", 0.5);
  assert.ok(lighter.r > 128);
  const darker = shade("#808080", -0.5);
  assert.ok(darker.r < 128);
  assert.deepEqual(shade("#808080", 0), parse("#808080"));
});

test("readableOn composites a translucent surface before searching", () => {
  // Text on a half-transparent panel over a dark page is read against the
  // blended result, not against the panel's own colour.
  const surface = composite(parse("rgba(255,255,255,0.5)"), parse("#111827"));
  const out = readableOn("#cccccc", "rgba(255,255,255,0.5)", "#111827", { ratio: 4.5 });
  assert.ok(contrast(parse(out), surface) >= 4.5, `got ${contrast(parse(out), surface)}`);
});

test("the light palette passes every pairing it is meant for", () => {
  const p = palette();
  // Text at 4.5:1.
  for (const token of ["ink", "body", "muted", "faint"]) {
    assert.ok(ratio(p[token], p.surface) >= 4.5, `${token} on surface is ${ratio(p[token], p.surface)}`);
  }
  // Ink on its own fill.
  assert.ok(ratio(p.brandInk, p.brand) >= 4.5);
  // The danger ink is judged on the soft background, which is where it sits.
  assert.ok(ratio(p.dangerInk, p.dangerSoft) >= 4.5);
  assert.ok(ratio(p.body, p.dangerSoft) >= 4.5);
  // Non-text edges only need 3:1, but disabled must stay readable.
  for (const token of ["edge", "focus", "disabled"]) {
    assert.ok(ratio(p[token], p.surface) >= 3, `${token} on surface is ${ratio(p[token], p.surface)}`);
  }
});

test("the dark palette passes every pairing too", () => {
  // Shipping only a light theme is how an interface becomes unreadable at night.
  const p = palette({ surface: "#0e1116", brand: "#7c9cff", danger: "#ff8a80" });
  for (const token of ["ink", "body", "muted", "faint"]) {
    assert.ok(ratio(p[token], p.surface) >= 4.5, `${token} on surface is ${ratio(p[token], p.surface)}`);
  }
  assert.ok(ratio(p.brandInk, p.brand) >= 4.5);
  assert.ok(ratio(p.dangerInk, p.dangerSoft) >= 4.5);
  for (const token of ["edge", "focus"]) {
    assert.ok(ratio(p[token], p.surface) >= 3, `${token} on surface is ${ratio(p[token], p.surface)}`);
  }
});

test("a deliberately terrible brand colour is still made readable", () => {
  // Pale yellow on white is the classic unreadable button. The palette must
  // return an ink that works on it rather than trusting the input.
  const p = palette({ brand: "#f5e642" });
  assert.ok(ratio(p.brandInk, p.brand) >= 4.5, `brandInk ${p.brandInk} on ${p.brand} is ${ratio(p.brandInk, p.brand)}`);
});

test("tokensCss emits custom properties in kebab-case", () => {
  const css = tokensCss({ brandInk: "#fff", body: "#111" });
  assert.match(css, /^:root \{/);
  assert.match(css, /--brand-ink: #fff;/);
  assert.match(css, /--body: #111;/);
});

test("themesCss wraps the dark palette in a media query", () => {
  const css = themesCss(palette(), palette({ surface: "#0e1116" }));
  assert.match(css, /@media \(prefers-color-scheme: dark\)/);
  assert.equal(css.match(/:root \{/g).length, 2);
});

test("the reset includes border-box", () => {
  // Without it, width:100% plus padding overflows every phone. This one line
  // prevents the most common mobile layout bug there is.
  assert.match(resetCss(), /box-sizing: border-box/);
});

test("the reduced-motion block switches off what it must", () => {
  const css = reducedMotionCss();
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(css, /animation-duration: 1ms !important/);
  assert.match(css, /transition-duration: 1ms !important/);
});
