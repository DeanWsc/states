// The audit. No dependencies.
//
// This is the part that matters. A rule written in prose ("make sure the
// contrast is high enough") is advice the author can talk themselves out of.
// A rule that exits non-zero is not. Every check below turns a judgement call
// about an interface into a number that must reach zero.
//
// What it can measure without a browser: colour and contrast, computed styles,
// control geometry as declared, state coverage, accessible names, motion
// preferences, and narrow-viewport overflow. What it cannot: actual rendered
// pixels, real font metrics, and true layout. scripts/shot.mjs covers that gap
// with headless Chrome. Be honest about which is which in the report.

import { parseHTML, visibleText, isInteractive, isDisabled, accessibleName, findById } from "./html.mjs";
import { parseCSS, computeStyle, effectiveBackground, conditionHolds } from "./css.mjs";
import { parse as parseColor, composite, contrast, toHex, wcagLevel, hueDistance, luminance } from "./color.mjs";
import { STATE_SETS, classify, matrixFromRules, auditStates, missingStates, statesFor } from "./state.mjs";

/** Severity levels. Errors must reach zero; warnings are judgement calls. */
export const SEVERITY = { error: "error", warning: "warning", note: "note" };

/** WCAG 2.5.5 and the platform minimums people actually expect on touch. */
export const MIN_TAP = { ideal: 44, minimum: 24 };

/** Width the audit assumes when it checks narrow-viewport overflow. */
export const NARROW = 390;

/** Properties that inherit, so a computed style can be walked down a tree. */
const INHERITED = new Set([
  "color", "font-size", "font-weight", "font-family", "line-height",
  "letter-spacing", "text-align", "text-transform", "visibility", "white-space",
  "font-style", "word-spacing",
]);

/**
 * Properties a parent hands down that are NOT inherited in CSS but that a
 * measurement still needs: a child's effective background is the parent's, and
 * its padding adds onto an inherited box. Everything else stays per element,
 * because letting `width` leak from a 720px panel onto every descendant is
 * what turns one layout bug into a page full of false findings.
 */
const DERIVED = new Set(["background-color", "background", "box-sizing", "flex-direction", "gap", "align-items"]);

/**
 * Parse a length into pixels. Returns null when it cannot be resolved, so the
 * audit never invents a number. Relative units resolve against a declared root
 * font size, defaulting to 16px.
 */
export function px(value, { rootFontSize = 16, fontSize = 16 } = {}) {
  if (value === undefined || value === null) return null;
  const v = String(value).trim();
  if (!v) return null;
  if (v === "0") return 0;
  if (v === "thin") return 1;
  if (v === "medium") return 2;
  if (v === "thick") return 3;
  let m = /^(-?[\d.]+)px$/.exec(v);
  if (m) return parseFloat(m[1]);
  m = /^(-?[\d.]+)rem$/.exec(v);
  if (m) return parseFloat(m[1]) * rootFontSize;
  m = /^(-?[\d.]+)em$/.exec(v);
  if (m) return parseFloat(m[1]) * fontSize;
  m = /^(-?[\d.]+)%$/.exec(v);
  if (m) {
    // A percentage is relative to an unknown containing block, so it is not a
    // length the audit can resolve. It does imply "not a fixed pixel width".
    return null;
  }
  m = /^(-?[\d.]+)(ch|ex)$/.exec(v);
  if (m) return parseFloat(m[1]) * fontSize * 0.5;
  m = /^(-?[\d.]+)(vh|vw|vmin|vmax)$/.exec(v);
  if (m) return null;
  const bare = parseFloat(v);
  return Number.isFinite(bare) ? bare : null;
}

/**
 * Load a document: parse the HTML, collect every stylesheet (inline and linked),
 * and return the tree plus the rules.
 *
 * `resolveFile` is injected so the CLI can read linked files and the tests can
 * pass a map, keeping this module free of filesystem concerns.
 */
