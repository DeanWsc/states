// Colour engine tests. These are the values from the WCAG 2.1 and CSS Color 4
// specifications, so a mistake here is a mistake in the audit itself.
import test from "node:test";
import assert from "node:assert/strict";
import { parse, contrast, composite, luminance, wcagLevel, toHex, hueDistance } from "../kit/color.mjs";

/**
 * Compare colour channels with a tolerance. Missing channels on `want` default
 * to 0, so a test can write just the channels it cares about.
 */
const near = (got, want, tol = 1) => {
  assert.ok(got, "parse() returned null");
  for (const k of ["r", "g", "b"]) {
    const w = want[k] ?? 0;
    assert.ok(Math.abs(got[k] - w) <= tol, `channel ${k}: got ${got[k]} want ${w}`);
  }
};

test("hex colours", () => {
  assert.deepEqual(parse("#f00"), { r: 255, g: 0, b: 0, a: 1 });
  assert.deepEqual(parse("#ff0000"), { r: 255, g: 0, b: 0, a: 1 });
  assert.deepEqual(parse("#abc"), { r: 170, g: 187, b: 204, a: 1 });
  // Four digits are the #rgba shorthand, not an error: #ff00 is r,g,b,alpha.
  assert.deepEqual(parse("#ff00"), { r: 255, g: 255, b: 0, a: 0 });
  assert.equal(parse("#f00f").a.toFixed(2), "1.00");
  assert.equal(parse("#f000").a, 0);
  // Five and seven digits are invalid, and must not fall through.
  assert.equal(parse("#ff000"), null);
  assert.equal(parse("#ff00000"), null);
  assert.equal(parse("#gggggg"), null);
});

test("functional rgb in both syntaxes", () => {
  const want = { r: 255, g: 0, b: 0 };
  near(parse("rgb(255, 0, 0)"), want);
  near(parse("rgb(255 0 0)"), want);
  near(parse("rgba(255, 0, 0, 1)"), want);
  near(parse("rgb(100% 0% 0%)"), want);
});

test("alpha survives every syntax", () => {
  // This is the case that broke first: the slash must be found even when the
  // arguments use modern whitespace syntax and never mention commas.
  assert.equal(parse("rgb(255 0 0 / 50%)").a, 0.5);
  assert.equal(parse("rgba(255, 0, 0, 0.5)").a, 0.5);
  assert.equal(parse("rgba(255, 0, 0, .5)").a, 0.5);
  assert.equal(parse("rgb(255 0 0 / 0.25)").a, 0.25);
  assert.equal(parse("rgb(0 0 0/50%)").a, 0.5, "slash glued to the value");
  assert.equal(parse("rgb(0, 0, 0, 1)").a, 1);
  assert.equal(parse("hsl(0 100% 50% / 30%)").a, 0.3);
});

test("hsl and hwb", () => {
  assert.deepEqual(parse("hsl(0, 100%, 50%)"), { r: 255, g: 0, b: 0, a: 1 });
  assert.deepEqual(parse("hsl(120, 100%, 50%)"), { r: 0, g: 255, b: 0, a: 1 });
  assert.deepEqual(parse("hsl(240, 100%, 50%)"), { r: 0, g: 0, b: 255, a: 1 });
  near(parse("hsl(0, 0%, 100%)"), { r: 255, g: 255, b: 255 });
  near(parse("hsl(0, 0%, 0%)"), { r: 0, g: 0, b: 0 });
  assert.deepEqual(parse("hwb(0 0% 0%)"), { r: 255, g: 0, b: 0, a: 1 });
  near(parse("hwb(0 100% 0%)"), { r: 255, g: 255, b: 255 });
});

test("css color 4 spaces match the specification", () => {
  // Pure red is oklch(0.6280 0.2577 29.23) and lab(54.29% 80.80 69.89).
  near(parse("oklch(0.6280 0.2577 29.2339)"), { r: 255, g: 0, b: 0 }, 1);
  near(parse("oklch(1 0 0)"), { r: 255, g: 255, b: 255 }, 1);
  near(parse("oklch(0 0 0)"), { r: 0, g: 0, b: 0 }, 1);
  near(parse("lab(100% 0 0)"), { r: 255, g: 255, b: 255 }, 1);
  near(parse("lab(0% 0 0)"), { r: 0, g: 0, b: 0 }, 1);
  // Pure red is lab(54.29% 80.80 69.89), which only lands on rgb(255,0,0)
  // with the D50 white point. This assertion guards that choice.
  near(parse("lab(54.29% 80.8 69.89)"), { r: 255, g: 0, b: 0 }, 1);
  // The same colour as lch, which carries chroma (magnitude) and hue in place
  // of a and b: C = hypot(80.80, 69.89) = 106.84, H = atan2(69.89, 80.80) = 40.86.
  near(parse("lch(54.29% 106.84 40.86)"), { r: 255, g: 0, b: 0 }, 1);
});

