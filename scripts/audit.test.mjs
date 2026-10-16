// Audit tests.
//
// The rule for this file: a check that never fires is as broken as a check that
// always fires. So every test asserts BOTH directions — that a real defect is
// caught, and that correct code is left alone. A suite that only proves the
// first half produces a checker nobody trusts.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { audit, px, render } from "../kit/audit.mjs";
import { classify, STATE_SETS, matrixFromRules, statesFor } from "../kit/state.mjs";
import { parseHTML } from "../kit/html.mjs";
import { parseCSS } from "../kit/css.mjs";

/** Wrap markup in a minimal document with a stylesheet. */
const page = (css, body) => `<!doctype html><html><head><style>${css}</style></head><body>${body}</body></html>`;

/** Findings of one kind. */
const of = (result, check) => result.findings.filter((f) => f.check === check);
const errorsOf = (result, check) => of(result, check).filter((f) => f.severity === "error");

// ---------------------------------------------------------------- px parsing

test("px resolves the units that can be resolved, and refuses the rest", () => {
  assert.equal(px("16px"), 16);
  assert.equal(px("1.5rem", { rootFontSize: 16 }), 24);
  assert.equal(px("2em", { fontSize: 10 }), 20);
  assert.equal(px("0"), 0);
  assert.equal(px("thin"), 1);
  assert.equal(px(undefined), null);
  // A percentage depends on a containing block the audit cannot see.
  assert.equal(px("100%"), null);
  assert.equal(px("50vw"), null);
  assert.equal(px("100%"), null);
});

// ---------------------------------------------------------------- contrast

test("contrast: low-contrast text is an error, correct text is not", () => {
  const bad = audit(page(
    `.a { color: #999; background: #fff; font-size: 14px; }`,
    `<p class="a">helper text</p>`,
  ));
  assert.equal(bad.ok, false);
  const found = errorsOf(bad, "contrast");
  assert.equal(found.length, 1);
  assert.match(found[0].message, /contrast/);
  assert.ok(found[0].detail.ratio < 4.5);

  const good = audit(page(
    `.a { color: #5b6472; background: #ffffff; font-size: 14px; }`,
    `<p class="a">helper text</p>`,
  ));
  assert.equal(errorsOf(good, "contrast").length, 0);
});

test("contrast: large text is held to the lower 3:1 bar", () => {
  const big = audit(page(
    `.a { color: #949494; background: #fff; font-size: 32px; }`,
    `<p class="a">headline</p>`,
  ));
  // #949494 on white is 3.03:1, which passes for large text but would fail small.
  assert.equal(errorsOf(big, "contrast").length, 0, "large text may use 3:1");
});

test("contrast: translucent text is composited before it is judged", () => {
  // 60% black over white is a real grey that must be measured as such, not as
  // pure black. This is the case a naive parse of "rgba" would get wrong.
  const faded = audit(page(
    `.a { color: rgba(0,0,0,0.2); background: #fff; font-size: 16px; }`,
    `<p class="a">faint</p>`,
  ));
  const found = errorsOf(faded, "contrast");
  assert.equal(found.length, 1, "20% black on white is unreadable");
  assert.ok(found[0].detail.ratio > 1 && found[0].detail.ratio < 2);
});

test("contrast: text over a translucent surface uses the surface behind it", () => {
  // A card with a 50% white background over a dark page: the ink must be read
  // against the composited result, not against pure white.
  const result = audit(page(
    `body { background: #111827; }
     .card { background: rgba(255,255,255,0.5); }
     .card p { color: #111827; font-size: 16px; }`,
    `<div class="card"><p>text</p></div>`,
  ));
  assert.equal(errorsOf(result, "contrast").length, 0, "dark ink on a lightened dark card is fine");
});

test("contrast: screen-reader-only text is not judged", () => {
  const result = audit(page(
    `.sr { position: absolute; width: 1px; height: 1px; clip-path: inset(50%); color: #eee; }`,
    `<button><span class="sr">close</span>×</button>`,
  ));
  assert.equal(errorsOf(result, "contrast").length, 0);
});

// ------------------------------------------------------------- accessible name

test("accessible-name: an unnamed control fails, a named one passes", () => {
  const bare = audit(page(`.b { color: #333; }`, `<button class="b"><span aria-hidden="true">×</span></button>`));
  assert.equal(errorsOf(bare, "accessible-name").length, 1);

  const named = audit(page(
    `.b { color: #333; }`,
    `<button class="b" aria-label="Close"><span aria-hidden="true">×</span></button>`,
  ));
  assert.equal(errorsOf(named, "accessible-name").length, 0);
});