export function load(html, { css = null, resolveFile = null } = {}) {
  const root = parseHTML(html);
  const sources = [];

  // Inline <style> and <svg><style>.
  for (const node of root.descendants()) {
    if (node.tag === "style" && node.raw) sources.push({ text: node.raw, from: "inline <style>" });
  }

  // Linked stylesheets.
  for (const node of root.descendants()) {
    if (node.tag === "link" && /stylesheet/i.test(node.attrs.rel || "")) {
      const href = node.attrs.href;
      if (href && resolveFile) {
        const text = resolveFile(href);
        if (text) sources.push({ text, from: href });
      }
    }
  }

  if (css) sources.push({ text: css, from: "provided css" });

  const rules = sources.flatMap((s) => parseCSS(s.text));
  const raw = sources.map((s) => s.text).join("\n");
  return { root, rules, raw, sources };
}

/** Root custom properties, which every other computation depends on. */
function rootVariables(rules, theme = "light") {
  const html = { tag: "html", attrs: {}, children: [], parent: null, index: 1, uid: 0, text: "", raw: null };
  html.selfAndDescendants = function* () { yield html; };
  html.descendants = function* () {};
  html.classes = [];
  html.hasClass = () => false;
  html.closest = () => null;
  html.label = "";
  html.textContent = "";
  return computeStyle(rules, html, { media: theme, variables: {} }).vars;
}

/**
 * Compute a style for every element, with inheritance and the variables in scope.
 * Also records the chain of ancestor backgrounds so text contrast can be
 * measured against the surface it actually sits on.
 */
export function styleTree(root, rules, { theme = "light", narrow = false, states = {} } = {}) {
  const vars = rootVariables(rules, theme);
  const media = narrow ? `${theme} narrow` : theme;

  const walk = (node, parentStyle, ancestors) => {
    const own = computeStyle(rules, node, { states, media, variables: vars });

    // Start from the parent's values only for properties that genuinely flow
    // down. A width declared on an ancestor must NOT become the child's width.
    const style = {};
    if (parentStyle) {
      for (const prop of INHERITED) {
        if (own[prop] === undefined && parentStyle[prop] !== undefined) {
          style[prop] = parentStyle[prop];
        }
      }
      for (const prop of DERIVED) {
        if (own[prop] === undefined && parentStyle[prop] !== undefined) {
          style[prop] = parentStyle[prop];
        }
      }
    }
    // Everything the element declares itself wins.
    Object.assign(style, own);
    style.vars = vars;

    // Background resolution: an element with no background of its own sits on
    // whatever is behind it, so the chain must include the inherited value.
    style.backgroundColor = own["background-color"] || own.background || style["background-color"] || null;
    style.color = own.color || style.color || null;

    const chain = [...ancestors, style];
    node.computed = style;
    node.backgroundChain = chain;

    for (const child of node.children) walk(child, style, chain);
  };

  for (const child of root.children) walk(child, null, []);
  return vars;
}

/** The background colour a node is actually read against. */
export function backgroundOf(node, { defaultBackground } = {}) {
  const chain = node.backgroundChain || [];
  return effectiveBackground(chain, defaultBackground ? { defaultBackground } : undefined);
}

/**
 * Is this element the screen-reader-only pattern?
 *
 * The usual implementation is a 1px box with the text clipped away. Its colour is
 * never seen, so judging its contrast would report a failure that does not exist.
 */
function isVisuallyHidden(node, style) {
  const fontSize = px(style["font-size"]) ?? 16;
  const w = px(style.width, { fontSize });
  const h = px(style.height, { fontSize });
  const clipped =
    style["clip-path"] !== undefined ||
    style.clip !== undefined ||
    (String(style.overflow ?? "") === "hidden");
  const tiny = (w !== null && w <= 1) || (h !== null && h <= 1);
  const classHint = node.hasClass("visually-hidden")
    || node.hasClass("sr-only")
    || node.hasClass("visuallyhidden")
    || node.hasClass("screen-reader-only");
  return classHint || (clipped && tiny);
}

/**
 * Check text contrast for every visible text node.
 *
 * The reported ratio is the one a reader actually experiences: the text colour
 * composited over the surface behind it, which may be translucent.
 */