test("named colours and unparseable input", () => {
  assert.deepEqual(parse("white"), { r: 255, g: 255, b: 255, a: 1 });
  assert.deepEqual(parse("rebeccapurple"), { r: 102, g: 51, b: 153, a: 1 });
  assert.equal(parse("transparent").a, 0);
  assert.equal(parse("currentColor"), null);
  assert.equal(parse("inherit"), null);
  assert.equal(parse("var(--x)"), null);
  assert.equal(parse("nonsense"), null);
  assert.equal(parse(""), null);
  assert.equal(parse(undefined), null);
});

test("wcag 2.1 contrast ratios against published values", () => {
  const ratio = (a, b) => contrast(parse(a), parse(b));
  assert.equal(ratio("#000", "#fff").toFixed(2), "21.00");
  assert.equal(ratio("#fff", "#000").toFixed(2), "21.00");
  assert.equal(ratio("#777777", "#ffffff").toFixed(2), "4.48");
  assert.equal(ratio("#767676", "#ffffff").toFixed(2), "4.54");
  assert.equal(ratio("#595959", "#ffffff").toFixed(2), "7.00");
  assert.equal(ratio("#000000", "#ff0000").toFixed(2), "5.25");
  assert.equal(ratio("#ffffff", "#ff0000").toFixed(3), "3.998");
  assert.equal(ratio("#ffffff", "#0000ff").toFixed(2), "8.59");
});

test("contrast is symmetric and bounded", () => {
  const a = parse("#3b82f6");
  const b = parse("#111827");
  assert.equal(contrast(a, b).toFixed(6), contrast(b, a).toFixed(6));
  const same = contrast(a, a);
  assert.ok(Math.abs(same - 1) < 1e-9, "a colour against itself is 1:1");
  assert.ok(contrast(parse("#000"), parse("#fff")) <= 21);
});

test("relative luminance reference values", () => {
  assert.equal(luminance(parse("#000")).toFixed(4), "0.0000");
  assert.equal(luminance(parse("#fff")).toFixed(4), "1.0000");
  assert.ok(Math.abs(luminance(parse("#808080")) - 0.2158) < 0.001);
});

test("compositing is real alpha blending, not a passthrough", () => {
  // 60% white over #111 is a mid grey, not white. This was the second bug:
  // a broken alpha parse made composite() return the foreground unchanged.
  const out = composite(parse("rgba(255,255,255,0.6)"), parse("#111111"));
  assert.ok(Math.abs(out.r - 0xa0) <= 1, `got ${toHex(out)}`);
  assert.equal(out.a, 1, "the result is opaque");
  // Opaque foreground is returned untouched.
  assert.deepEqual(composite(parse("#abcdef"), parse("#000000")), parse("#abcdef"));
  // Fully transparent shows the backdrop.
  assert.deepEqual(composite(parse("rgba(0,0,0,0)"), parse("#334455")), parse("#334455"));
  // The blend must land between the two endpoints.
  const mid = composite(parse("rgba(255,255,255,0.5)"), parse("#000000"));
  assert.ok(mid.r > 120 && mid.r < 136, `mid grey expected, got ${mid.r}`);
});

test("wcag level thresholds depend on text size", () => {
  assert.equal(wcagLevel(4.6, { size: 14 }), "AA");
  assert.equal(wcagLevel(4.4, { size: 14 }), "AA-large");
  assert.equal(wcagLevel(4.4, { size: 24 }), "AA");
  assert.equal(wcagLevel(7.1, { size: 14 }), "AAA");
  assert.equal(wcagLevel(7, { size: 14 }), "AAA");
  assert.equal(wcagLevel(6.9, { size: 14 }), "AA");
  // Inactive controls are exempt from 1.4.3.
  assert.equal(wcagLevel(1.2, { size: 14, disabled: true }), "exempt");
  // 18.66px bold counts as large text.
  assert.equal(wcagLevel(3.5, { size: 19, bold: true }), "AA");
});

test("hue distance separates colour-only signalling", () => {
  assert.equal(Math.round(hueDistance(parse("red"), parse("lime"))), 120);
  assert.equal(hueDistance(parse("#ff0000"), parse("#ff0000")), 0);
  // Grey has no hue, so the pair is distinguished by lightness alone.
  assert.equal(hueDistance(parse("#888"), parse("#aaa")), null);
});