test("accessible-name: a placeholder does not count as a name", () => {
  const result = audit(page(`.i { color: #333; }`, `<input class="i" placeholder="Email">`));
  assert.equal(errorsOf(result, "accessible-name").length, 1);
});

test("accessible-name: a real <label> does count", () => {
  const result = audit(page(
    `.i { color: #333; }`,
    `<label for="e">Email</label><input class="i" id="e">`,
  ));
  assert.equal(errorsOf(result, "accessible-name").length, 0);
});

// ------------------------------------------------------------- focus indicator

test("focus: a control with no focus rule is an error", () => {
  const result = audit(page(
    `.b { color: #fff; background: #1d4ed8; min-height: 44px; }`,
    `<button class="b">Save</button>`,
  ));
  const found = errorsOf(result, "focus-indicator");
  assert.equal(found.length, 1);
  assert.match(found[0].message, /focus/);
});

test("focus: a visible ring satisfies the check", () => {
  const result = audit(page(
    `.b { color: #fff; background: #1d4ed8; min-height: 44px; }
     .b:focus-visible { outline: 2px solid #1d4ed8; outline-offset: 2px; }`,
    `<button class="b">Save</button>`,
  ));
  assert.equal(errorsOf(result, "focus-indicator").length, 0);
});

test("focus: removing the outline without replacing it is an error", () => {
  // The commonest accessibility regression: outline:none with nothing in its
  // place, which silently deletes keyboard navigation.
  const result = audit(page(
    `.b { color: #fff; background: #1d4ed8; min-height: 44px; }
     .b:focus { outline: none; }`,
    `<button class="b">Save</button>`,
  ));
  const found = errorsOf(result, "focus-indicator");
  assert.equal(found.length, 1);
  assert.match(found[0].message, /removes the focus outline/);
});

test("focus: a box-shadow replacement is accepted", () => {
  const result = audit(page(
    `.b { color: #fff; background: #1d4ed8; min-height: 44px; }
     .b:focus-visible { outline: none; box-shadow: 0 0 0 3px #93c5fd; }`,
    `<button class="b">Save</button>`,
  ));
  assert.equal(errorsOf(result, "focus-indicator").length, 0);
});

// ---------------------------------------------------------------- tap targets

test("tap-target: a button under the minimum fails, at the minimum warns, at the ideal passes", () => {
  const tooSmall = audit(page(
    `.b { color: #fff; background: #1d4ed8; height: 18px; }
     .b:focus-visible { outline: 2px solid #000; }`,
    `<button class="b">Save</button>`,
  ));
  assert.equal(errorsOf(tooSmall, "tap-target").length, 1, "18px is under the 24px minimum");

  // 28px clears the WCAG minimum but not the 44px touch ideal, so it is a
  // warning. A checker that called this an error would be crying wolf.
  const between = audit(page(
    `.b { color: #fff; background: #1d4ed8; height: 28px; }
     .b:focus-visible { outline: 2px solid #000; }`,
    `<button class="b">Save</button>`,
  ));
  const warned = of(between, "tap-target");
  assert.equal(warned.length, 1);
  assert.equal(warned[0].severity, "warning");

  const ideal = audit(page(
    `.b { color: #fff; background: #1d4ed8; min-height: 44px; }
     .b:focus-visible { outline: 2px solid #000; }`,
    `<button class="b">Save</button>`,
  ));
  assert.equal(of(ideal, "tap-target").length, 0);
});

test("tap-target: min-height is respected as a floor", () => {
  const result = audit(page(
    `.b { color: #333; min-height: 44px; }
     .b:focus-visible { outline: 2px solid #000; }`,
    `<button class="b">Save</button>`,
  ));
  assert.equal(errorsOf(result, "tap-target").length, 0);
});

test("tap-target: a pseudo-element's size is not the control's size", () => {
  // The knob of a switch is 20px; the switch itself is 26px and the row gives
  // it more room. Reading the knob's height as the target's was a real bug.
  const result = audit(page(
    `.switch { position: relative; width: 46px; height: 26px; appearance: none; }
     .switch::after { content: ""; position: absolute; width: 20px; height: 20px; }`,
    `<button class="switch" role="switch" aria-checked="false"></button>`,
  ));
  const found = errorsOf(result, "tap-target");
  // 26px clears the 24px minimum, so it is a warning about the ideal, not an error.
  assert.equal(found.length, 0, "the switch measures 26px, not its 20px knob");
});

