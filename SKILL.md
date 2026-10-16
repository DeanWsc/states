---
name: states
description: Build a finished interactive interface, not a screenshot of one — a real component set where every control has its hover, focus, active, disabled, loading, invalid, empty and error states, in a token system whose colours are computed to pass contrast rather than chosen by eye, responsive down to 320px, and verified by an audit that exits non-zero. Use this whenever someone wants a UI, a component, a form, a settings panel, a dashboard, a landing page section, or asks to "make it look premium" or "polish this interface", or wants an accessibility or contrast review of existing markup. Works framework-free and in React/Next.js. Also photographs the result in a real browser and measures the layout that actually rendered, because a page that passes the audit can still overflow on a phone.
license: MIT
compatibility: Written for Claude Code; also runs in Antigravity, OpenCode, Codex and MiniMax Code. Needs Node.js 20.10+. Chrome or Chromium is optional and only needed for screenshots and layout measurement.
metadata:
  opencode/slash: "true"
---

# States

A button that only exists in its resting appearance is not a button. It is a rectangle with a label on it, and the moment a keyboard, a screen reader, a phone or a slow network touches it, it fails.

So the rule this skill is built on:

> **An interface is not a screen. It is a set of states.**

Most interfaces are delivered as the one screen that renders. This skill makes the other ones impossible to skip, because `node scripts/audit.mjs page.html` exits non-zero while a state is missing.

## The idea that matters

**The states are the interface.** The resting screenshot is the easy part and the least useful. What a person actually meets is: the button before it is pressed, while it is pressed, when it has no focus, when it cannot be pressed, while the request is in flight, after it failed, and the list when it is empty.

Two ways this fails, both common:

- **The single state.** One polished screenshot, and every other state left to chance. Discovered on a phone, by a keyboard user, or at 3am on a bad connection.
- **The state that is only a colour.** A red border for invalid, a blue background for selected, a grey row for disabled. Invisible to a colour-blind reader, invisible in a greyscale screenshot, invisible to anyone printing the page.

The fix for both is the same, and it is not more care: **build the states as things you can name, then check them by machine.** The audit exists so this stops being a matter of remembering.

## Workflow

Work in this order. Most of the quality is decided before any markup is written.

1. **Name the states before the markup.** For each component, write the list of states it must cover. Start from `STATE_SETS` in `kit/state.mjs`, which already knows what a button, a field, a switch, a checkbox, a tab and a dialog each owe. `node scripts/audit.mjs page.html` prints the matrix it checks against.
2. **Take the truth from the product.** What does this screen actually do? What is slow? What can fail? What is empty on a first run and empty on a hundredth? What does it look like when the user is over their quota, when the file is too large, when the request times out? A state you did not think about here is a state that ships broken.
3. **Choose tokens by ratio, not by eye.** `palette()` in `kit/tokens.mjs` computes a text colour that meets the ratio you ask for by moving its lightness. Ask for 4.5 and you get 4.5. Do not hand-write hex codes for text; that is exactly how a 2.8:1 label ships.
4. **Generate the components, do not hand-write them.** `kit/ui.mjs` emits markup and its stylesheet together, so a button cannot come out missing `:disabled`. Use `button()`, `field()`, `toggle()`, `checkbox()`, `panel()`, `row()`, `empty()`. If you must hand-write, copy `examples/billing-settings/` and change the tokens, not the rules.
5. **Make the invalid state readable without colour.** A message in text, wired with `aria-describedby`, next to the border. The audit checks for the message.
6. **Make the empty state a real state.** A title, one sentence saying what is missing, and a way out. `empty()` does this.
7. **Wire the live states.** `aria-busy` while a request is in flight, `aria-invalid` on a rejected field, `aria-checked` on a switch. The visible style and the attribute have to agree, or the interface lies to one of its two audiences.
8. **Audit to zero.** `node scripts/audit.mjs page.html` must end `audit passed` with 0 errors. Fix the markup, never the rule: add the state, do not delete the check.
9. **Measure the layout that actually rendered.** `node scripts/measure.mjs page.html --width 390`. The audit reads the stylesheet; this asks the browser. A page can pass every check and still overflow, because a flex item with a long label will not shrink and the audit cannot know that.
10. **Look at it.** `node scripts/shot.mjs page.html --out shots` writes a desktop, a 390px and a 320px render. Read every one. The audit cannot see a switch sitting three pixels off its row.

## Setup

The kit is in `kit/`, with no dependencies. Node's built-in modules only.

