# Verify

Three commands. Each sees something the others cannot, which is why there are
three and not one.

## Contents

1. [The three commands](#1-the-three-commands)
2. [audit: the stylesheet](#2-audit-the-stylesheet)
3. [measure: the layout](#3-measure-the-layout)
4. [shot: the pixels](#4-shot-the-pixels)
5. [The review checklist](#5-the-review-checklist)
6. [When a check is wrong](#6-when-a-check-is-wrong)

## 1. The three commands

```sh
node scripts/audit.mjs page.html              # read the stylesheet; exits 1 on error
node scripts/measure.mjs page.html --width 390 # ask the browser; exits 1 on overflow
node scripts/shot.mjs page.html --out shots    # write PNGs at 1280, 390, 320
```

They overlap on purpose, and the gaps between them are the point:

| | audit | measure | shot |
|---|---|---|---|
| Sees | CSS + markup | real layout | real pixels |
| Needs Chrome | no | yes | yes |
| Catches | missing states, low contrast, unnamed controls | overflow, painted target sizes | everything else |
| Misses | anything about layout | semantics, contrast | state you forgot to render |

**A page that passes `audit` can still overflow on a phone.** A flex item with a
long label and no `min-width: 0` is a static-analysis no-op and a real bug.

## 2. audit: the stylesheet

Parses the HTML into a tree, parses the CSS including media queries and nesting,
runs the cascade, and measures the result.

```
$ node scripts/audit.mjs page.html
page.html: PASS
45 elements, 10 controls, 60 rules
0 errors, 2 warnings, 0 notes

── tap-target
   [warning] html > body > div.wrap > form.panel > div.row > button.switch:421
      target height 26px is under the 44px ideal for touch
```

Options:

```
--theme <light|dark>   Evaluate the stylesheet for one theme (default: light)
--check <name>         Run only this check, repeatable
--min-contrast <n>     Override the required ratio
--tap-min <px>         Minimum target height (default: 24)
--viewport <px>        Narrow width to test (default: 390)
--json                 Machine-readable output
--quiet                Just the verdict line
```

**Run both themes.** A page that passes in light and fails in dark has a token
problem, not a styling problem, and the fix belongs in `palette()`.

Linked stylesheets are resolved relative to the file, so splitting the CSS out
does not silently disable the audit.

## 3. measure: the layout

Drives Chrome over the DevTools protocol and asks what it actually laid out.

```
$ node scripts/measure.mjs page.html --width 390
page.html at 390px:
  viewport 390px, scroll width 795px
  controls measured: 4
  4 control(s) painted under 44px tall:
    button.btn "Save changes" 113x28
  1 control(s) cut off by the viewport edge:
    input "" right=746px wide
  4 element(s) extend past the viewport:
    div.panel left=24 right=794 width=770 display=block
    input left=49 right=795 width=746 display=inline-block
  RESULT: horizontal overflow
```

It names the element and its width, which is the difference between "your page
scrolls sideways" and "`.panel` is 770px wide; drop the `width` and let it fill
its container".

**Why the DevTools protocol and not `--screenshot`.** A desktop Chrome silently
refuses a window narrower than 500px and renders at 500 instead. A page that
overflows badly at 390 therefore screenshots perfectly. `Emulation.setDevice-
MetricsOverride` is the only way to get a true 390px viewport, and that is the
whole reason this script exists.

Run it at 320 as well. 320 is where the missing `flex-wrap` shows up.

Exits 1 on horizontal overflow. A missing Chrome prints why and exits 0, so a
build machine without a browser is not a broken build.

## 4. shot: the pixels

Writes a PNG at 1280, 390 and 320.

```
$ node scripts/shot.mjs page.html --out shots
ok   shots/page-desktop.png
ok   shots/page-phone.png
ok   shots/page-narrow-320.png
```

**Then open every one.** This is the step that catches what neither other command
can see: a switch three pixels off its row, a card whose bottom edge touches the
next one, a heading that wraps to two lines and pushes everything down, a focus
ring clipped by an `overflow: hidden`.

Take shots of the states too, by forcing them in a query or a class. A component
screenshot in its resting state tells you almost nothing about whether the
disabled state exists.

## 5. The review checklist

Run in this order. Each step is cheap and each one catches something the next
cannot.

1. `audit` in **both** themes, 0 errors.
2. `measure` at **320**, no horizontal overflow.
3. `shot` at all three widths, and **look at every image**.
4. Force the states and shoot them: hover, focus, disabled, invalid, loading,
   empty, error. If you cannot get the browser into a state to photograph it, that
   is worth knowing.
5. Tab through the page once with the keyboard. Every stop shows a ring. This
   takes forty seconds and catches what the audit only infers.
6. Narrow the window by hand and drag it smaller. The place it breaks is the place
   `measure` said it would.
7. Read the numbers. A count that says "12 rows" should match the model. An
   interface showing a stale number is worse than one showing none.

## 6. When a check is wrong

It happens. A warning about a 26px switch where the row around it is 44px is a
real false positive: the target is the row, not the switch.

**Fix the page, not the check.** The checks encode WCAG and platform minimums;
they are not opinions. If one of them is genuinely wrong, change it in
`kit/audit.mjs`, add a test that proves the new behaviour, and say why in the
commit. Silencing a check without understanding it is how an interface ends up
with an audit that passes and a page that does not work.
