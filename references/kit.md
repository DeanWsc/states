# The kit

Every export, with signatures and examples. Zero dependencies; Node's built-in
modules only.

## Contents

1. [kit/tokens.mjs](#1-kittokenesmjs)
2. [kit/ui.mjs](#2-kituimjs)
3. [kit/state.mjs](#3-kitstatemjs)
4. [kit/audit.mjs](#4-kitauditmjs)
5. [kit/color.mjs](#5-kitcolormjs)
6. [kit/html.mjs](#6-kithtmlmjs)
7. [kit/css.mjs](#7-kitcssmjs)

## 1. kit/tokens.mjs

### `palette({ surface, brand, danger })`

A full token set where **every colour already passes the ratio it is used for**.
Body text meets 4.5:1, non-text edges meet 3:1, and ink on a brand fill meets
4.5:1 whatever brand colour you hand it.

```js
import { palette } from "./kit/tokens.mjs";

const p = palette();                                    // light
const d = palette({ surface: "#0e1116", brand: "#7c9cff", danger: "#ff8a80" });
```

Returns `{ surface, ink, body, muted, faint, edge, edgeStrong, brand, brandInk,
brandHover, brandQuiet, focus, danger, dangerInk, dangerSoft, disabled }`.

### `ensureContrast(foreground, background, { ratio })`

Moves a colour along its lightness until it reaches `ratio` against
`background`, searching whichever direction is shorter. Returns the original
colour when it already passes.

```js
ensureContrast("#bbbbbb", "#ffffff", { ratio: 4.5 });  // → a darker grey
ensureContrast("#000000", "#ffffff", { ratio: 4.5 });  // → "#000000", untouched
```

### `readableOn(foreground, layeredBackground, backdrop, { ratio })`

The same, for text on a translucent surface. Composites the surface over the
backdrop first, then searches. Use it when the background has alpha.

### `mix(a, b, weight)`, `shade(color, amount)`

`mix` weight is how much of `b` ends up in the result: 0 gives `a`, 1 gives `b`.
So a 92% surface tint is `mix(danger, surface, 0.92)`. `shade` with a positive
amount lightens toward white, negative darkens toward black.

### `tokensCss(p, { selector, indent })`, `themesCss(light, dark)`

Custom properties, and both themes in one block.

### `resetCss()`, `reducedMotionCss()`

The two blocks every page in this skill starts with. `box-sizing: border-box` is
not optional decoration.

Also exported: `SPACE`, `TYPE`, `RADIUS`, `TAP`.

## 2. kit/ui.mjs

Markup and its stylesheet come out of the same call, so a component cannot ship
missing a state.

### `button({ label, variant, type, disabled, loading, busy, icon, id })`

```js
button({ label: "Save" })
button({ label: "Upload", loading: true, busy: true })
button({ label: "Discard", variant: "quiet" })
button({ label: "Upload all", disabled: true })
```

### `field({ label, name, value, type, placeholder, hint, invalid, message, disabled, required, id })`

The label is always a real `<label for>`. When `invalid`, the message is wired
with `aria-describedby` and rendered as text.

```js
field({ label: "Email", name: "email", invalid: true, message: "That address is not valid." })
field({ label: "Folder", name: "folder", hint: "Where the files land." })
```

### `toggle({ label, checked, disabled })`, `checkbox({ label, checked, disabled })`

```js
row({ label: "Auto-charge", html: toggle({ label: "Auto-charge", checked: true }) })
```

### `panel({ title, note, children })`, `row({ label, note, html })`, `empty({ title, body, action })`

```js
panel({ title: "Failed uploads", children: empty({ title: "Nothing has failed yet" }) })
```

### `table({ caption, columns, rows, empty, skeleton, selected })`

A table with a caption and sortable headers. `rows.length` decides whether the
header renders at all: a header over an empty table invites someone to sort
columns that are not there.

```js
const columns = [
  { key: "id", label: "Invoice", sortable: true, sort: "descending" },
  { key: "amount", label: "Amount", align: "right", render: (r) => money(r.amount) },
  { key: "state", label: "Status", render: (r) => status({ label: r.state, tone: "ok" }) },
];

table({ caption: "Invoices", columns, rows, selected: ["INV-1"] });
table({ caption: "Loading", columns, rows: [], skeleton: skeletonRows(3, 3) });
table({ caption: "No matches", columns, rows: [], empty: { title: "No invoices match “fabrikam”" } });
```

Three things it does that hand-written markup usually does not:

- The first column is a real `<th scope="row">`, so a screen reader announces
  "Northwind, row 2 of 4" rather than reading a flat grid.
- Every cell carries `data-label`, which is what keeps a value attached to its
  heading once the table collapses into cards below 640px.
- The sort direction lives in `aria-sort` and in screen-reader-only text, not
  only in an arrow.

### `skeletonRows(columns, rows)`

Bars sized like the content they replace. Rendered **outside** the table, because
inside a cell it inherits the cell's layout rules and the narrow card layout
turns it into a stack of single bars.

### `pagination({ page, total, label })`

The edges are disabled, not hidden, so the control does not change shape as you
page through. The current page is stated in text.

### `status({ label, tone })`

A pill whose label carries the meaning and whose dot only reinforces it. `tone`
is `ok`, `warn`, `stop` or `neutral`.

### `toolbar({ search, children })`

A flex row that wraps, holding a search field and the controls that act on the
current view.

### `page({ title, lede, content })`

A whole document: tokens, component CSS, both themes, the viewport meta, the
reset and the reduced-motion block.

### `componentCss(p)`

The stylesheet for every component above, with all of its states. Useful on its
own when the markup is hand-written.

### `esc(text)`, `srOnly(text)`

Escape text for HTML; render screen-reader-only text.

## 3. kit/state.mjs

### `STATE_SETS`

Which states each component kind owes, as `{ label, required, expected, note }`.
`required` failures are errors; `expected` are warnings.

### `classify(node)`

The component kind of an element, from its tag, then its role, then its class
names. `role` wins over the tag: `<button role="switch">` is a switch. Class names
are split on `-`, `__` and `--`, so `.field__control` is an input and
`.btn--primary` is a button.

### `matrixFromRules(rules, { elements })`

Which states exist for which kinds. Passing `elements` attributes a rule to the
kind of the elements it actually matches, which is what lets `.c:hover` count as
hover coverage for a switch even though "c" names nothing.

### `renderMatrix(matrix)`

The matrix as a table, for the report.

### `auditStates(elements, matrix)`, `statesFor(matrix, kind)`, `missingStates(matrix, kind)`

Coverage queries.

## 4. kit/audit.mjs

### `audit(html, options)`

```js
const result = audit(html, {
  theme: "light",            // or "dark"
  checks: ["contrast"],      // omit for all
  minContrast: null,         // override the WCAG bar
  tapMin: 24,
  viewport: 390,
  resolveFile: (href) => cssText,   // for linked stylesheets
});
// → { ok, findings, byCheck, errors, warnings, notes, counts, matrix }
```

`ok` is true only when no error-severity finding remains. That is what the CLI's
exit code is built on.

Each finding: `{ check, severity, path, line, message, detail }`. `path` is a
readable selector path and `line` is where in the file, so a report points at
something you can open.

### The individual checks

`checkContrast`, `checkTapTargets`, `checkNames`, `checkFocus`, `checkStates`,
`checkNarrow`, `checkMotion`, `checkColorOnly`. Each takes the styled root and
returns findings, so they can be run on their own.

### `load(html, { css, resolveFile })`, `styleTree(root, rules, { theme, narrow, states })`

Parse and style a tree. `styleTree` computes styles with inheritance and records
each element's background chain, which is what makes contrast measurement honest
about translucent surfaces.

### `render(result, { title, theme })`

The text report. Stable between runs, so CI can diff it.

### `px(value, { rootFontSize, fontSize })`

Resolve a length, or return `null` when it cannot be resolved. A percentage or a
viewport unit returns `null` rather than a guess, because a guess is how an audit
starts lying.

## 5. kit/color.mjs

### `parse(cssColor)`

`{ r, g, b, a }` for hex (3, 4, 6 and 8 digits), `rgb()`, `rgba()`, `hsl()`,
`hwb()`, `lab()`, `lch()`, `oklab()`, `oklch()`, and the named colours. Returns
`null` for `currentColor`, `var()` and anything unreadable, so callers can tell
"no colour here" from "black".

### `contrast(a, b)`

WCAG 2.1 ratio, 1 to 21. Inputs should be opaque; use `composite` first.

### `composite(fg, bg)`, `flattenOnWhite(c)`, `luminance(c)`, `toHex(c)`

Alpha handling. `composite` is real source-over blending: 60% white over `#111`
is `#a0a0a0`, not white.

### `wcagLevel(ratio, { size, bold, disabled })`

`AAA`, `AA`, `AA-large`, `fail` or `exempt`. Disabled controls are exempt from
1.4.3.

### `hueDistance(a, b)`

Degrees between two hues, or `null` when either is grey. Used to reason about
colour-only signalling.

## 6. kit/html.mjs

### `parseHTML(source)`

A tree with `{ tag, attrs, parent, children, index, uid, line }`. Unbalanced tags
unwind at the parent boundary, as browsers do; a `<` that is not a tag stays
text; a quoted `>` inside an attribute does not end the tag.

### `accessibleName(node, root)`

The accname order: `aria-labelledby`, `aria-label`, `title`, `alt`, a wrapping or
referenced `<label>`, then the element's own content. A placeholder is
deliberately not used.

### `visibleText(node)`

Text with `script` and `style` removed and **`aria-hidden` honoured**, which is
what stops an icon button being named "×".

### `isInteractive(node)`, `isDisabled(node)`, `byTag(root, ...tags)`, `findById(root, id)`

`isDisabled` covers the attribute, `aria-disabled`, and a `fieldset[disabled]` with
the first-legend exception.

### `decodeEntities(s)`

## 7. kit/css.mjs

### `parseCSS(source)`

Rules with `{ selector, declarations, media, layer, supports, specificity,
states, index }`. Handles `@media`, `@supports`, `@layer`, `@container`, CSS
nesting including `&`, and ignores `@keyframes`.

### `computeStyle(rules, node, { states, media, variables })`

The cascade for one element: layer, then `!important` per declaration, then
specificity, then source order, with `var()` resolved. A property that does not
apply is `undefined` rather than inherited, which is what keeps a parent's
`width` off its children.

### `matches(selector, node, context)`

Descendant, child, adjacent and general sibling combinators, compound
selectors, the state pseudo-classes, attribute selectors and `:nth-child`. An
unknown pseudo-class returns `false`, and a pseudo-element never matches, so the
audit never claims a match it cannot justify.

### `statesOf(selector)`, `specificity(selector)`, `matchNth(arg, index)`

### `effectiveBackground(parents, { defaultBackground })`

Composites the background chain bottom-up to the colour text is actually read
against.
