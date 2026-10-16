# Craft

What a finished interface owes, state by state. Read this before designing.

## Contents

1. [Why states](#1-why-states)
2. [The states each component owes](#2-the-states-each-component-owes)
3. [Writing the error message](#3-writing-the-error-message)
4. [Empty, loading, error, partial](#4-empty-loading-error-partial)
5. [Contrast is a number, not a judgement](#5-contrast-is-a-number-not-a-judgement)
6. [Never colour alone](#6-never-colour-alone)
7. [Layout that survives a phone](#7-layout-that-survives-a-phone)
8. [Motion](#8-motion)
9. [Anti-patterns](#9-anti-patterns)

## 1. Why states

The resting state of a control is the only one that is designed. Every other
state is what happens when the interface meets a person: a thumb, a keyboard, a
screen reader, a slow network, a server that is down, a first run with no data.

The audit exists because this is not a matter of remembering. A missing
`:focus-visible` rule is invisible in a screenshot and fatal for a keyboard user,
and no amount of care at review time reliably catches it. A script that exits
non-zero always does.

Two failure modes, seen in practice:

- **The single state.** Everything styled, one state shipped.
- **The state that is only a colour.** The failure mode the colour-only check
  exists for, and the more embarrassing of the two, because it looks finished.

## 2. The states each component owes

`kit/state.mjs` holds this as `STATE_SETS`, and the audit enforces it. What each
state actually means in practice:

### Button

| State | What it must do | What goes wrong without it |
|---|---|---|
| rest | — | — |
| hover | change something a thumb can notice | Nothing tells you the press registered |
| focus-visible | a ring at 3:1 against its own surface | Keyboard users cannot see where they are |
| active | move or darken by one step | A press gives no feedback at all |
| disabled | read as unavailable, still legible | People press it twice |
| loading | hold its size, show progress, `aria-busy` | The layout jumps and the double-click lands |

A disabled button that is grey-on-grey is worse than one that is merely grey.
`--disabled` is computed to 3:1, not to "somewhere between the two colours".

### Text field

| State | What it must do |
|---|---|
| rest | a border at 3:1, a visible label above it |
| hover | the border darkens slightly |
| focus-visible | a ring, and the border changes so both cues fire |
| invalid | a red border **and** a message **and** `aria-describedby` |
| disabled | legible, not merely faint |
| placeholder | a hint, never the label |

The invalid state is the one that gets built as colour alone. It must not be.

### Switch, checkbox, radio

The checked state is the entire point. It must be carried by a shape as well as a
colour: a knob that moves, a checkmark, a tick in the box. `switch::after` with a
`translateX` is the cheapest version that passes, and it reads better than a
colour change even to people who see colour perfectly.

### The data states

Every surface that shows a collection owes all four:

- **empty, first run** — "Nothing here yet", one sentence, a way to start.
- **empty, filtered** — "No results for *foo*", a way to clear the filter.
- **loading** — a shape the size of the content it replaces, so nothing jumps.
- **error** — what failed, and what to do. Never just "Something went wrong".

These four are the states that are always missing, because a demo dataset is
never empty and never fails.

### Tables, specifically

A table has more states than any other component, and they interact.

**A table has two empty states and they are not the same.** "There is none" and
"your filter excluded it" look identical in code and mean opposite things to the
reader. The second one names what was searched and offers to clear it.

**A selection is a tint plus a rail.** The tint says "this row", the rail says it
even in greyscale. Neither alone is enough.

**A tint costs you contrast.** This is the trap that catches everyone once. A
selected row is a *different surface*, so the text on it has to be judged against
the tint rather than against the page. A faint brand wash looks like nothing on
white and quietly drops body text from 17:1 to 3.2:1. The audit measures it,
and the fix is in the palette rather than in the row: compute `--body-on-selected`
against `--selected`, and give every text token a variant for the tint.

**A nested fill inside a tinted row is a third surface.** A status pill inside a
selected row is not on `--ok-soft`; it is on `--ok-soft` over `--selected`. Drop
the pill's fill in that context and keep the word and the dot.

**Show the header only with rows.** A sort control over an empty table offers to
sort data that is not there.

**A collapsed table must keep its labels.** Below 640px each row becomes a card
of `label / value` pairs. Without `data-label` the card is a column of bare
numbers.

**Identifiers do not wrap.** "INV-2041" broken across two lines makes a table
look broken at a glance even when every column is perfectly legible. Same for
dates and money, and `font-variant-numeric: tabular-nums` makes a column of
figures line up.

## 3. Writing the error message

The message is the accessible part of the invalid state. Rules:

- **Say what is wrong, not that something is.** "That folder no longer exists", not
  "Invalid folder".
- **Say what to do next.** "Pick another", not "Try again".
- **One message per field.** A paragraph of validation errors above the form is
  worse than inline ones.
- **Keep it near the field.** Above the form means the eye and the keyboard both
  have to find it.
- **Do not rely on the asterisk.** Mark required fields with the attribute, and
  say so in text once, near the top.

`field({ invalid: true, message: "That folder no longer exists. Pick another." })`
does the markup and the wiring together, which is the point.

## 4. Empty, loading, error, partial

The four data states, and when each applies:

| State | When | What to draw |
|---|---|---|
| empty, first run | no records exist | Title, one sentence, a primary action |
| empty, filtered | records exist, the filter excludes them | What was searched, and a way to clear it |
| loading | a request is in flight | A skeleton the size of the content |
| error | the request failed | What failed, and a retry |
| partial | some of it loaded | What arrived, and what did not |

A skeleton that does not match the shape of the content is worse than a spinner,
because the layout jumps when the data lands. Reserve the space.

`aria-busy="true"` on the container announces loading. `role="status"` on the
message announces the result. Both are one attribute, and neither is visible.

## 5. Contrast is a number, not a judgement

WCAG 2.1 ratios, which are what the audit enforces:

| Text | Minimum |
|---|---|
| Body text | 4.5:1 |
| Large text (24px, or 18.66px bold) | 3:1 |
| Disabled text | exempt, but keep it legible |
| Borders, icons, focus rings (non-text) | 3:1 |

The thing to internalise: **you cannot tell 4.5:1 from 4.2:1 by looking.** Not on a
good monitor, not in a bright room, not in a design tool. Every serious pair of
eyes has failed this test, which is why the palette computes it:

```js
import { palette, ensureContrast } from "./kit/tokens.mjs";

// Ask for the ratio you need. You get it.
const faint = ensureContrast("#bbbbbb", "#ffffff", { ratio: 4.5 });

// Or let the palette do the whole set.
const p = palette();
```

Two traps the audit handles and most people do not:

- **Alpha is a colour.** `rgba(255,255,255,0.6)` on `#111` is `#a0a0a0`, which is
  7.2:1. Judged as white it would be 18.9:1. The audit composites first.
- **A translucent surface is judged against what is behind it.** A 50% white panel
  over a dark page is a mid grey, and the text on it is read against that.

## 6. Never colour alone

WCAG 1.4.1. The cases that matter in an interface:

- **Invalid fields.** A red border plus a message.
- **Toggles.** A moving knob plus a background.
- **Status.** A dot plus a word. A green dot alone means nothing to a
  colour-blind reader, and nothing in a greyscale printout.
- **Required fields.** An asterisk, and a `required` attribute.
- **Links in body text.** Underline them. Colour alone in a paragraph is 1.4.1.

The test: render the page in greyscale. If two states become indistinguishable,
that state needs a second cue. Turning on a greyscale filter is the fastest way
to find these, and it takes one CSS rule in devtools.

## 7. Layout that survives a phone

Four rules. Each one is a bug that was shipped at some point.

**`box-sizing: border-box`, always.** A `width: 100%` input with 14px of
horizontal padding is 28px wider than its container. On a phone, 28px is the
difference between fitting and a horizontal scrollbar.

**Never declare `width` on a container.** `max-width` caps it for wide screens and
is safe. `width: 720px` is 720px on a 390px phone.

**`min-width: 0` on every flex child.** The default is `auto`, which means "never
smaller than my content". One long label then pushes the switch off the right
edge of the screen, and the audit cannot see it because it does not lay out.

**`flex-wrap: wrap` on every button row.** Three buttons at 150px each do not fit
in 390px minus padding.

Check it: `node scripts/measure.mjs page.html --width 320`. 320 is the narrowest
phone anyone ships on, and it is where the missing `flex-wrap` shows up.

## 8. Motion

Every transition is a question you will be asked. Defaults:

- **120–200ms** for a state change. Over 300ms feels slow; under 80ms feels like
  a glitch.
- **`cubic-bezier(0.2, 0, 0, 1)`** for anything with movement. Linear feels
  mechanical on an ease-out.
- **Animate `transform` and `opacity`**, not `width`, `height` or `top`. The rest
  cause layout.
- **Wrap it all** in the block `reducedMotionCss()` emits. Not per component. All
  of it, once, at the end of the stylesheet.

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 1ms !important;
    animation-iteration-count: 1 !important;
    transition-duration: 1ms !important;
  }
}
```

A spinner is the one thing worth keeping: it is the only motion that conveys
information, so give it a still frame rather than removing it.

## 9. Anti-patterns

Seen in real reviews. Each of these fails a check or a person.

**The grey button.** `#999` text on `#f0f0f0`. 2.1:1. Use `--disabled`, which is
computed to 3:1.

**The placeholder as a label.** It disappears when the field has a value, so the
user cannot check what they typed. It is also not an accessible name, which the
audit reports.

**`outline: none` with nothing in its place.** The single most common
accessibility regression, and it is usually introduced while fixing something
that was not a problem.

**A fixed-width everything.** The desktop screenshot looks right. The phone is a
horizontal scrollbar.

**The custom checkbox with no checkmark.** `appearance: none` and then a
background colour. Now it is colour-only.

**An empty state that says "No data".** Says what is missing and how to add one.

**A skeleton that does not match the content.** The layout jumps on load, which is
worse than a spinner.

**Deliberately removing focus styling** because it looked untidy. Untidy is not a
defect; invisible is.

**Animating on first paint.** Everything animating in at once on load is motion
for its own sake.

**Shipping light only.** `@media (prefers-color-scheme: dark)` re-pointing the
same tokens is fifteen lines. An interface that is unreadable at night is a
defect, not a preference.