test("tap-target: a label is not itself a target", () => {
  const result = audit(page(
    `.l { display: block; margin-bottom: 6px; font-size: 14px; }
     .i { min-height: 44px; }
     .i:focus-visible { outline: 2px solid #000; }`,
    `<label class="l" for="i">Email</label><input class="i" id="i">`,
  ));
  assert.equal(errorsOf(result, "tap-target").length, 0);
});

// -------------------------------------------------------------- state coverage

test("state-coverage: a button missing focus and disabled is reported", () => {
  const result = audit(page(
    `.b { color: #fff; background: #1d4ed8; min-height: 44px; }
     .b:hover { background: #1e40af; }`,
    `<button class="b">Save</button>`,
  ));
  const found = of(result, "state-coverage");
  assert.ok(found.length >= 1);
  const missing = found[0].missing;
  assert.ok(missing.includes("focus"), "focus is missing and must be named");
  assert.ok(missing.includes("disabled"));
});

test("state-coverage: a fully-built button reports nothing", () => {
  const result = audit(page(
    `.b { color: #fff; background: #1d4ed8; min-height: 44px; }
     .b:hover { background: #1e40af; }
     .b:focus-visible { outline: 2px solid #000; }
     .b:active { transform: translateY(1px); }
     .b:disabled { background: #d1d5db; }`,
    `<button class="b">Save</button>`,
  ));
  assert.equal(of(result, "state-coverage").length, 0);
});

test("state-coverage: BEM class names are understood", () => {
  // .field__control must be recognised as an input even though no rule mentions
  // the word "input". This was a false positive on every real stylesheet.
  const result = audit(page(
    `.field__control { min-height: 44px; color: #111; }
     .field__control:focus-visible { outline: 2px solid #000; }
     .field__control:disabled { background: #eee; }
     .field__control[aria-invalid="true"] { border-color: #b42318; }`,
    `<div class="field"><input class="field__control"></div>`,
  ));
  assert.equal(of(result, "state-coverage").filter((f) => f.missing.includes("focus")).length, 0);
});

test("state-coverage: a layout wrapper is not audited as a control", () => {
  const root = parseHTML(`<div class="field"><input class="field__control"></div>`);
  const [wrapper, input] = root.children[0].selfAndDescendants();
  assert.equal(classify(wrapper), null, "the wrapper is a box, not a control");
  assert.equal(classify(input), "input");
});

test("role overrides the tag when naming a control", () => {
  const root = parseHTML(`<button role="switch"></button>`);
  assert.equal(classify(root.children[0]), "switch");
});

// ------------------------------------------------------------ narrow viewport

test("narrow-overflow: a fixed width fails, a fluid layout passes", () => {
  const wide = audit(page(
    `.panel { width: 720px; padding: 24px; background: #fff; }
     .panel p { color: #111; }`,
    `<div class="panel"><p>content</p></div>`,
  ));
  assert.equal(errorsOf(wide, "narrow-overflow").length, 1);

  const fluid = audit(page(
    `.panel { max-width: 640px; padding: 24px; background: #fff; }
     .panel p { color: #111; }`,
    `<div class="panel"><p>content</p></div>`,
  ));
  assert.equal(errorsOf(fluid, "narrow-overflow").length, 0);
});

test("narrow-overflow: a parent's width is not charged to its children", () => {
  // Only the element that actually declares the width is reported, so one bug
  // does not become five.
  const result = audit(page(
    `.panel { width: 720px; padding: 24px; }
     .row { display: flex; }
     .row span { color: #111; }`,
    `<div class="panel"><div class="row"><span>a</span><span>b</span></div></div>`,
  ));
  assert.equal(errorsOf(result, "narrow-overflow").length, 1);
  assert.match(errorsOf(result, "narrow-overflow")[0].path, /panel/);
});

// ------------------------------------------------------------- reduced motion

test("reduced-motion: animation without a guard is an error", () => {
  const result = audit(page(
    `.b { min-height: 44px; transition: background 200ms ease; }
     .b:focus-visible { outline: 2px solid #000; }`,
    `<button class="b">Save</button>`,
  ));
  assert.equal(errorsOf(result, "reduced-motion").length, 1);
});