| File | Use it for |
|---|---|
| `kit/color.mjs` | Parsing every CSS colour space, alpha compositing, WCAG contrast. The numbers the audit reports come from here. |
| `kit/html.mjs` | Parsing the page into a tree, accessible names in accname order, disabled controls including `fieldset`. |
| `kit/css.mjs` | Rules, media queries, CSS nesting, specificity, the cascade, `var()` resolution. |
| `kit/state.mjs` | `STATE_SETS`, which states each component owes; `matrixFromRules` and `renderMatrix`. |
| `kit/tokens.mjs` | `palette()`, `ensureContrast()`, `ensureContrast` for readable-on-translucent, the reset, the reduced-motion block. |
| `kit/ui.mjs` | `button`, `field`, `toggle`, `checkbox`, `panel`, `row`, `empty`, `table`, `pagination`, `status`, `toolbar`, and `componentCss()` which emits every state. |
| `kit/audit.mjs` | The eight checks and the report. |
| `scripts/audit.mjs` | The CLI. Exits 1 on any error. |
| `scripts/measure.mjs` | Real layout through the DevTools protocol. Exits 1 on horizontal overflow. |
| `scripts/shot.mjs` | Screenshots at 1280, 390 and 320. |

Pick the path that fits:

- **Standalone HTML, a blog post, a prototype.** Write a build script like `examples/upload-queue/build.mjs`. It composes components from `kit/ui.mjs`, calls `page()`, writes the file, and then audits it. `node examples/upload-queue/build.mjs --check` adds the layout measurement.
- **An existing page.** Drop the HTML in and run `node scripts/audit.mjs yourpage.html`. Fix what it reports. That alone is usually most of the work.
- **React or Next.js.** Copy `kit/` into the project. Keep tokens and `componentCss()` as the stylesheet; import the markup builders as plain functions. Do not turn them into React components that take a `className` prop: the class name is what the audit matches on, and a caller who overrides it silently drops every state.

## The checks

`node scripts/audit.mjs page.html`. Errors must reach zero; warnings are judgement calls.

| Check | Error means |
|---|---|
| `contrast` | Text is under the WCAG ratio for its size. Disabled text is a note, not an error, because 1.4.3 exempts it. |
| `tap-target` | A control is under 24px tall. 44px is the ideal and a warning. A native checkbox is measured together with its label. |
| `accessible-name` | A control has nothing a screen reader can read. A placeholder does not count. |
| `focus-indicator` | No `:focus-visible` style, or `outline: none` with nothing in its place. |
| `state-coverage` | A control is missing a state its kind owes. Driven by the real markup, so three buttons with no focus rule give three findings. |
| `narrow-overflow` | A declared width or min-width cannot fit in 390px. |
| `reduced-motion` | Something animates and the stylesheet never honours `prefers-reduced-motion`. |
| `color-only` | A toggle whose only difference between on and off is a background colour. |

Two things the audit cannot know, and you must check yourself: **real rendered pixels** (step 10) and **actual layout** (step 9).

## Rules that survive contact with reality

- **`box-sizing: border-box` is not decoration.** A `width: 100%` input with horizontal padding is 30px wider than its container without it, and it is the most common reason a page scrolls sideways on a phone.
- **A flex item needs `min-width: 0`.** Its default is `auto`, which refuses to shrink below its content, so one long label pushes the switch out of the row and off the screen.
- **Declare no width on a container.** `max-width` is a cap for wide screens and is safe. `width: 720px` on a panel is a horizontal scrollbar on a phone.
- **A tap target is the label, not the box.** A 20px checkbox with a 44px label is a 44px target.
- **A tint is not free.** A selected row is a different surface, and the text on it has to be judged against the tint rather than against the page. A faint brand wash looks like nothing on white and quietly drops body text from 17:1 to 3.2:1. Compute the text colour against the tint, and give the row a rail as well so the state survives a greyscale render.
- **A table has two empty states.** "There is none" and "your filter excluded it" look identical in code and mean opposite things to the reader. Write both, and only render the header when there are rows to sort.
- **A table that collapses must keep its labels.** Below 640px each cell becomes `label / value`. Without `data-label` the card is a column of bare numbers.
- **Motion is opt-in.** Every transition is a question you will be asked. Wrap them all in the reduced-motion block that `reducedMotionCss()` emits.
- **Ship a dark theme, or say you did not.** `@media (prefers-color-scheme: dark)` re-pointing the same tokens is fifteen lines. An interface that is unreadable at night is a defect, not a preference.
- **Numbers in the interface are the product's.** A placeholder count that does not match the model is worse than no number.

## Examples

Three, and they are opposite on purpose:

- `examples/billing-settings/` is a hand-written reference: the smallest thing that passes with zero errors in both themes. Open it before you start.
- `examples/upload-queue/` is generated by `build.mjs` from `kit/ui.mjs`, and the build refuses to leave a failing page behind.
- `examples/invoices/` is a data table showing every state of the same component side by side: rows, a selected row, a skeleton, an empty-because-filtered, and an empty-first-run.
- `examples/broken/` is a fixture with every defect on purpose. It is how the audit's own tests prove each check fires. Never copy from it.

## References

Read as needed:

- `references/craft.md`: the states each component owes, the messages that make an error readable, empty and error copy, and the anti-patterns that got pages rejected.
- `references/kit.md`: the API, with signatures and examples.
- `references/react.md`: the server/client split, and the two traps that cost an afternoon each.
- `references/verify.md`: the three commands, what each one can and cannot see, and the review checklist.
