// A small HTML parser. No dependencies.
//
// Why hand-written: the audit has to know which element sits on which background,
// which control has an accessible name, and which text is inside a real control.
// Reading that back out of a string with regexes is where every other audit
// quietly goes wrong, so this builds an actual tree.
//
// Deliberately not a spec-complete HTML5 parser. It handles the subset that
// appears in hand-written interface markup: elements, attributes, void elements,
// comments, doctype, raw-text elements (script/style/textarea/title), and entity
// decoding in text and attributes. Implicit tag closing is not attempted,
// because every file this skill produces writes its own closing tags.

const VOID = new Set([
  "area", "base", "br", "col", "embed", "hr", "img", "input", "link",
  "meta", "param", "source", "track", "wbr",
]);

/** Elements whose content is text, not markup. */
const RAW_TEXT = new Set(["script", "style", "textarea", "title"]);

/** Elements that never have a child element. */
const SELF_CLOSING_OK = new Set([...VOID, "svg", "path", "circle", "rect", "line", "polyline", "polygon", "g", "use", "defs"]);

const ENTITIES = {
  amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " ",
  mdash: "—", ndash: "–", hellip: "…",
  times: "×", divide: "÷", deg: "°",
  laquo: "«", raquo: "»", copy: "©", reg: "®",
  trade: "™", hellip3: "…", middot: "·",
  larr: "←", rarr: "→", uarr: "↑", darr: "↓",
  check: "✓", cross: "✗", lcheck: "✓",
  bull: "•", dagger: "†", permil: "‰",
  prime: "′", Prime: "″", euro: "€",
  pound: "£", yen: "¥", cent: "¢",
  sect: "§", para: "¶", lsquo: "‘", rsquo: "’",
  ldquo: "“", rdquo: "”", ensp: " ", emsp: " ",
  thinsp: " ", shy: "­", zwj: "‍", zwnj: "‌",
};

/** Decode the HTML entities that matter for reading label text. */
export function decodeEntities(s) {
  if (!s || !s.includes("&")) return s || "";
  return s.replace(/&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g, (match, body) => {
    if (body[0] === "#") {
      const code = body[1] === "x" || body[1] === "X"
        ? parseInt(body.slice(2), 16)
        : parseInt(body.slice(1), 10);
      if (!Number.isFinite(code) || code < 0 || code > 0x10ffff) return match;
      try {
        return String.fromCodePoint(code);
      } catch {
        return match;
      }
    }
    if (Object.hasOwn(ENTITIES, body)) return ENTITIES[body];
    // Unknown named entity: leave it, so the report shows the raw text.
    return match;
  });
}

let uid = 0;

/**
 * One node in the tree.
 *
 * `id` is a stable per-parse handle, not the DOM id. `parent`, `children`,
 * `index` (position among element siblings, 1-based, for :nth-child) and
 * `text` (own text content) are what the audit walks.
 */
class Node {
  constructor(tag, attrs = {}, parent = null) {
    this.tag = tag;
    this.attrs = attrs;
    this.parent = parent;
    this.children = [];
    this.index = 0;
    this.uid = ++uid;
    /** Text directly inside this element, not counting descendants. */
    this.text = "";
    /** For raw-text elements, the unparsed body. */
    this.raw = null;
  }

  /** All descendant elements, in document order. */
  *descendants() {
    for (const c of this.children) {
      yield c;
      yield* c.descendants();
    }
  }

  /** The element itself plus all descendants. */
  *selfAndDescendants() {
    yield this;
    yield* this.descendants();
  }

  /** Direct element children. */
  get kids() {
    return this.children;
  }

  /** Concatenated text of this element and everything under it. */
  get textContent() {
    if (this.raw !== null) return this.raw;
    let out = this.text;
    for (const c of this.children) out += c.textContent;
    return out;
  }

  /** Whitespace-collapsed text, which is what a screen reader announces. */
  get label() {
    return decodeEntities(this.textContent).replace(/\s+/g, " ").trim();
  }

  /** The class list as an array. */
  get classes() {
    const c = this.attrs.class;
    return c ? String(c).split(/\s+/).filter(Boolean) : [];
  }

  /** True when the element carries the given class. */
  hasClass(name) {
    return this.classes.includes(name);
  }

  /** Nearest ancestor (including self) matching a predicate. */
  closest(predicate) {
    let n = this;
    while (n) {
      if (predicate(n)) return n;
      n = n.parent;
    }
    return null;
  }

  /** Nearest ancestor with one of the given tag names. */
  closestTag(...tags) {
    return this.closest((n) => tags.includes(n.tag));
  }

  /** A short readable path from the root, for error messages. */
  path() {
    const parts = [];
    let n = this;
    while (n && n.parent) {
      let part = n.tag;
      if (n.attrs.id) part += `#${n.attrs.id}`;
      else if (n.classes.length) part += `.${n.classes[0]}`;
      parts.unshift(part);
      n = n.parent;
    }
    return parts.join(" > ") || this.tag;
  }