export function checkContrast(root, { theme = "light", minRatio = null } = {}) {
  const findings = [];
  const defaultBg = parseColor(theme === "dark" ? "#0b0f19" : "#ffffff");

  for (const node of root.descendants()) {
    const style = node.computed;
    if (!style) continue;

    // Skip anything not rendered as text.
    if (["script", "style", "head", "title", "template", "noscript"].includes(node.tag)) continue;
    const text = visibleText(node).trim();
    if (!text) continue;
    // An element whose children carry the text should not be measured twice.
    const childHasText = node.children.some((c) => visibleText(c).trim());
    if (childHasText) continue;

    if (style.visibility === "hidden") continue;
    if (style.display === "none") continue;
    if (style.opacity !== undefined && Number(style.opacity) === 0) continue;

    // Screen-reader-only text is clipped to nothing and is never painted, so its
    // contrast is irrelevant. This is the standard visually-hidden pattern and
    // excluding it is what stops the audit from flagging every icon button.
    if (isVisuallyHidden(node, style)) continue;

    const disabled = isDisabled(node);
    const fgRaw = style.color;
    if (!fgRaw) continue;
    const fg = parseColor(fgRaw === "currentColor" ? "#000000" : fgRaw);
    if (!fg) continue;

    const bg = backgroundOf(node, { defaultBackground: defaultBg });
    const fgFlat = fg.a < 1 ? composite(fg, bg) : fg;

    const size = px(style["font-size"], { fontSize: 16 }) ?? 16;
    const weight = parseInt(style["font-weight"] ?? "400", 10) || 400;
    const bold = weight >= 600;
    const ratio = contrast(fgFlat, bg);
    if (ratio === null) continue;

    // The minimum is decided by the text size, as WCAG does.
    const large = size >= 24 || (bold && size >= 18.66);
    const required = minRatio ?? (large ? 3 : 4.5);
    const level = wcagLevel(ratio, { size, bold, disabled });

    if (ratio < required && !disabled) {
      findings.push({
        check: "contrast",
        severity: SEVERITY.error,
        path: node.path(),
        line: node.line,
        message: `text contrast ${ratio.toFixed(2)}:1 is below the ${required}:1 required for ${size}px${bold ? " bold" : ""} text`,
        detail: {
          text: text.slice(0, 60),
          color: toHex(fgFlat),
          background: toHex(bg),
          ratio: Number(ratio.toFixed(2)),
          required,
          level,
          size,
          weight,
        },
      });
    } else if (ratio < required && disabled) {
      findings.push({
        check: "contrast",
        severity: SEVERITY.note,
        path: node.path(),
        line: node.line,
        message: `disabled text contrast ${ratio.toFixed(2)}:1 is exempt from WCAG 1.4.3, but check it is still legible`,
        detail: { text: text.slice(0, 60), ratio: Number(ratio.toFixed(2)), disabled: true },
      });
    }
  }
  return findings;
}

/**
 * Check that interactive elements are big enough to hit.
 *
 * The ideal is 44px. A smaller control is reported as a warning rather than an
 * error only when the space around it is clear, because the WCAG 2.2 exception
 * for inline links is real and a dense table legitimately has smaller targets.
 */
