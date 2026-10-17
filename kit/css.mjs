// CSS parsing and cascade. No dependencies.
//
// The audit needs to answer one question that forces a real cascade engine:
// "what colour is this text, on what background, at this font size?" Answering it
// with a regex over the stylesheet cannot work, because the answer depends on
// specificity, source order, inheritance, custom properties and !important.
//
// Scope: the subset of CSS that decides the cascade. Selectors, media queries,
// custom properties, shorthand expansion for the handful of properties the audit
// reads, and the state pseudos (hover, focus, active, disabled, checked) so the
// state matrix can be extracted from the same source of truth.

import { parse as parseColor, composite, contrast, luminance } from "./color.mjs";

/**
 * Shorthands the audit understands, as longhand entries.
 * Only the ones that matter for colour and text measurement.
 */
const SHORTHAND = {
  margin: ["margin-top", "margin-right", "margin-bottom", "margin-left"],
  padding: ["padding-top", "padding-right", "padding-bottom", "padding-left"],
  "border-color": ["border-top-color", "border-right-color", "border-bottom-color", "border-left-color"],
  "border-width": ["border-top-width", "border-right-width", "border-bottom-width", "border-left-width"],
  "border-style": ["border-top-style", "border-right-style", "border-bottom-style", "border-left-style"],
  "border-radius": ["border-top-left-radius", "border-top-right-radius", "border-bottom-right-radius", "border-bottom-left-radius"],
};

/** Properties that inherit from parent to child. */
const INHERITED = new Set([
  "color", "font", "font-family", "font-size", "font-style", "font-weight",
  "font-variant", "line-height", "letter-spacing", "word-spacing",
  "text-align", "text-indent", "text-transform", "visibility", "white-space",
  "list-style", "list-style-type", "cursor", "direction", "tab-size",
  "font-feature-settings", "font-variant-numeric", "caret-color",
]);

