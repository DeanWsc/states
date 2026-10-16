// CSS parsing and cascade tests.
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseCSS, specificity, matches, computeStyle, matchNth, statesOf,
  resolveVars, parseDeclarations, conditionHolds,
} from "../kit/css.mjs";
import { parseHTML, findById } from "../kit/html.mjs";

test("specificity follows the spec order", () => {
  assert.deepEqual(specificity("div"), [0, 0, 1]);
  assert.deepEqual(specificity(".card"), [0, 1, 0]);
  assert.deepEqual(specificity("#main"), [1, 0, 0]);
  assert.deepEqual(specificity("div.card"), [0, 1, 1]);
  assert.deepEqual(specificity("a:hover"), [0, 1, 1], "a pseudo-class counts as a class");
  assert.deepEqual(specificity("a::before"), [0, 0, 2], "a pseudo-element counts as a type");
  assert.deepEqual(specificity("[data-x]"), [0, 1, 0]);
  assert.deepEqual(specificity("*"), [0, 0, 0]);
  // :not() takes the specificity of its argument.
  assert.deepEqual(specificity(":not(#a)"), [1, 0, 0]);
});

test("selector matching handles combinators", () => {
  const root = parseHTML(`<div id="w"><ul class="list"><li class="item first">a</li><li class="item">b</li></ul><p>after</p><span>tail</span></div>`);
  const w = findById(root, "w");
  const item = w.children[0].children[1];
  const para = w.children[1];
  const span = w.children[2];

  assert.equal(matches(".item", item), true);
  assert.equal(matches("li.item", item), true);
  assert.equal(matches(".list > li", item), true);
  assert.equal(matches("#w li", item), true);
  assert.equal(matches("div > li", item), false);
  assert.equal(matches(".first", item), false, "the second li is not .first");
  assert.equal(matches("li:first-child", item), false);
  assert.equal(matches("li:first-child", w.children[0].children[0]), true);
  assert.equal(matches("li + li", item), true, "adjacent sibling");
  assert.equal(matches("li + li", w.children[0].children[0]), false);
  // The general sibling combinator only relates elements sharing a parent,
  // so "li ~ p" is false here: the p follows the ul, not an li.
  assert.equal(matches("ul ~ p", para), true);
  assert.equal(matches("ul ~ span", span), true, "~ skips over the p");
  assert.equal(matches("li ~ p", para), false);
  assert.equal(matches("p + span", span), true);
  assert.equal(matches("span + p", span), false, "order matters");
});

test("matching respects the state context", () => {
  const root = parseHTML(`<button class="btn">Go</button>`);
  const btn = root.children[0];
  assert.equal(matches(".btn:hover", btn, { states: {} }), false);
  assert.equal(matches(".btn:hover", btn, { states: { hover: true } }), true);
  assert.equal(matches(".btn:focus-visible", btn, { states: { focus: true } }), true);
  assert.equal(matches(".btn:active", btn, { states: { active: true } }), true);
  assert.equal(matches(".btn:disabled", btn, { states: { disabled: true } }), true);
  assert.equal(matches(".btn:hover", btn, { states: { focus: true } }), false);
});

test("attribute selectors and nth-child", () => {
  const root = parseHTML(`<ul><li>a</li><li>b</li><li>c</li></ul>`);
  const items = root.children[0].children;
  assert.equal(matches("li:nth-child(2)", items[1]), true);
  assert.equal(matches("li:nth-child(odd)", items[2]), true);
  assert.equal(matches("li:nth-child(2n+1)", items[2]), true);
  assert.equal(matches("li:last-child", items[2]), true);
  assert.equal(matches("li:only-child", items[2]), false);
  assert.equal(matchNth("3n", 6), true);
  assert.equal(matchNth("-n+2", 2), true);
  assert.equal(matchNth("-n+2", 3), false);

  const root2 = parseHTML(`<input type="checkbox" checked>`);
  const input = root2.children[0];
  assert.equal(matches("[type=checkbox]", input), true);
  assert.equal(matches("[checked]", input), true);
  assert.equal(matches("[checked]", root2.children[1]), false);
});

test("unknown pseudo-classes do not match", () => {
  const root = parseHTML(`<div>x</div>`);
  const div = root.children[0];
  assert.equal(matches("div:has(span)", div), false);
  assert.equal(matches("div:lang(en)", div), false);
});

test("parsing declarations and expanding shorthands", () => {
  const d = parseDeclarations(`color: red; margin: 4px 8px; padding: 2px !important`);
  const byProp = Object.fromEntries(d.map((x) => [x.property, x.value]));
  assert.equal(byProp.color, "red");
  assert.equal(byProp["margin-top"], "4px");
  assert.equal(byProp["margin-right"], "8px");
  assert.equal(byProp["margin-left"], "8px", "two-value margin applies to left and right");
  assert.equal(byProp["padding-top"], "2px");
  assert.equal(byProp["padding-top-important"], undefined);
  assert.ok(d.find((x) => x.property === "padding-top").important);
  // A value containing a semicolon inside a function must not be split.
  const d2 = parseDeclarations(`background: url(a;b); color: blue`);
  assert.equal(d2.length, 2);
  assert.equal(d2[0].value, "url(a;b)");
});