export function checkTapTargets(root, { min = MIN_TAP.minimum, ideal = MIN_TAP.ideal } = {}) {
  const findings = [];
  for (const node of root.descendants()) {
    if (!isInteractive(node)) continue;
    // A <label> is not a target in its own right: it forwards its click to the
    // control it names, and that control is what gets measured.
    if (node.tag === "label") continue;
    const style = node.computed;
    if (!style) continue;
    if (style.display === "none" || style.visibility === "hidden") continue;

    // An element with no declared size is sized by its content, so the audit
    // cannot judge it and says so rather than guessing.
    // An element with no declared size is sized by its content, so the audit
    // cannot judge it and says so rather than guessing.
    const type = (node.attrs.type || "").toLowerCase();
    const fontSize = px(style["font-size"]) ?? 16;

    // A native checkbox or radio is small on purpose: the label beside it is
    // the real target, and clicking the label toggles the input. Measuring the
    // 20px box on its own would report every well-built checkbox as too small.
    if (["checkbox", "radio"].includes(type) && style.appearance !== "none") {
      const label = node.attrs.id
        ? [...root.descendants()].find((n) => n.tag === "label" && n.attrs.for === node.attrs.id)
        : node.parent?.closest((n) => n.tag === "label");
      if (label && label.computed) {
        const labelH = px(label.computed.height, { fontSize });
        const wrapH = node.parent?.computed
          ? px(node.parent.computed.height, { fontSize })
          : null;
        // The label's own line box, or the wrapper's min-height when it has one.
        const effective = Math.max(
          labelH ?? 0,
          wrapH ?? 0,
          px(label.computed["min-height"], { fontSize }) ?? 0,
          px(node.parent?.computed?.["min-height"], { fontSize }) ?? 0,
          px(style.height, { fontSize }) ?? 0,
        );
        if (effective >= ideal) continue;
        if (effective >= min) {
          findings.push({
            check: "tap-target",
            severity: SEVERITY.warning,
            path: node.path(),
            line: node.line,
            message: `the checkbox itself is ${(px(style.height, { fontSize }) ?? 0).toFixed(0)}px, so the target is its ${effective.toFixed(0)}px label; keep the label at ${ideal}px`,
            detail: { input: px(style.height, { fontSize }), effective, ideal, name: accessibleName(node, root) },
          });
        } else {
          findings.push({
            check: "tap-target",
            severity: SEVERITY.error,
            path: node.path(),
            line: node.line,
            message: `the checkbox and its label together give only a ${effective.toFixed(0)}px target, under the ${min}px minimum`,
            detail: { effective, min, ideal, name: accessibleName(node, root) },
          });
        }
        continue;
      }
    }

    const w = px(style.width, { fontSize });
    const h = px(style.height, { fontSize });
    const padTop = px(style["padding-top"]) ?? 0;
    const padBottom = px(style["padding-bottom"]) ?? 0;
    const padLeft = px(style["padding-left"]) ?? 0;
    const padRight = px(style["padding-right"]) ?? 0;
    const minH = px(style["min-height"], { fontSize });
    const minW = px(style["min-width"], { fontSize });
    const borderTop = px(style["border-top-width"]) ?? 0;
    const borderBottom = px(style["border-bottom-width"]) ?? 0;

    const lineHeight = px(style["line-height"], { fontSize }) ?? fontSize * 1.2;

    // Height is whichever is declared: height wins, then min-height, then the
    // content box implied by line-height plus padding and borders. min-height is
    // a floor, so when both height and min-height exist the larger one applies.
    let effectiveH = null;
    if (h !== null && minH !== null) effectiveH = Math.max(h, minH);
    else if (h !== null) effectiveH = h;
    else if (minH !== null) effectiveH = minH;
    else effectiveH = lineHeight + padTop + padBottom + borderTop + borderBottom;

    let effectiveW = null;
    if (w !== null && minW !== null) effectiveW = Math.max(w, minW);
    else if (w !== null) effectiveW = w;
    else if (minW !== null) effectiveW = minW;
    else effectiveW = padLeft + padRight + 40 + borderTop;

    // An inline link inside a sentence is exempt from the target size minimum
    // (WCAG 2.5.8). The condition has to treat an undeclared display as inline,
    // because that is the CSS initial value: a `<a>` with no display rule is
    // inline, and requiring the property to be spelled out meant every plain
    // link in a paragraph was reported as a 20px target.
    const display = style.display ?? "inline";
    if (node.tag === "a" && (display === "inline" || display === "contents")) continue;
    // A link that opts into being a block control is judged normally.
    if (node.tag === "a" && display === "block" && px(style.height, { fontSize }) === null) {
      // It sizes from its own content, so the audit has no height to judge.
      continue;
    }

    if (effectiveH !== null && effectiveH < min) {
      findings.push({
        check: "tap-target",
        severity: SEVERITY.error,
        path: node.path(),
        line: node.line,
        message: `target height ${effectiveH.toFixed(0)}px is below the ${min}px minimum (${ideal}px is ideal)`,
        detail: { height: effectiveH, width: effectiveW, min, ideal, name: accessibleName(node, root) },
      });
    } else if (effectiveH !== null && effectiveH < ideal) {
      findings.push({
        check: "tap-target",
        severity: SEVERITY.warning,
        path: node.path(),
        line: node.line,
        message: `target height ${effectiveH.toFixed(0)}px is under the ${ideal}px ideal for touch`,
        detail: { height: effectiveH, width: effectiveW, ideal, name: accessibleName(node, root) },
      });
    }
  }
  return findings;
}