  /** Line number in the source, when known. */
  get line() {
    return this.line0 ?? 0;
  }
}

/** Parse an attribute string into a plain object, lowercasing names. */
function parseAttrs(src) {
  const attrs = {};
  // name, name=value, name="value", name='value', and bare boolean attributes.
  const re = /([^\s"'>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'`=<>]+)))?/g;
  let m;
  while ((m = re.exec(src))) {
    const name = m[1].toLowerCase();
    const value = m[2] ?? m[3] ?? m[4];
    attrs[name] = value === undefined ? "" : decodeEntities(value);
  }
  return attrs;
}

/**
 * Parse an HTML document into a tree.
 *
 * Returns the root node (a synthetic "#document"). Malformed markup does not
 * throw: unbalanced tags are closed at the parent's boundary, which is what
 * browsers do, so a hand-written file with a missing `</div>` still audits.
 */
export function parseHTML(source) {
  uid = 0;
  const root = new Node("#document", {}, null);
  const stack = [root];
  let i = 0;
  const top = () => stack[stack.length - 1];

  // Track line numbers so findings can point at a real place in the file.
  const lineStarts = [0];
  for (let k = 0; k < source.length; k++) if (source[k] === "\n") lineStarts.push(k + 1);
  const lineAt = (pos) => {
    let lo = 0;
    let hi = lineStarts.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (lineStarts[mid] <= pos) lo = mid;
      else hi = mid - 1;
    }
    return lo + 1;
  };

  while (i < source.length) {
    const lt = source.indexOf("<", i);

    if (lt === -1) {
      top().text += source.slice(i);
      break;
    }
    if (lt > i) top().text += source.slice(i, lt);

    // Comment.
    if (source.startsWith("<!--", lt)) {
      const end = source.indexOf("-->", lt + 4);
      i = end === -1 ? source.length : end + 3;
      continue;
    }
    // Doctype and processing instructions.
    if (source.startsWith("<!", lt)) {
      const end = source.indexOf(">", lt);
      i = end === -1 ? source.length : end + 1;
      continue;
    }

    // Closing tag.
    if (source.startsWith("</", lt)) {
      const end = source.indexOf(">", lt);
      const name = source.slice(lt + 2, end === -1 ? source.length : end).trim().toLowerCase();
      // Unwind to the matching open tag, tolerating a missing closer.
      let depth = -1;
      for (let d = stack.length - 1; d >= 1; d--) {
        if (stack[d].tag === name) {
          depth = d;
          break;
        }
      }
      if (depth !== -1) stack.length = depth;
      i = end === -1 ? source.length : end + 1;
      continue;
    }

    // Opening tag.
    const end = findTagEnd(source, lt);
    const inner = source.slice(lt + 1, end);
    const spaceAt = inner.search(/[\s/>]/);
    const tag = (spaceAt === -1 ? inner : inner.slice(0, spaceAt)).toLowerCase();
    const attrSrc = spaceAt === -1 ? "" : inner.slice(spaceAt);

    if (!tag) {
      // A bare "<" in text, like "a < b".
      top().text += "<";
      i = lt + 1;
      continue;
    }

    const attrs = parseAttrs(attrSrc);
    // Per HTML5 a tag name must begin with an ASCII letter. This is what keeps
    // "3<4" and "a < b" as text instead of inventing an element named "4<".
    if (!/^[a-z][a-z0-9-]*/.test(tag)) {
      top().text += "<";
      i = lt + 1;
      continue;
    }
    const node = new Node(tag, attrs, top());
    node.line0 = lineAt(lt);
    node.index = top().children.length + 1;
    top().children.push(node);
    i = end + 1;

    // Raw-text element: consume until its matching close tag.
    if (RAW_TEXT.has(tag)) {
      const closeRe = new RegExp(`</${tag}\\s*>`, "i");
      const rest = source.slice(i);
      const m = closeRe.exec(rest);
      const body = m ? rest.slice(0, m.index) : rest;
      node.raw = body;
      node.text = body;
      i += m ? m.index + m[0].length : rest.length;
      continue;
    }

    // Self-closing, either by slash or by being a void element.
    const selfClosed = /\/\s*$/.test(attrSrc) || VOID.has(tag);
    if (!selfClosed) stack.push(node);
  }

  return root;
}

/**
 * Find the `>` that ends a tag, skipping any inside a quoted attribute value.
 * Without this, `<button title="a > b">` would be cut in half.
 */
function findTagEnd(source, from) {
  let quote = null;
  for (let i = from + 1; i < source.length; i++) {
    const c = source[i];
    if (quote) {
      if (c === quote) quote = null;
      continue;
    }
    if (c === '"' || c === "'") {
      quote = c;
      continue;
    }
    if (c === ">") return i;
  }
  return source.length;
}

/** Every element in the document, in document order. */
export function* elements(root) {
  yield* root.descendants();
}

/** Elements with a given tag name. */
export function byTag(root, ...tags) {
  return [...root.descendants()].filter((n) => tags.includes(n.tag));
}

/**
 * The visible text of a node, with anything inside script/style removed.
 *
 * Honours aria-hidden, which is how a decorative glyph or an icon font is kept
 * out of the accessible name. Without this, `<button><span aria-hidden="true">×
 * </span></button>` reads as a button named "×", which is exactly the bug that
 * makes an icon button announce a multiplication sign to a screen reader.
 */
export function visibleText(node) {
  let out = "";
  const walk = (n) => {
    if (n.tag === "script" || n.tag === "style") return;
    // aria-hidden removes the subtree from the accessibility tree entirely.
    if (n !== node && (n.attrs["aria-hidden"] || "").toLowerCase() === "true") return;
    if (n.raw !== null && RAW_TEXT.has(n.tag)) {
      out += n.raw;
      return;
    }
    out += n.text;
    for (const c of n.children) walk(c);
  };
  walk(node);
  return decodeEntities(out).replace(/\s+/g, " ").trim();
}

/** Elements that are natively interactive, per the HTML spec's focusable set. */
export const INTERACTIVE = new Set([
  "a", "button", "input", "select", "textarea", "summary", "option",
]);

/**
 * Whether an element is interactive for the purposes of this audit: natively
 * interactive, or carrying a role that makes it a control.
 */
export function isInteractive(node) {
  if (INTERACTIVE.has(node.tag)) {
    // An <a> without href is not a control; it is a placeholder.
    if (node.tag === "a" && !node.attrs.href) return false;
    return true;
  }
  const role = (node.attrs.role || "").toLowerCase();
  if (["button", "link", "checkbox", "radio", "switch", "tab", "menuitem",
    "option", "slider", "spinbutton", "combobox", "textbox", "searchbox"].includes(role)) {
    return true;
  }
  // tabindex makes anything focusable and therefore a control.
  if (node.attrs.tabindex !== undefined) return true;
  // A label's control is a control.
  if (node.tag === "label" && (node.attrs.for || node.kids.length)) return true;
  return false;
}

/**
 * Whether the element is disabled. Both the attribute and aria-disabled count,
 * because a control can be visually enabled but semantically inert.
 */
export function isDisabled(node) {
  if (node.attrs.disabled !== undefined) return true;
  if ((node.attrs["aria-disabled"] || "").toLowerCase() === "true") return true;

  // A disabled fieldset disables its descendants, except those inside its first
  // legend, which stay editable so the group can still be labelled.
  for (let fs = node.parent; fs; fs = fs.parent) {
    if (fs.tag !== "fieldset" || fs.attrs.disabled === undefined) continue;
    const legend = fs.children.find((c) => c.tag === "legend");
    if (!legend) return true;
    let inside = false;
    for (const n of legend.selfAndDescendants()) if (n === node) inside = true;
    return !inside;
  }
  return false;
}

/**
 * The accessible name, following the same order as the accname spec:
 * aria-labelledby, aria-label, native label association, then content.
 * Returns null when there is no name at all.
 */
export function accessibleName(node, root) {
  const byId = node.attrs["aria-labelledby"];
  if (byId) {
    const parts = byId.split(/\s+/).map((id) => {
      const target = findById(root, id);
      return target ? visibleText(target) : "";
    }).filter(Boolean);
    if (parts.length) return parts.join(" ");
  }
  const label = node.attrs["aria-label"];
  if (label && String(label).trim()) return String(label).trim();

  // title attribute is a weak fallback, still better than nothing.
  const title = node.attrs.title;
  if (title && String(title).trim()) return String(title).trim();

  if (node.tag === "img") {
    const alt = node.attrs.alt;
    if (alt === "") return null; // decorative image: correctly unnamed
    if (alt) return String(alt);
  }

  // A form control wrapped in a <label>, or pointed at by one.
  const wrappingLabel = node.closest((n) => n.tag === "label");
  if (wrappingLabel) {
    const t = visibleText(wrappingLabel);
    if (t) return t;
  }
  if (node.attrs.id && root) {
    const forLabel = [...root.descendants()].find(
      (n) => n.tag === "label" && n.attrs.for === node.attrs.id,
    );
    if (forLabel) {
      const t = visibleText(forLabel);
      if (t) return t;
    }
  }

  // A button's own content is its name.
  if (node.tag === "button" || node.tag === "a" || node.tag === "summary") {
    const t = visibleText(node);
    if (t) return t;
  }
  // A placeholder is not an accessible name, so it is deliberately not used.

  return null;
}

/** Depth-first search for an element by DOM id. */
export function findById(root, id) {
  for (const n of root.descendants()) if (n.attrs.id === id) return n;
  return null;
}