test("comments are stripped but do not join tokens", () => {
  const rules = parseCSS(`/* lead */ .a { color: red; /* mid */ background: blue; }`);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].declarations.length, 2);
  const r2 = parseCSS(`:root{--a:1px;}/*x*/:root{--b:2px;}`);
  assert.equal(r2.length, 2);
});

test("media and supports rules are captured with their condition", () => {
  const rules = parseCSS(`
    .a { color: red; }
    @media (prefers-color-scheme: dark) { .a { color: white; } }
    @media (max-width: 480px) { .a { font-size: 12px; } }
  `);
  assert.equal(rules.length, 3);
  assert.equal(rules[0].media, null);
  assert.match(rules[1].media, /prefers-color-scheme/);
  assert.match(rules[2].media, /max-width/);
  assert.equal(conditionHolds(rules[1].media, "dark"), true);
  assert.equal(conditionHolds(rules[1].media, "light"), false);
  assert.equal(conditionHolds(rules[2].media, "narrow"), true);
});

test("cascade order: specificity then source order", () => {
  const rules = parseCSS(`
    .btn { color: grey; }
    #go { color: blue; }
    .btn { background: white; }
  `);
  const root = parseHTML(`<button id="go" class="btn">x</button>`);
  const style = computeStyle(rules, root.children[0]);
  assert.equal(style.color, "blue", "the id wins over both class rules");
  assert.equal(style.background, "white");
});

test("cascade order: source order breaks specificity ties", () => {
  const rules = parseCSS(`
    .a { color: red; }
    .a { color: green; }
  `);
  const root = parseHTML(`<div class="a"></div>`);
  assert.equal(computeStyle(rules, root.children[0]).color, "green");
});

test("important beats specificity", () => {
  const rules = parseCSS(`
    #go { color: blue; }
    .a { color: red !important; }
  `);
  const root = parseHTML(`<button id="go" class="a">x</button>`);
  assert.equal(computeStyle(rules, root.children[0]).color, "red");
});

test("custom properties resolve, including fallbacks", () => {
  const rules = parseCSS(`
    :root { --brand: #3b82f6; --pad: 12px; }
    .box { color: var(--brand); padding: var(--pad); border-color: var(--missing, #ccc); }
  `);
  const root = parseHTML(`<div class="box"></div>`);
  const style = computeStyle(rules, root.children[0], {
    variables: { "--brand": "#3b82f6", "--pad": "12px" },
  });
  assert.equal(style.color, "#3b82f6");
  assert.equal(style.padding, "12px");
  assert.equal(style["border-color"], "#ccc", "an undefined variable falls back");
  // A cycle must not hang.
  const cyclic = resolveVars({ color: "var(--a)" }, { "--a": "var(--b)", "--b": "var(--a)" });
  assert.ok(typeof cyclic.color === "string");
});

test("nested rules are prefixed with the parent selector", () => {
  const rules = parseCSS(`
    .card {
      color: red;
      .title { font-weight: 700; }
    }
  `);
  const root = parseHTML(`<div class="card"><h2 class="title">T</h2></div>`);
  const h2 = root.children[0].children[0];
  const style = computeStyle(rules, h2);
  assert.equal(style["font-weight"], "700", "nested selector applies inside its parent");
  const card = root.children[0];
  assert.equal(computeStyle(rules, card).color, "red");
});

test("states are extracted from selectors for the state matrix", () => {
  assert.deepEqual(statesOf(".btn:hover"), { hover: true });
  assert.deepEqual(statesOf(".btn:focus-visible"), { focus: true });
  assert.deepEqual(statesOf(".btn:active"), { active: true });
  assert.deepEqual(statesOf(".btn:disabled"), { disabled: true });
  assert.deepEqual(statesOf(".btn:hover, .btn:focus-visible"), { hover: true, focus: true });
  assert.deepEqual(statesOf(".btn"), {});
  const rules = parseCSS(`.btn:hover{opacity:.9}.btn:focus-visible{outline:2px solid}.btn:disabled{opacity:.5}`);
  const seen = new Set();
  for (const r of rules) for (const k of Object.keys(r.states)) seen.add(k);
  assert.deepEqual([...seen].sort(), ["disabled", "focus", "hover"]);
});

test("keyframe blocks are not parsed as rules", () => {
  const rules = parseCSS(`
    .a { color: red; }
    @keyframes spin { from { transform: rotate(0); } to { transform: rotate(360deg); } }
  `);
  assert.equal(rules.length, 1);
  assert.equal(rules[0].selector, ".a");
});