/**
 * Check that every control has an accessible name.
 *
 * A control with no name is unusable with a screen reader, and this is the one
 * failure that no amount of visual polish compensates for.
 */
export function checkNames(root) {
  const findings = [];
  for (const node of root.descendants()) {
    if (!isInteractive(node)) continue;
    if (["label"].includes(node.tag)) continue;
    const style = node.computed;
    if (style && (style.display === "none" || style.visibility === "hidden")) continue;

    const name = accessibleName(node, root);
    if (name) continue;

    // A hidden input is labelled by its own aria-labelledby target, which may
    // live elsewhere; a visible control with nothing is a real finding.
    findings.push({
      check: "accessible-name",
      severity: SEVERITY.error,
      path: node.path(),
      line: node.line,
      message: `${node.tag} has no accessible name (no aria-label, no label, no content)`,
      detail: { tag: node.tag, type: node.attrs.type, id: node.attrs.id, cls: node.attrs.class },
    });
  }
  return findings;
}

/**
 * Check that interactive elements have a visible focus indicator.
 *
 * Measured two ways: is there a :focus or :focus-visible rule at all, and does
 * the indicator itself have enough contrast against the surface to be seen? A
 * focus ring nobody can see is the same as no focus ring.
 */
export function checkFocus(root, rules, { theme = "light" } = {}) {
  const findings = [];
  const defaultBg = parseColor(theme === "dark" ? "#0b0f19" : "#ffffff");

  // Collect every rule that mentions focus, so "no rule anywhere" is detectable.
  const focusRules = rules.filter((r) => r.states.focus);
  const focusSelectors = new Set(focusRules.map((r) => r.selectorText));

  // A stylesheet that removes the outline without replacing it is worse than
  // one that never touches it.
  const outlineRemoved = focusRules.filter((r) =>
    r.declarations.some((d) =>
      (d.property === "outline" && /^(none|0)$/.test(d.value.trim())) ||
      (d.property === "outline-width" && /^0(px)?$/.test(d.value.trim()))),
  );
  const focusWithReplacement = new Set();
  for (const rule of focusRules) {
    const hasRing = rule.declarations.some(
      (d) =>
        (d.property === "outline" && !/^none$/.test(d.value.trim())) ||
        d.property === "outline-width" ||
        d.property === "outline-color" ||
        d.property === "box-shadow" ||
        d.property === "text-decoration" ||
        d.property === "border" ||
        d.property === "border-color",
    );
    if (hasRing) focusWithReplacement.add(rule.selectorText);
  }

  for (const node of root.descendants()) {
    if (!isInteractive(node)) continue;
    if (["label"].includes(node.tag)) continue;
    const style = node.computed;
    if (style && (style.display === "none" || style.visibility === "hidden")) continue;
    // Only the outermost control in a chain needs the ring.
    if (node.parent && isInteractive(node.parent)) continue;

    const name = accessibleName(node, root) || node.tag;

    // Does any focus rule in the sheet plausibly target this control?
    const targeted = [...focusSelectors].some((sel) => {
      const s = sel.replace(/:focus(-visible)?/, "");
      if (!s.trim()) return true; // a bare :focus rule applies to everything
      try {
        // Imported lazily to avoid a circular import at module load.
        return cssMatches(s, node);
      } catch {
        return false;
      }
    });

    if (!targeted) {
      findings.push({
        check: "focus-indicator",
        severity: SEVERITY.error,
        path: node.path(),
        line: node.line,
        message: `"${name}" has no :focus or :focus-visible style, so keyboard focus is invisible`,
        detail: { name, tag: node.tag },
      });
      continue;
    }

    // The ring is suppressed and nothing puts it back.
    const suppressed = outlineRemoved.some((r) => {
      const s = r.selectorText.replace(/:focus(-visible)?/, "");
      try {
        return !s.trim() || cssMatches(s, node);
      } catch {
        return false;
      }
    });
    if (suppressed && ![...focusWithReplacement].some((sel) => {
      const s = sel.replace(/:focus(-visible)?/, "");
      try {
        return !s.trim() || cssMatches(s, node);
      } catch {
        return false;
      }
    })) {
      findings.push({
        check: "focus-indicator",
        severity: SEVERITY.error,
        path: node.path(),
        line: node.line,
        message: `"${name}" removes the focus outline and replaces it with nothing`,
        detail: { name },
      });
    }
  }
  return findings;
}