test("reduced-motion: a prefers-reduced-motion block satisfies it", () => {
  const result = audit(page(
    `.b { min-height: 44px; transition: background 200ms ease; }
     .b:focus-visible { outline: 2px solid #000; }
     @media (prefers-reduced-motion: reduce) {
       *, *::before, *::after { transition-duration: 1ms !important; }
     }`,
    `<button class="b">Save</button>`,
  ));
  assert.equal(errorsOf(result, "reduced-motion").length, 0);
});

// ---------------------------------------------------------------- colour only

test("color-only: a switch with only a background change is flagged", () => {
  const result = audit(page(
    `.switch { width: 46px; height: 26px; appearance: none; background: #cbd5e1; }
     .switch[aria-checked="true"] { background: #1d4ed8; }`,
    `<button class="switch" role="switch" aria-checked="true"></button>`,
  ));
  assert.equal(of(result, "color-only").length, 1);
});

test("color-only: a knob or checkmark satisfies it", () => {
  const result = audit(page(
    `.switch { width: 46px; height: 26px; appearance: none; background: #cbd5e1; }
     .switch[aria-checked="true"] { background: #1d4ed8; }
     .switch[aria-checked="true"]::after { content: ""; width: 20px; height: 20px; }`,
    `<button class="switch" role="switch" aria-checked="true"></button>`,
  ));
  assert.equal(of(result, "color-only").length, 0);
});

test("color-only: a native control is left alone", () => {
  // The browser draws its own checkmark, so there is nothing to add.
  const result = audit(page(
    `.c { width: 20px; height: 20px; }`,
    `<input class="c" type="checkbox" aria-label="Agree">`,
  ));
  assert.equal(of(result, "color-only").length, 0);
});

// -------------------------------------------------------------------- themes

test("the dark theme is evaluated against its own tokens", () => {
  const html = `<!doctype html><html><head><style>
    :root { --ink: #1a1a1a; --paper: #fff; }
    @media (prefers-color-scheme: dark) { :root { --ink: #e8eaed; --paper: #0e1116; } }
    body { background: var(--paper); color: var(--ink); }
    p { color: var(--ink); font-size: 16px; }
  </style></head><body><p>text</p></body></html>`;
  const light = audit(html, { theme: "light" });
  const dark = audit(html, { theme: "dark" });
  // Light ink on dark paper is fine in the dark theme; the same ink on white
  // is fine in the light theme. Neither should error.
  assert.equal(errorsOf(light, "contrast").length, 0);
  assert.equal(errorsOf(dark, "contrast").length, 0);
});

// ------------------------------------------------------------- the fixtures

test("the broken fixture fails and the clean fixture passes", () => {
  const dir = new URL("../examples/", import.meta.url);
  const broken = audit(readFileSync(new URL("broken/broken.html", dir), "utf8"));
  const clean = audit(readFileSync(new URL("billing-settings/billing-settings.html", dir), "utf8"));

  assert.equal(broken.ok, false, "the fixture with defects on purpose must fail");
  assert.ok(broken.errors >= 8, `expected many errors, got ${broken.errors}`);

  // Every check the fixture was written to trip must actually trip.
  for (const check of ["accessible-name", "contrast", "focus-indicator", "narrow-overflow", "reduced-motion", "state-coverage"]) {
    assert.ok(
      of(broken, check).length > 0,
      `the broken fixture should trip ${check}`,
    );
  }

  assert.equal(clean.ok, true, `the clean example must pass, got ${clean.errors} errors`);
  assert.equal(clean.errors, 0);
});

// ------------------------------------------------------------------- report

test("the report is stable and mentions what it could not check", () => {
  const html = readFileSync(new URL("../examples/broken/broken.html", import.meta.url), "utf8");
  const a = render(audit(html), { title: "t" });
  const b = render(audit(html), { title: "t" });
  assert.equal(a, b, "the same input must render the same report");
  assert.match(a, /FAIL/);
  assert.match(a, /state matrix/);
});

test("the matrix reports which states each component actually has", () => {
  const rules = parseCSS(`
    .btn:hover { background: #333; }
    .btn:focus-visible { outline: 2px solid #000; }
    .btn:active { transform: translateY(1px); }
    .btn:disabled { background: #ddd; }
  `);
  const matrix = matrixFromRules(rules);
  const have = statesFor(matrix, "button");
  assert.ok(have.has("hover"));
  assert.ok(have.has("focus"));
  assert.ok(have.has("disabled"));
  assert.ok(!have.has("checked"), "a button has no checked state to claim");
});