/** Split a declaration value on top-level whitespace, respecting functions. */
function splitTop(value, sep = " ") {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of value) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (depth === 0 && (sep === " " ? /\s/.test(ch) : ch === sep)) {
      if (cur.trim()) out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/** Strip /* *\/ comments from CSS source, keeping string contents intact. */
function stripComments(css) {
  let out = "";
  let i = 0;
  while (i < css.length) {
    if (css[i] === "/" && css[i + 1] === "*") {
      const end = css.indexOf("*/", i + 2);
      // Replace with a space so "a/**/b" does not become "ab".
      out += " ";
      i = end === -1 ? css.length : end + 2;
      continue;
    }
    if (css[i] === '"' || css[i] === "'") {
      const quote = css[i];
      out += css[i];
      i++;
      while (i < css.length) {
        out += css[i];
        if (css[i] === "\\") {
          out += css[i + 1] ?? "";
          i += 2;
          continue;
        }
        if (css[i] === quote) {
          i++;
          break;
        }
        i++;
      }
      continue;
    }
    out += css[i];
    i++;
  }
  return out;
}

/**
 * Specificity as a comparable [a, b, c]:
 *   a = id count, b = class/attribute/pseudo-class count, c = type/pseudo-element count.
 *
 * The selector is walked once, token by token. Counting with three separate
 * regexes looks simpler but double-counts, because a pseudo-element like
 * `::before` also matches a looser pseudo-class pattern.
 */
export function specificity(selector) {
  let a = 0;
  let b = 0;
  let c = 0;

  // The combinators and the universal selector carry nothing.
  const s = String(selector).replace(/[>+~,]/g, " ");

  let i = 0;
  while (i < s.length) {
    const ch = s[i];

    if (ch === "#") {
      a++;
      i++;
      while (i < s.length && /[\w-]/.test(s[i])) i++;
      continue;
    }
    if (ch === ".") {
      b++;
      i++;
      while (i < s.length && /[\w-]/.test(s[i])) i++;
      continue;
    }
    if (ch === "[") {
      b++;
      const end = s.indexOf("]", i);
      i = end === -1 ? s.length : end + 1;
      continue;
    }
    if (ch === ":") {
      // "::x" is a pseudo-element (counts as a type); ":x" is a pseudo-class.
      const isElement = s[i + 1] === ":";
      const nameMatch = /^:{1,2}[a-zA-Z-]+/.exec(s.slice(i));
      const name = nameMatch ? nameMatch[0] : ":";
      i += name.length;
      // Skip any argument list, keeping its text so :not()/:is() can contribute
      // their own specificity.
      let argText = null;
      if (s[i] === "(") {
        const start = i + 1;
        let depth = 0;
        while (i < s.length) {
          if (s[i] === "(") depth++;
          else if (s[i] === ")") {
            depth--;
            if (depth === 0) {
              argText = s.slice(start, i);
              i++;
              break;
            }
          }
          i++;
        }
      }
      const bare = name.replace(/^:+/, "");
      if (["not", "is", "matches", "has"].includes(bare)) {
        // These take the specificity of their most specific argument.
        // :where() is the exception: it always contributes zero.
        for (const part of splitSelectorList(argText ?? "")) {
          const sub = specificity(part);
          a += sub[0];
          b += sub[1];
          c += sub[2];
        }
        continue;
      }
      if (isElement) c++;
      else b++;
      continue;
    }
    if (/[a-zA-Z]/.test(ch)) {
      c++;
      while (i < s.length && /[\w-]/.test(s[i])) i++;
      continue;
    }
    i++;
  }
  return [a, b, c];
}

/** Compare two specificity triples. */
export function compareSpecificity(x, y) {
  for (let i = 0; i < 3; i++) {
    if (x[i] !== y[i]) return x[i] - y[i];
  }
  return 0;
}

/** Split a selector list on top-level commas. */
function splitSelectorList(text) {
  const out = [];
  let depth = 0;
  let cur = "";
  for (const ch of text) {
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === "," && depth === 0) {
      out.push(cur.trim());
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur.trim());
  return out;
}

/**
 * One parsed rule.
 *
 * `states` records which interaction pseudos the selector carries, so the state
 * matrix can be built from the stylesheet rather than from a hand-kept list:
 * { hover: true, focus: true } for `.btn:hover, .btn:focus-visible`.
 */
class Rule {
  constructor(selector, declarations, { media = null, layer = null, index = 0, supports = null } = {}) {
    this.selector = selector;
    this.selectorText = selector;
    this.declarations = declarations;
    this.media = media;
    this.layer = layer;
    this.supports = supports;
    this.index = index;
    this.specificity = specificity(selector);
    this.states = statesOf(selector);
  }
}

/** Which interaction states a selector mentions. */
export function statesOf(selector) {
  const states = {};
  if (/:hover/.test(selector)) states.hover = true;
  if (/:focus-visible/.test(selector)) states.focus = true;
  else if (/:focus/.test(selector)) states.focus = true;
  if (/:active/.test(selector)) states.active = true;
  if(/:disabled/.test(selector) || /\[disabled\]/.test(selector)) states.disabled = true;
  if (/:checked/.test(selector) || /\[aria-checked/.test(selector)) states.checked = true;
  if (/:valid/.test(selector)) states.valid = true;
  if (/:invalid/.test(selector)) states.invalid = true;
  if (/:required/.test(selector) || /\[required\]/.test(selector)) states.required = true;
  if (/:target/.test(selector)) states.target = true;
  if (/\[[a-z-]*data-(loading|busy)/.test(selector) || /\[aria-busy/.test(selector)) states.loading = true;
  if (/:empty/.test(selector) || /\[data-empty\]/.test(selector)) states.empty = true;
  // An invalid field can be marked with the attribute as well as with the pseudo
  // class, and the attribute form is what a server-rendered page uses.
  if (/\[aria-invalid=["']?true/.test(selector)) states.invalid = true;
  if (/\[aria-current/.test(selector) || /\[aria-selected/.test(selector)) states.current = true;
  return states;
}

/**
 * Parse a stylesheet into rules.
 *
 * Handles nested at-rules (@media, @supports, @layer, @container) by recording the
 * condition on each rule, and CSS nesting by treating a nested selector as if it
 * were written with the parent prefix.
 */
export function parseCSS(source) {
  const css = stripComments(String(source ?? ""));
  const rules = [];
  let index = 0;
  let media = null;
  let layer = null;
  let supports = null;

  // Walk the source, tracking brace depth so at-rule preludes can be read.
  let i = 0;
  let parentSelectors = [];

  while (i < css.length) {
    // Skip whitespace and stray semicolons.
    if (/\s/.test(css[i]) || css[i] === ";") {
      i++;
      continue;
    }

    const braceAt = findNext(css, "{", i);

    // A declaration directly inside a rule, i.e. nested CSS.
    if (braceAt === -1) {
      const tail = css.slice(i);
      if (tail.trim()) {
        for (const sel of parentSelectors) {
          rules.push(new Rule(sel, parseDeclarations(tail), { media, layer, supports, index: index++ }));
        }
      }
      break;
    }

    const prelude = css.slice(i, braceAt).trim();

    // At-rule with a block.
    if (prelude.startsWith("@")) {
      const name = /^@([\w-]+)/.exec(prelude)?.[1]?.toLowerCase();
      const body = readBlock(css, braceAt);
      const after = braceAt + body.length;

      if (name === "media") {
        // The nested rules see the parent condition ANDed with this one.
        rules.push(...parseNested(body, parentSelectors, andCondition(media, prelude), layer, supports));
        index = rules.length;
      } else if (name === "supports") {
        rules.push(...parseNested(body, parentSelectors, media, layer, andCondition(supports, prelude)));
        index = rules.length;
      } else if (name === "layer") {
        rules.push(...parseNested(body, parentSelectors, media, prelude, supports));
        index = rules.length;
      } else if (name === "container" || name === "scope") {
        // Treated as a plain group: the audit cannot evaluate container queries,
        // so rules inside are kept and judged by their declarations alone.
        rules.push(...parseNested(body, parentSelectors, media, layer, supports));
        index = rules.length;
      } else if (name === "keyframes" || name === "font-face" || name === "property") {
        // Declarations that are not rules. prefers-reduced-motion is read from
        // the raw source, so these can be skipped.
        i = after;
        continue;
      } else {
        i = after;
        continue;
      }
      i = after;
      continue;
    }

    // An ordinary rule.
    const body = readBlock(css, braceAt);
    const inner = body.slice(1, -1);
    const selectors = splitSelectorList(prelude);

    // Nested CSS: a rule body may hold both declarations and further rules.
    const split = splitNestedRules(inner);
    const declarations = parseDeclarations(split.declarations);
    for (const sel of selectors) {
      rules.push(new Rule(sel, declarations, { media, layer, supports, index: index++ }));
    }

    // The nested section is a run of "selector { body }" pairs. Each is parsed
    // by the same walker, but through a helper that does not re-enter this
    // function's nesting branch: round-tripping through parseCSS would treat the
    // nested selector as a prelude again and recurse forever.
    if (split.nested.trim()) {
      for (const { selector, body: nestedBody } of readNestedPairs(split.nested)) {
        const innerSplit = splitNestedRules(nestedBody);
        const nestedDecls = parseDeclarations(innerSplit.declarations);
        // "&" stands for the parent selector; without it the descendant form
        // is implied, per the CSS nesting spec.
        const combined = selector.includes("&")
          ? splitSelectorList(selector).map((s) => s.replace(/&/g, selectors[0]))
          : selectors.map((p) => `${p} ${selector}`);
        for (const sel of combined) {
          rules.push(new Rule(sel, nestedDecls, { media, layer, supports, index: index++ }));
        }
        // One level of nesting is enough for hand-written interface CSS, so any
        // deeper content is parsed as further rules of the nested rule.
        if (innerSplit.nested.trim()) {
          for (const deeper of readNestedPairs(innerSplit.nested)) {
            const deeperDecls = parseDeclarations(deeper.body);
            const deeperSel = deeper.selector.includes("&")
              ? deeper.selector.replace(/&/g, combined[0])
              : `${combined[0]} ${deeper.selector}`;
            rules.push(new Rule(deeperSel, deeperDecls, { media, layer, supports, index: index++ }));
          }
        }
      }
    }

    i = braceAt + body.length;
  }

  return rules;
}

/**
 * Read a run of "selector { body }" pairs out of a nested rule section.
 * Returns [{ selector, body }] with the braces removed from the body.
 */
function readNestedPairs(section) {
  const out = [];
  let i = 0;
  while (i < section.length) {
    if (/\s/.test(section[i]) || section[i] === ";") {
      i++;
      continue;
    }
    const braceAt = findNext(section, "{", i);
    if (braceAt === -1) break;
    const selector = section.slice(i, braceAt).trim();
    const body = readBlock(section, braceAt);
    if (selector) out.push({ selector, body: body.slice(1, -1) });
    i = braceAt + body.length;
  }
  return out;
}
function wrapRule(selector, body) {
  return `${selector.replace(/[{}]/g, "")}{${body}}`;
}

/**
 * Split a rule body into its own declarations and any nested rules.
 *
 * Declarations always precede nested rules in valid CSS. So the split point is
 * the first "{" that opens a nested rule: everything before the nested rule's
 * selector is this rule's declarations, and the selector starts just after the
 * last declaration separator.
 *
 * The tricky part is finding where the nested selector begins. Scanning forward
 * from the "{" only finds the body, so the start is found by walking back to
 * the previous ";" / "{" / "}" at depth 0.
 */
function splitNestedRules(inner) {
  let depth = 0;
  let quote = null;
  let openAt = -1;

  for (let i = 0; i < inner.length; i++) {
    const ch = inner[i];
    if (quote) {
      if (ch === "\\") i++;
      else if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      continue;
    }
    if (ch === "(") depth++;
    else if (ch === ")") depth--;
    else if (ch === "{") {
      if (depth === 0) {
        // This opens a nested rule.
        openAt = i;
        break;
      }
      depth++;
    } else if (ch === "}") {
      if (depth > 0) depth--;
    }
  }

  if (openAt === -1) return { declarations: inner, nested: "" };

  // Walk back from the "{" to the start of the nested selector.
  let start = openAt;
  let d = 0;
  let q = null;
  for (let i = openAt - 1; i >= 0; i--) {
    const ch = inner[i];
    if (q) {
      if (ch === q) q = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      q = ch;
      continue;
    }
    if (ch === ")") d++;
    else if (ch === "(") d--;
    else if (d === 0 && (ch === ";" || ch === "{" || ch === "}")) {
      start = i + 1;
      break;
    }
    if (i === 0) start = 0;
  }

  return {
    declarations: inner.slice(0, start),
    nested: inner.slice(start),
  };
}

/**
 * Parse the rules inside an at-rule body, re-tagging each with the condition
 * of the at-rule that contained it. The braces are stripped first, because
 * parseCSS expects a body, not a wrapped block.
 */
function parseNested(body, parentSelectors, media, layer, supports) {
  const inner = parseCSS(body.replace(/^\s*\{/, "").replace(/\}\s*$/, ""));
  return inner.map((r) => new Rule(r.selector, r.declarations, { media, layer, supports, index: 0 }));
}

/** Combine two at-rule preludes into a single condition string. */
function andCondition(existing, prelude) {
  const inner = prelude.replace(/^@[\w-]+\s*/, "").trim();
  const cond = inner.replace(/^(screen|all)\s+and\s+/, "");
  if (!existing) return cond;
  if (!cond) return existing;
  return `${existing} and ${cond}`;
}

/** Find the next index of ch at brace depth 0, or -1. */
function findNext(css, ch, from) {
  let depth = 0;
  let quote = null;
  for (let i = from; i < css.length; i++) {
    const c = css[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "(") depth++;
    else if (c === ")") depth--;
    else if (depth === 0 && c === ch) return i;
  }
  return -1;
}

/** Read a `{...}` block including the braces. */
function readBlock(css, at) {
  let depth = 0;
  let quote = null;
  for (let i = at; i < css.length; i++) {
    const c = css[i];
    if (quote) {
      if (c === "\\") i++;
      else if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === "{") depth++;
    else if (c === "}") {
      depth--;
      if (depth === 0) return css.slice(at, i + 1);
    }
  }
  return css.slice(at);
}

/**
 * Parse a declaration block into { property, value, important } records,
 * expanding the shorthands the audit cares about.
 */
export function parseDeclarations(block) {
  const out = [];
  for (const chunk of splitDeclarations(block)) {
    const idx = chunk.indexOf(":");
    if (idx === -1) continue;
    const prop = chunk.slice(0, idx).trim().toLowerCase();
    let value = chunk.slice(idx + 1).trim();
    if (!prop || !value) continue;
    let important = false;
    if (/!\s*important$/i.test(value)) {
      important = true;
      value = value.replace(/!\s*important$/i, "").trim();
    }
    if (!value) continue;
    out.push({ property: prop, value, important });

    // Expand shorthand into longhands so the cascade sees individual properties.
    const targets = SHORTHAND[prop];
    if (targets) {
      const parts = splitTop(value);
      const sides = {
        "margin-top": parts[0], "margin-right": parts[1] ?? parts[0],
        "margin-bottom": parts[2] ?? parts[0], "margin-left": parts[3] ?? parts[1] ?? parts[0],
        "padding-top": parts[0], "padding-right": parts[1] ?? parts[0],
        "padding-bottom": parts[2] ?? parts[0], "padding-left": parts[3] ?? parts[1] ?? parts[0],
        "border-top-color": parts[0], "border-right-color": parts[1] ?? parts[0],
        "border-bottom-color": parts[2] ?? parts[0], "border-left-color": parts[3] ?? parts[1] ?? parts[0],
        "border-top-width": parts[0], "border-right-width": parts[1] ?? parts[0],
        "border-bottom-width": parts[2] ?? parts[0], "border-left-width": parts[3] ?? parts[1] ?? parts[0],
        "border-top-style": parts[0], "border-right-style": parts[1] ?? parts[0],
        "border-bottom-style": parts[2] ?? parts[0], "border-left-style": parts[3] ?? parts[1] ?? parts[0],
        "border-top-left-radius": parts[0], "border-top-right-radius": parts[1] ?? parts[0],
        "border-bottom-right-radius": parts[2] ?? parts[0], "border-bottom-left-radius": parts[3] ?? parts[1] ?? parts[0],
      };
      for (const t of targets) {
        if (sides[t] !== undefined) out.push({ property: t, value: sides[t], important });
      }
    }
  }
  return out;
}

/** Split on semicolons at depth 0, respecting strings and functions. */
function splitDeclarations(block) {
  const out = [];
  let depth = 0;
  let quote = null;
  let cur = "";
  for (let i = 0; i < block.length; i++) {
    const ch = block[i];
    if (quote) {
      cur += ch;
      if (ch === "\\") {
        cur += block[++i] ?? "";
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      cur += ch;
      continue;
    }
    if (ch === "(") depth++;
    if (ch === ")") depth--;
    if (ch === ";" && depth === 0) {
      out.push(cur);
      cur = "";
      continue;
    }
    cur += ch;
  }
  if (cur.trim()) out.push(cur);
  return out.filter((s) => s.trim());
}

/**
 * Does a selector match an element?
 *
 * Supports descendant, child, adjacent sibling, general sibling, compound
 * selectors, and the pseudo-classes the audit needs. Unknown pseudo-classes
 * return false rather than true, so the audit never claims a match it cannot
 * justify.
 */
export function matches(selector, node, context = {}) {
  const parts = splitCompound(selector);
  return matchChain(parts, node, context);
}

/**
 * Split "a > b c" into compound selectors separated by combinators.
 *
 * Returns ["a", ">", "b", " ", "c"] — descendant combinators are emitted as a
 * bare " " token. Whitespace must become an explicit token here, otherwise
 * "ul li" arrives at the matcher as one compound named "ul li" that can never
 * match anything.
 */
/**
 * Split a selector into compounds and combinators.
 *
 * Returns tokens like [".list", ">", "li"] or ["#w", " ", "li"]. Whitespace
 * becomes an explicit descendant token only when it separates two compounds:
 * whitespace next to an explicit combinator is just formatting and is dropped.
 * Getting this wrong yields a chain like [" ", ".list", ">", "li"], where the
 * stray descendant token makes every selector fail to match.
 */
function splitCompound(selector) {
  const out = [];
  let cur = "";
  let depth = 0;

  const pushCur = () => {
    const t = cur.trim();
    cur = "";
    if (t) out.push(t);
    return t;
  };

  for (let i = 0; i < selector.length; i++) {
    const ch = selector[i];

    if (ch === "(") {
      depth++;
      cur += ch;
      continue;
    }
    if (ch === ")") {
      depth--;
      cur += ch;
      continue;
    }

    if (depth === 0 && (ch === ">" || ch === "+" || ch === "~")) {
      pushCur();
      // Whitespace immediately before an explicit combinator is formatting.
      while (out.length && out[out.length - 1] === " ") out.pop();
      out.push(ch);
      continue;
    }

    if (depth === 0 && /\s/.test(ch)) {
      if (cur.trim()) {
        pushCur();
        // Only a real descendant if a compound follows before any combinator.
        out.push(" ");
      }
      continue;
    }

    cur += ch;
  }

  pushCur();
  // Drop a trailing or doubled descendant token.
  for (let i = out.length - 1; i >= 0; i--) {
    if (out[i] === " " && (i === 0 || out[i - 1] === " " || out[i - 1] === ">" || out[i - 1] === "+" || out[i - 1] === "~")) {
      out.splice(i, 1);
    }
  }
  return out;
}

/** Match a chain of compounds and combinators, right to left. */
function matchChain(parts, node, context) {
  if (!node) return false;
  if (!parts.length) return true;
  const last = parts[parts.length - 1];
  if (!matchCompound(last, node, context)) return false;
  const rest = parts.slice(0, -1);

  if (!rest.length) return true;
  const combinator = rest.pop();

  if (combinator === ">") {
    // A child combinator must not walk past the document root.
    return node.parent && node.parent.tag !== "#document"
      ? matchChain(rest, node.parent, context)
      : false;
  }
  if (combinator === "+") {
    const prev = previousSibling(node);
    return prev ? matchChain(rest, prev, context) : false;
  }
  if (combinator === "~") {
    let prev = previousSibling(node);
    while (prev) {
      if (matchChain(rest, prev, context)) return true;
      prev = previousSibling(prev);
    }
    return false;
  }
  // Descendant: walk up every ancestor, stopping at the document root, which is
  // a synthetic node that no selector can match.
  let anc = node.parent;
  while (anc && anc.tag !== "#document") {
    if (matchChain(rest, anc, context)) return true;
    anc = anc.parent;
  }
  return false;
}

function previousSibling(node) {
  const p = node.parent;
  if (!p) return null;
  const i = p.children.indexOf(node);
  return i > 0 ? p.children[i - 1] : null;
}

/** Match one compound selector against one element. */
function matchCompound(compound, node, context) {
  if (!node.tag || node.tag === "#document") return false;
  let rest = compound.trim();
  if (!rest) return false;

  // Universal selector.
  rest = rest.replace(/^\*/, "");

  // Tag name.
  const tagMatch = /^([a-z][\w-]*)/i.exec(rest);
  let tagName = null;
  if (tagMatch) {
    tagName = tagMatch[1].toLowerCase();
    rest = rest.slice(tagMatch[0].length);
    if (node.tag !== tagName) return false;
  }

  // Walk the remaining simple selectors left to right.
  while (rest.length) {
    const m = /^([#.]?[\w-]+|\[[^\]]*\]|::?[\w-]+(?:\([^)]*\))?)/.exec(rest);
    if (!m) return false;
    const token = m[0];
    rest = rest.slice(token.length);

    if (token.startsWith("#")) {
      if (node.attrs.id !== token.slice(1)) return false;
    } else if (token.startsWith(".")) {
      if (!node.hasClass(token.slice(1))) return false;
    } else if (token.startsWith("[")) {
      if (!matchAttribute(token, node, context)) return false;
    } else if (token.startsWith("::")) {
      // A pseudo-element is never an element, so a selector containing one can
      // never match a node. `.switch::after` must not match the <button
      // class="switch">, or the knob's 20px height would be read as the
      // switch's own size.
      return false;
    } else {
      if (!matchPseudo(token, node, context)) return false;
    }
  }
  return true;
}

/**
 * Match an attribute selector: [type], [type="text"], [type=text], [disabled].
 *
 * A quoted value is compared literally; an unquoted one is an identifier, so it
 * is compared case-insensitively as a plain token.
 */
function matchAttribute(token, node, context) {
  const body = token.slice(1, -1);
  const eq = body.indexOf("=");
  if (eq === -1) {
    const name = body.trim().toLowerCase();
    if (name === "disabled") return node.attrs.disabled !== undefined;
    return node.attrs[name] !== undefined;
  }
  const name = body.slice(0, eq).trim().toLowerCase();
  const op = body[eq];
  let value = body.slice(eq + 1).trim();
  const quoted = /^["']/.test(value);
  value = value.replace(/^["']|["']$/g, "");
  const actual = node.attrs[name];
  if (actual === undefined) return false;
  const a = String(actual);
  if (!quoted) {
    // Unquoted identifier: case-insensitive for HTML attributes.
    return a.toLowerCase() === value.toLowerCase();
  }
  if (op === "^=") return a.startsWith(value);
  if (op === "$=") return a.endsWith(value);
  if (op === "*=") return a.includes(value);
  if (op === "~=") return a.split(/\s+/).includes(value);
  if (op === "|=") return a === value || a.startsWith(`${value}-`);
  return a === value;
}

/** Match a pseudo-class against an element, using the context's current state. */
function matchPseudo(token, node, context) {
  const name = token.slice(1).replace(/\(.*\)$/, "").toLowerCase();
  const state = context.states || {};

  switch (name) {
    case "root": return !node.parent || node.parent.tag === "#document";
    case "first-child": return node.index === 1;
    case "last-child": return isLastChild(node);
    case "only-child": return node.index === 1 && isLastChild(node);
    case "empty": return node.children.length === 0 && !String(node.text).trim();
    case "checked": return state.checked === true;
    case "hover": return state.hover === true;
    case "focus":
    case "focus-visible":
    case "focus-within": return state.focus === true;
    case "active": return state.active === true;
    case "target": return state.target === true;
    case "disabled": return state.disabled === true;
    case "enabled": return state.disabled !== true;
    case "required": return node.attrs.required !== undefined;
    case "optional": return node.attrs.required === undefined;
    case "valid": return state.invalid !== true;
    case "invalid": return state.invalid === true;
    case "in-range": return state.invalid !== true;
    case "read-only": return node.attrs.readonly !== undefined;
    case "placeholder-shown": return state.placeholder === true;
    case "not": {
      const inner = token.slice(token.indexOf("(") + 1, -1);
      return !matches(inner, node, context);
    }
    case "is":
    case "where": {
      const inner = token.slice(token.indexOf("(") + 1, -1);
      return splitSelectorList(inner).some((s) => matches(s, node, context));
    }
    case "nth-child": {
      const arg = token.slice(token.indexOf("(") + 1, -1).trim();
      return matchNth(arg, node.index);
    }
    case "nth-of-type": {
      const arg = token.slice(token.indexOf("(") + 1, -1).trim();
      if (!node.parent) return false;
      const sameTag = node.parent.children.filter((c) => c.tag === node.tag);
      return matchNth(arg, sameTag.indexOf(node) + 1);
    }
    // :hover and friends on a parent are not tracked by this audit.
    default: return false;
  }
}

function isLastChild(node) {
  const p = node.parent;
  if (!p) return true;
  return p.children[p.children.length - 1] === node;
}

/**
 * Evaluate an :nth-child() argument against a 1-based index.
 * Accepts odd, even, a plain number, and the An+B forms.
 */
export function matchNth(arg, index) {
  const a = String(arg).toLowerCase().replace(/\s+/g, "").trim();
  if (!a) return false;
  if (a === "odd") return index % 2 === 1;
  if (a === "even") return index % 2 === 0;

  // An+B, where both parts are optional.
  const m = /^([+-]?\d*)n([+-]\d+)?$/.exec(a);
  if (m) {
    const coeffText = m[1];
    const coeff = coeffText === "" || coeffText === "+" ? 1 : coeffText === "-" ? -1 : parseInt(coeffText, 10);
    const offset = m[2] ? parseInt(m[2], 10) : 0;
    if (!Number.isFinite(coeff) || !Number.isFinite(offset)) return false;
    if (coeff === 0) return index === offset;
    const k = (index - offset) / coeff;
    return Number.isInteger(k) && k >= 0;
  }

  const n = parseInt(a, 10);
  return Number.isFinite(n) && index === n;
}

/**
 * Resolve custom properties and compute the final declaration set for an
 * element.
 *
 * `states` selects which interaction state to evaluate, and `media` which
 * media condition to include. Returns a flat { property: value } object.
 */
export function computeStyle(rules, node, { states = {}, media = null, variables = {} } = {}) {
  const matched = [];

  for (const rule of rules) {
    if (rule.media && media && !conditionHolds(rule.media, media)) continue;
    if (rule.media && !media) {
      // Without a target media, an @media rule is still applied when it is a
      // max-width query, because the audit targets the narrow viewport too.
      if (isNarrowOnly(rule.media) && !isNarrowOnly(media ?? "")) continue;
    }
    if (!matches(rule.selector, node, { states, attributes: node.attrs })) continue;
    matched.push(rule);
  }

  // Cascade order, weakest first, so the last write wins:
  //   layer -> normal declarations (by specificity, then source order)
  //   -> important declarations (by specificity, then source order).
  //
  // Importance is handled per declaration rather than per rule: a rule can mix
  // them (`color: red !important; border: 0`), and promoting the whole rule
  // would let a normal declaration in a "winning" rule overwrite an important
  // one from a weaker rule. So declarations are flattened into a single sorted
  // stream, exactly as the cascade describes.
  const entries = [];
  for (const rule of matched) {
    for (const decl of rule.declarations) {
      entries.push({ rule, decl });
    }
  }
  entries.sort((x, y) => {
    const la = x.rule.layer ?? "";
    const lb = y.rule.layer ?? "";
    if (la !== lb) return la < lb ? -1 : 1;
    // Normal declarations are applied before important ones.
    const ia = x.decl.important ? 1 : 0;
    const ib = y.decl.important ? 1 : 0;
    if (ia !== ib) return ia - ib;
    const s = compareSpecificity(x.rule.specificity, y.rule.specificity);
    if (s !== 0) return s;
    return x.rule.index - y.rule.index;
  });

  const out = {};
  const vars = { ...variables };
  for (const { rule, decl } of entries) {
    if (decl.property.startsWith("--")) {
      vars[decl.property] = decl.value;
      continue;
    }
    out[decl.property] = decl.value;
  }

  // Custom properties feed var() references, and were collected above.
  return { ...resolveVars(out, vars), vars };
}

/** Substitute var(--x, fallback) references. */
export function resolveVars(declarations, vars, depth = 0) {
  if (depth > 10) return declarations;
  const out = {};
  let changed = false;
  for (const [prop, value] of Object.entries(declarations)) {
    if (typeof value !== "string" || !value.includes("var(")) {
      out[prop] = value;
      continue;
    }
    let v = value;
    // var(--name, fallback) — the fallback may itself contain commas and var().
    let guard = 0;
    while (v.includes("var(") && guard++ < 10) {
      const at = v.indexOf("var(");
      let depthP = 0;
      let end = -1;
      for (let i = at + 3; i < v.length; i++) {
        if (v[i] === "(") depthP++;
        else if (v[i] === ")") {
          depthP--;
          if (depthP === 0) {
            end = i;
            break;
          }
        }
      }
      if (end === -1) break;
      const inner = v.slice(at + 4, end);
      const comma = splitTop(inner, ",")[0];
      const parts = splitTop(inner, ",");
      const name = parts[0].trim();
      const fallback = parts.slice(1).join(",").trim();
      const resolved = vars[name] !== undefined ? vars[name] : fallback || "";
      v = v.slice(0, at) + resolved + v.slice(end + 1);
      changed = true;
    }
    out[prop] = v.trim();
  }
  return changed ? resolveVars(out, vars, depth + 1) : out;
}

/** Is a media condition true for a target such as "screen", "print"? */
export function conditionHolds(condition, target) {
  const c = condition.toLowerCase();
  const t = String(target).toLowerCase();
  if (c === t) return true;
  if (c === "all") return true;
  if (c === "screen" && t === "screen") return true;
  // (prefers-color-scheme: dark) matches when the theme is dark.
  const m = /prefers-color-scheme:\s*(dark|light)/.exec(c);
  if (m) return t.includes(m[1]);
  // (max-width: Npx) matches a narrow target.
  const mw = /max-width:\s*([\d.]+)(px|rem|em)/.exec(c);
  if (mw) return t.includes("narrow");
  const minw = /min-width:\s*([\d.]+)(px|rem|em)/.exec(c);
  if (minw) return !t.includes("narrow");
  // hover and pointer queries: the audit checks that they are respected, not
  // that they hold.
  return false;
}

/** A condition that only applies below a width, e.g. max-width media queries. */
export function isNarrowOnly(condition) {
  return /max-width|min-resolution|narrow/.test(String(condition).toLowerCase());
}

/**
 * Walk up the tree composing a background colour.
 * Returns the first opaque background behind an element, which is the colour a
 * label is actually read against.
 */
/**
 * The colour text is actually read against, given the chain of ancestor
 * backgrounds.
 *
 * The chain is ordered outermost first, because that is the order styleTree
 * walks. So the composite starts at the page and works inward: the outermost
 * layer is the backdrop, and each nearer layer paints over it.
 *
 * The direction matters more than it looks. Starting from the innermost layer
 * instead — which is the tempting reading of "the element's own background" —
 * silently produces white for every element that has one, because the first
 * opaque layer found from the inside is usually `body`, and everything painted
 * on top of it is discarded. Every contrast number in the report is then
 * measured against paper.
 */
export function effectiveBackground(parents, { defaultBackground = { r: 255, g: 255, b: 255, a: 1 } } = {}) {
  const layers = [];
  for (const style of parents) {
    const bg = style.backgroundColor || style.background;
    if (!bg) continue;
    const c = parseColor(bg);
    if (!c || c.a === 0) continue;
    layers.push(c);
  }
  if (!layers.length) return defaultBackground;

  // Outermost first: start at the page, then paint each nearer layer over it.
  let out = defaultBackground;
  for (const layer of layers) {
    out = composite(layer, out);
    if (out.a >= 1) {
      // This layer is opaque, so nothing further in can show through. The rest
      // of the chain is still walked only to keep the loop honest about order.
      out.a = 1;
    }
  }
  return out.a >= 1 ? out : composite(out, defaultBackground);
}

/**
 * Resolve a colour that may be expressed as a keyword (currentColor) or
 * reference another element's colour.
 */
export function resolveColorValue(value, style, { parentColor = null } = {}) {
  if (!value) return null;
  const v = String(value).trim();
  if (v === "currentColor") return parseColor(style.color) || (parentColor ? parseColor(parentColor) : null);
  return parseColor(v);
}

export { INHERITED, contrast, luminance, composite, parseColor };