/**
 * Check state coverage: which required states are missing for each control.
 * Driven by the real markup, so three buttons with no focus rule give three
 * findings rather than one summary line.
 */
export function checkStates(root, rules) {
  const elements = [...root.descendants()];
  const matrix = matrixFromRules(rules, { elements });
  return auditStates(elements, matrix).map((f) => ({
    check: "state-coverage",
    // A control missing several required states is a real gap.
    severity: f.missing.length > 1 ? SEVERITY.error : SEVERITY.warning,
    path: f.path,
    line: f.line,
    message: `${STATE_SETS[f.kind].label} is missing: ${f.missing.join(", ")}`,
    // Promoted to the top level so a JSON consumer does not have to reach into
    // detail to learn which state is absent.
    missing: f.missing,
    kind: f.kind,
    detail: { kind: f.kind, missing: f.missing, expected: f.expected, note: f.note },
  }));
}

/**
 * Check narrow-viewport overflow.
 *
 * Looks for declared widths that cannot fit in 390px, horizontal overflow rules,
 * and fixed minimum widths. This is a static approximation: it catches the
 * common "I set width: 900px" mistake, not real layout reflow. scripts/shot.mjs
 * takes real screenshots at 390 to cover the rest.
 */
export function checkNarrow(root, { width = NARROW } = {}) {
  const findings = [];
  for (const node of root.descendants()) {
    const style = node.computed;
    if (!style) continue;
    if (["script", "style", "head", "title", "template"].includes(node.tag)) continue;

    const w = px(style.width, { fontSize: px(style["font-size"]) ?? 16 });
    const minW = px(style["min-width"], { fontSize: px(style["font-size"]) ?? 16 });
    const padL = px(style["padding-left"]) ?? 0;
    const padR = px(style["padding-right"]) ?? 0;

    const effective = w ?? minW;
    if (effective !== null && effective + padL + padR > width) {
      findings.push({
        check: "narrow-overflow",
        severity: SEVERITY.error,
        path: node.path(),
        line: node.line,
        message: `declared width ${(effective + padL + padR).toFixed(0)}px cannot fit in ${width}px`,
        detail: {
          width: effective,
          padding: padL + padR,
          viewport: width,
          property: w !== null ? "width" : "min-width",
        },
      });
    }
  }
  return findings;
}

/**
 * Check that motion respects prefers-reduced-motion.
 *
 * A transition or animation with no reduced-motion guard makes the interface
 * unusable for people who get motion sick from it. The check looks for the
 * guard in the same stylesheet.
 */
export function checkMotion(root, rawCss) {
  const findings = [];
  const css = String(rawCss ?? "");

  // Does the sheet handle the preference at all?
  const hasReducedMotion = /@media\s*\(\s*prefers-reduced-motion\s*:\s*reduce\s*\)/.test(css);

  // Which elements animate?
  const moving = new Set();
  for (const node of root.descendants()) {
    const style = node.computed;
    if (!style) continue;
    const hasTransition =
      style.transition && style.transition !== "none" && /[0-9]/.test(style.transition);
    const hasAnimation =
      style.animation && style.animation !== "none" && /[0-9]/.test(style.animation);
    if (!hasTransition && !hasAnimation) continue;

    moving.add(node);
    if (hasReducedMotion) continue;

    // The reduced-motion block may still cover this element.
    const covered = cssMentionsReducedMotionFor(css, node);
    if (covered) continue;

    findings.push({
      check: "reduced-motion",
      severity: SEVERITY.error,
      path: node.path(),
      line: node.line,
      message: "element animates but the stylesheet never honours prefers-reduced-motion",
      detail: {
        transition: style.transition ?? null,
        animation: style.animation ?? null,
      },
    });
  }
  return findings;
}

/**
 * Whether the reduced-motion block names this element. A blunt check, and
 * deliberately so: a global `*, *::before { animation: none }` counts, and so
 * does naming the element's own class.
 */
function cssMentionsReducedMotionFor(css, node) {
  const blocks = css.match(/@media[^{]*prefers-reduced-motion[^{]*\{(?:[^{}]*\{[^{}]*\}\s*)*\}/g) || [];
  for (const block of blocks) {
    if (/\*\s*[,{]/.test(block)) return true;
    for (const cls of node.classes) {
      if (block.includes(`.${cls}`)) return true;
    }
    if (node.attrs.id && block.includes(`#${node.attrs.id}`)) return true;
    if (block.includes(node.tag)) return true;
  }
  return false;
}

/**
 * Check that meaning is not carried by colour alone.
 *
 * A red border on an invalid field, or a switch whose only difference between
 * on and off is its background, is invisible to a colour-blind reader and
 * invisible in a screenshot printed in greyscale. The finding names the element
 * and says what else should be there.
 */
export function checkColorOnly(root, rules) {
  const findings = [];
  for (const node of root.descendants()) {
    if (!isInteractive(node)) continue;
    const style = node.computed;
    if (!style) continue;

    const type = (node.attrs.type || "").toLowerCase();
    const role = (node.attrs.role || "").toLowerCase();
    const isToggle = ["checkbox", "radio"].includes(type) || ["checkbox", "radio", "switch"].includes(role);
    if (!isToggle) continue;

    // A native control draws its own checkmark, so only custom ones matter.
    const isCustom = style.appearance === "none" || style.appearance === "none ";
    if (!isCustom) continue;

    // Does the checked state change anything other than a colour?
    const hasIndicator =
      node.children.length > 0 ||
      node.hasClass("with-check") ||
      node.hasClass("has-indicator") ||
      node.hasClass("has-knob");

    // A checked rule that adds a shape, a border or a shadow is a real signal.
    // The pseudo-element is stripped before matching, because a selector like
    // `.switch[aria-checked="true"]::after` describes the knob and cannot match
    // the button itself.
    const checkedRules = rules.filter((r) => r.states.checked);
    const addsShape = checkedRules.some((r) => {
      const stripped = r.selectorText
        .replace(/:checked/g, "")
        .replace(/\[aria-checked=["']?true["']?\]/g, "")
        .replace(/::[a-z-]+(\([^)]*\))?/g, "")
        .trim();
      const touchesNode = stripped === "" || selectorTargets(stripped, node);
      if (!touchesNode) return false;
      // The rule targets a pseudo-element, which is how a knob or a checkmark
      // is usually drawn.
      if (/::[a-z-]+/.test(r.selectorText)) return true;
      return r.declarations.some((d) =>
        ["box-shadow", "border", "border-width", "outline", "background-image", "transform"].includes(d.property));
    });

    // An explicit aria-checked attribute plus a visible label is acceptable.
    if (!hasIndicator && !addsShape) {
      findings.push({
        check: "color-only",
        severity: SEVERITY.warning,
        path: node.path(),
        line: node.line,
        message: `${type || role} signals its on/off state with colour alone; add a knob, checkmark or shape`,
        detail: { tag: node.tag, type, role, appearance: style.appearance ?? null },
      });
    }
  }
  return findings;
}

/** Does a stripped selector target this node? Thin wrapper to avoid a cycle. */
function selectorTargets(selector, node) {
  try {
    return cssMatches(selector, node);
  } catch {
    return false;
  }
}

// Imported at the bottom to keep the public surface of this file tidy while
// still avoiding a circular import at load time.
import { matches as cssMatches } from "./css.mjs";

/**
 * Run every check and produce a report.
 *
 * `report.ok` is true only when no error-severity finding remains. The CLI
 * exits non-zero on `!ok`, which is what makes the whole thing a gate rather
 * than a suggestion.
 */
export function audit(html, options = {}) {
  const {
    theme = "light",
    checks = ["contrast", "tap-target", "accessible-name", "focus-indicator", "state-coverage", "narrow-overflow", "reduced-motion", "color-only"],
    minContrast = null,
    tapMin = MIN_TAP.minimum,
    viewport = NARROW,
  } = options;

  const { root, rules, raw } = load(html, options);
  styleTree(root, rules, { theme });

  const findings = [];
  const run = (name, fn) => {
    if (!checks.includes(name)) return;
    findings.push(...fn());
  };

  run("contrast", () => checkContrast(root, { theme, minRatio: minContrast }));
  run("tap-target", () => checkTapTargets(root, { min: tapMin }));
  run("accessible-name", () => checkNames(root));
  run("focus-indicator", () => checkFocus(root, rules, { theme }));
  run("state-coverage", () => checkStates(root, rules));
  run("narrow-overflow", () => checkNarrow(root, { width: viewport }));
  run("reduced-motion", () => checkMotion(root, raw));
  run("color-only", () => checkColorOnly(root, rules));

  const byCheck = {};
  for (const f of findings) {
    byCheck[f.check] = byCheck[f.check] || { error: 0, warning: 0, note: 0 };
    byCheck[f.check][f.severity]++;
  }

  const errors = findings.filter((f) => f.severity === SEVERITY.error).length;
  const warnings = findings.filter((f) => f.severity === SEVERITY.warning).length;
  const notes = findings.filter((f) => f.severity === SEVERITY.note).length;

  const elements = [...root.descendants()];
  return {
    ok: errors === 0,
    findings,
    byCheck,
    errors,
    warnings,
    notes,
    counts: {
      elements: elements.length,
      controls: elements.filter(isInteractive).length,
      rules: rules.length,
    },
    // Built with the markup in hand, so `.c:hover` counts for the switch that
    // `.c` actually is rather than only for selectors that spell out a kind.
    matrix: matrixFromRules(rules, { elements }),
  };
}

/**
 * Render a report as text. Sorted so the worst problems are at the top and the
 * output is stable between runs, which matters when CI diffs it.
 */
export function render(result, { title = "audit", theme = "light" } = {}) {
  const lines = [];
  lines.push(`${title}: ${result.ok ? "PASS" : "FAIL"}`);
  lines.push(
    `${result.counts.elements} elements, ${result.counts.controls} controls, ${result.counts.rules} rules`,
  );
  lines.push(
    `${result.errors} errors, ${result.warnings} warnings, ${result.notes} notes`,
  );

  const order = { error: 0, warning: 1, note: 2 };
  const sorted = [...result.findings].sort(
    (a, b) => order[a.severity] - order[b.severity] || a.check.localeCompare(b.check) || (a.line ?? 0) - (b.line ?? 0),
  );

  if (sorted.length) {
    lines.push("");
    let lastCheck = null;
    for (const f of sorted) {
      if (f.check !== lastCheck) {
        lines.push(`── ${f.check}`);
        lastCheck = f.check;
      }
      const where = f.line ? `${f.path}:${f.line}` : f.path;
      lines.push(`   [${f.severity}] ${where}`);
      lines.push(`      ${f.message}`);
    }
  }

  lines.push("");
  lines.push(`state matrix (${theme}):`);
  lines.push(renderMatrixText(result.matrix));

  return lines.join("\n");
}

/** The state matrix as a compact table, for the end of the report. */
function renderMatrixText(matrix) {
  const kinds = Object.keys(STATE_SETS).filter(
    (k) => statesFor(matrix, k).size > 0,
  );
  if (!kinds.length) return "   (no component styles found)";

  // Columns are every state anyone claims, sorted, so the table is stable and a
  // missing state is visible as a dot rather than as an absent column.
  const allStates = new Set();
  for (const kind of kinds) {
    for (const s of statesFor(matrix, kind)) allStates.add(s);
  }
  if (!allStates.size) return "   (no state rules found)";
  const cols = [...allStates].sort();

  const pad = (s, n) => String(s).padEnd(n);
  const kindWidth = Math.max(12, ...kinds.map((k) => STATE_SETS[k].label.length + 1));
  const head = pad("component", kindWidth) + cols.map((s) => pad(s, Math.max(7, s.length + 1))).join("");
  const rows = kinds.map((kind) => {
    const have = statesFor(matrix, kind);
    return (
      pad(STATE_SETS[kind].label, kindWidth) +
      cols.map((s) => pad(have.has(s) ? "yes" : "·", Math.max(7, s.length + 1))).join("")
    );
  });
  return ["   " + head, ...rows.map((r) => "   " + r)].join("\n");
}
