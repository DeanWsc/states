// The state matrix. No dependencies.
//
// The idea this skill is built on: an interface is not one screen, it is a set
// of states. A button that only exists in its default appearance is a
// placeholder, not a control.
//
// So the first thing this module does is decide, for each kind of component,
// which states it must have. The second is to read the stylesheet and ask which
// of those states were actually built. The gap between the two is the finding.

/**
 * The states a component is expected to cover, by component kind.
 *
 * "required" states are missing ones the audit reports as errors. "expected"
 * states are noted as warnings: they are almost always wanted, but a static
 * control legitimately has no hover of its own.
 *
 * Only elements that are themselves controls are audited. A `.field` wrapper is
 * a layout box, not a text field, so classify() returns null for it; that keeps
 * the state matrix about things a person can actually operate.
 */
import { isInteractive } from "./html.mjs";

export const STATE_SETS = {
  button: {
    label: "button",
    required: ["hover", "focus", "active", "disabled"],
    expected: ["loading"],
    note: "A button is always reachable, always operable, and must show focus.",
  },
  link: {
    label: "link",
    required: ["focus", "hover"],
    expected: ["visited"],
    note: "Links need a focus ring or keyboard users cannot see where they are.",
  },
  input: {
    label: "text field",
    required: ["focus", "invalid"],
    expected: ["hover", "disabled", "placeholder"],
    note: "A field must show where the caret is, and say what is wrong with the entry.",
  },
  select: {
    label: "select",
    required: ["focus", "disabled"],
    expected: ["hover", "invalid"],
    note: "Same as a text field, plus the open state belongs to the component.",
  },
  checkbox: {
    label: "checkbox",
    required: ["focus", "checked", "disabled"],
    expected: ["hover"],
    note: "The checked state is the entire point of a checkbox.",
  },
  radio: {
    label: "radio",
    required: ["focus", "checked", "disabled"],
    expected: ["hover"],
    note: "As with the checkbox.",
  },
  switch: {
    label: "switch",
    required: ["focus", "checked", "disabled"],
    expected: ["hover"],
    note: "As with the checkbox.",
  },
  tab: {
    label: "tab",
    required: ["focus", "checked", "disabled"],
    expected: ["hover"],
    note: "Tabs carry aria-selected; it needs a visible counterpart.",
  },
  card: {
    label: "card",
    required: [],
    expected: ["hover"],
    note: "A card is only interactive if it looks like it. A static card needs no hover.",
  },
  list: {
    label: "list",
    required: [],
    expected: ["hover"],
    note: "Interactive list rows need hover; a plain list does not.",
  },
  table: {
    label: "table",
    required: [],
    expected: ["hover", "empty"],
    note: "Data tables need hover on rows and an empty state.",
  },
  modal: {
    label: "dialog",
    required: ["focus"],
    expected: ["loading"],
    note: "A dialog must trap and show focus; a busy dialog needs a loading state.",
  },
  menu: {
    label: "menu",
    required: ["focus"],
    expected: ["hover", "disabled"],
    note: "Menu items need focus and per-item disabled styling.",
  },
  form: {
    label: "form",
    // The invalid state belongs to the fields inside the form, not to the form
    // element, so requiring it here would flag every well-built form.
    required: [],
    expected: ["disabled"],
    note: "A form's errors live on its fields; the form itself usually needs nothing.",
  },
  pagination: {
    label: "pagination",
    required: ["focus", "disabled"],
    expected: ["hover", "current"],
    note: "Disabled edges and the current page both need to read.",
  },
  search: {
    label: "search field",
    required: ["focus"],
    expected: ["hover", "disabled"],
    note: "Search needs focus; the rest follow the input set.",
  },
  toolbar: {
    label: "toolbar",
    required: ["focus"],
    expected: [],
    note: "Toolbar items must be keyboard reachable.",
  },
};

/** Which component kind an element belongs to, judged from its markup. */
export function classify(node) {
  const tag = node.tag;
  const role = (node.attrs.role || "").toLowerCase();
  const type = (node.attrs.type || "").toLowerCase();

  // An explicit role wins over the tag, because it is the author's statement of
  // intent: <button role="switch"> is a switch, not a button.
  if (role === "switch") return "switch";
  if (role === "checkbox") return "checkbox";
  // role wins over the tag here too: <button role="tab"> is a tab, so its
  // focus / checked / disabled set applies rather than the button's.
  if (role === "tab") return "tab";
  if (role === "radio") return "radio";

  if (tag === "button") return "button";
  if (tag === "a" && node.attrs.href) return "link";
  if (tag === "summary") return "button";
  if (tag === "select") return "select";
  if (tag === "textarea") return "input";
  if (tag === "input") {
    if (type === "checkbox") return "checkbox";
    if (type === "radio") return "radio";
    if (type === "search") return "search";
    if (type === "submit" || type === "button" || type === "reset") return "button";
    return "input";
  }
  if (tag === "dialog") return "modal";
  if (tag === "form") return "form";
  if (tag === "ul" || tag === "ol") return "list";
  if (tag === "table") return "table";

  switch (role) {
    case "button": return "button";
    case "link": return "link";
    case "checkbox": return "checkbox";
    case "radio": return "radio";
    case "switch": return "switch";
    case "tab": return "tab";
    case "tablist": return "tab";
    case "menu": case "menubar": case "menuitem": return "menu";
    case "dialog": case "alertdialog": return "modal";
    case "searchbox": return "search";
    case "textbox": return "input";
    case "combobox": return "select";
    case "slider": case "spinbutton": return "input";
    case "listbox": case "option": return "select";
    case "grid": return "table";
    case "toolbar": return "toolbar";
    case "pagination": return "pagination";
    case "list": case "listitem": return "list";
    default: break;
  }

  // Class and id names are the weakest signal but often the only one present.
  // They go through the same word-splitting as selectors, so `.field__control`
  // and `.btn--primary` are read as "field control" and "btn primary".
  //
  // This only applies to elements that are controls in their own right. A
  // `.field` wrapper is a layout box, and auditing it for states would produce
  // one finding per wrapper on top of the one for the real control inside it.
  if (!isInteractive(node)) return null;
  const words = [];
  for (const token of `${node.attrs.class || ""} ${node.attrs.id || ""}`.split(/\s+/)) {
    for (const part of token.split(/__|--/)) {
      for (const w of part.split("-")) if (w) words.push(w.toLowerCase());
    }
  }
  const text = words.join(" ");
  if (/\bcard\b|\bchip\b|\btile\b|\bplan\b/.test(text)) return "card";
  if (/\bswitch\b/.test(text)) return "switch";
  if (/\bcheckbox\b/.test(text)) return "checkbox";
  if (/\bradio\b/.test(text)) return "radio";
  // An option inside a segmented control is a tab, whatever tag carries it.
  if (/\bsegmented\b|\bsegment\b/.test(text)) return "tab";
  if (/\btab\b/.test(text)) return "tab";
  if (/\bbtn\b|\bbutton\b/.test(text)) return "button";
  if (/\bcontrol\b|\binput\b|\bfield\b/.test(text)) return "input";
  if (/\bmodal\b|\bdialog\b/.test(text)) return "modal";
  if (/\brow\b|\bitem\b/.test(text)) return "list";
  if (/\btable\b/.test(text)) return "table";
  return null;
}

/**
 * Build the matrix: for each rule in the stylesheet, which component kinds and
 * which states does it cover?
 *
 * Returns a Map keyed by `${kind}:${state}` listing the selectors that provide
 * it. This is read straight from the parsed CSS, so a state that is present but
 * unreachable (a selector that matches nothing) does not count as covered: the
 * audit cross-checks each entry against the real markup.
 *
 * `kindsInUse` solves a real fragility. A stylesheet that names its controls
 * `.b` or `.c` says nothing about what they are, so a selector-only matrix would
 * report every state as missing on a perfectly good page. When the kinds present
 * in the markup are supplied, a rule is also attributed to the kind of the
 * elements its selector actually matches. The class-name reading stays as the
 * fallback for rules that match nothing at rest.
 */
export function matrixFromRules(rules, { elements = null } = {}) {
  const matrix = new Map();
  const add = (kind, state, rule) => {
    if (!kind || !state) return;
    const k = `${kind}:${state}`;
    if (!matrix.has(k)) matrix.set(k, []);
    matrix.get(k).push(rule);
  };

  for (const rule of rules) {
    const fromName = kindFromSelector(rule.selector);
    const fromMarkup = elements ? kindsMatchedBy(rule.selector, elements) : new Set();

    for (const [state] of Object.entries(rule.states)) {
      add(fromName, state, rule);
      for (const kind of fromMarkup) add(kind, state, rule);
    }
  }
  return matrix;
}

/**
 * Which component kinds in the markup does this selector match?
 * This is what lets `.c:hover` count as hover coverage for a switch, even
 * though "c" spells out nothing.
 */
function kindsMatchedBy(selector, elements) {
  const out = new Set();
  // Strip state pseudos so the selector can be matched in its resting form.
  const bare = selector
    .replace(/:hover|:focus-visible|:focus|:active|:disabled|:checked|:invalid|:valid/g, "")
    .replace(/\[aria-[a-z-]+=["']?[^\]"']*["']?\]/g, "")
    .trim();
  if (!bare) return out;
  for (const el of elements) {
    if (!selectorTargetsElement(bare, el)) continue;
    const kind = classify(el);
    if (kind) out.add(kind);
  }
  return out;
}

/** Thin wrapper so this module does not import the matcher eagerly. */
let matcher = null;
function selectorTargetsElement(selector, node) {
  if (!matcher) {
    // Imported once, on first use, to keep the import graph acyclic.
    matcher = cssMatcher;
  }
  try {
    return matcher(selector, node);
  } catch {
    return false;
  }
}

import { matches as cssMatcher } from "./css.mjs";

/**
 * The component kind a selector names, from its class or id.
 *
 * Matching is on word boundaries so `.field__control` is recognised as an input
 * and `.fieldset-row` is not mistaken for a field. The BEM-ish `__` and `--`
 * suffixes are split first, which is what makes this work on real class names.
 */
function kindFromSelector(selector) {
  const s = String(selector);
  const words = [];
  for (const m of s.matchAll(/[.#]([\w-]+)/g)) {
    // Split foo__bar and foo--bar into their parts, then take each part's words.
    for (const part of m[1].split(/__|--/)) {
      for (const w of part.split("-")) if (w) words.push(w.toLowerCase());
    }
  }
  const text = words.join(" ");

  // Order matters: the more specific kinds are tested first, because a class
  // like "switch-field" contains both words.
  const table = [
    [/\bcheckbox\b/, "checkbox"],
    [/\bradio\b/, "radio"],
    [/\bswitch\b/, "switch"],
    // A segmented control is a tablist with a different shape, and its options
    // are tabs. Naming it here is what makes the focus / checked / disabled set
    // apply to a component whose class says none of those words.
    [/\bsegmented\b|\bsegment\b|\btablist\b/, "tab"],
    [/\bselect\b/, "select"],
    [/\bsearch\b/, "search"],
    [/\binput\b|\bcontrol\b|\bfield\b/, "input"],
    [/\bbtn\b|\bbutton\b/, "button"],
    [/\btab\b/, "tab"],
    [/\blink\b|\banchor\b/, "link"],
    [/\bcard\b|\bchip\b|\btile\b|\bplan\b/, "card"],
    [/\brow\b|\blist\b|\bitem\b/, "list"],
    [/\btable\b/, "table"],
    [/\bmodal\b|\bdialog\b|\bdrawer\b/, "modal"],
    [/\bmenu\b|\bnav\b/, "menu"],
    [/\bform\b/, "form"],
    [/\btoolbar\b/, "toolbar"],
    [/\bpagination\b|\bpager\b/, "pagination"],
  ];
  for (const [re, kind] of table) if (re.test(text)) return kind;
  return null;
}

/**
 * Which states are covered for a given component kind, judged from the matrix.
 * Returns a Set of state names. A rule whose kind could not be identified is
 * ignored rather than contributing an undefined state, which is what previously
 * produced a "missing: null" finding.
 */
export function statesFor(matrix, kind) {
  const found = new Set();
  if (!kind) return found;
  for (const [k, rules] of matrix) {
    const sep = k.indexOf(":");
    const kKind = sep === -1 ? k : k.slice(0, sep);
    const state = sep === -1 ? null : k.slice(sep + 1);
    if (kKind !== kind || !state) continue;
    if (rules.length) found.add(state);
  }
  return found;
}

/**
 * The missing states for a kind, split into required (an error) and expected
 * (a note). A kind that is not in the table is left alone.
 */
export function missingStates(matrix, kind) {
  const spec = STATE_SETS[kind];
  if (!spec) return { required: [], expected: [] };
  const have = statesFor(matrix, kind);
  const required = spec.required.filter((s) => !have.has(s));
  const expected = spec.expected.filter((s) => !have.has(s));
  return { required, expected };
}

/**
 * States that the markup implies but the stylesheet never covers.
 *
 * This is the more useful direction than checking the stylesheet alone: it walks
 * the real elements and asks what each one is missing. A page with three
 * buttons and no :focus rule produces three findings, not one.
 */
export function auditStates(elements, matrix) {
  const findings = [];
  for (const node of elements) {
    const kind = classify(node);
    if (!kind) continue;
    const spec = STATE_SETS[kind];
    if (!spec) continue;

    // A control that is currently disabled still needs a disabled style, and
    // one that is not disabled still needs to define what disabled looks like.
    const have = statesFor(matrix, kind);

    // A native checkbox, radio or select draws its own checked state, so
    // demanding a :checked rule would flag every unstyled-native control. Only
    // a custom control, whose appearance the author has taken over, has to
    // define it.
    const type = (node.attrs.type || "").toLowerCase();
    const style = node.computed;
    const isNativeToggle = ["checkbox", "radio"].includes(type) && style && style.appearance !== "none";
    const required = isNativeToggle
      ? spec.required.filter((s) => s !== "checked")
      : spec.required;

    const missing = required.filter((s) => !have.has(s));
    if (!missing.length) continue;
    findings.push({
      kind,
      node,
      path: node.path(),
      line: node.line,
      missing,
      expected: spec.expected.filter((s) => !have.has(s)),
      note: spec.note,
    });
  }
  return findings;
}

/**
 * A printable matrix, for the report and for reading at a glance which states
 * exist. Rows are kinds, columns are the union of every state anyone needs.
 */
export function renderMatrix(matrix, kinds = Object.keys(STATE_SETS)) {
  const allStates = [];
  for (const kind of kinds) {
    const spec = STATE_SETS[kind];
    if (!spec) continue;
    for (const s of [...spec.required, ...spec.expected]) {
      if (!allStates.includes(s)) allStates.push(s);
    }
  }

  const header = ["kind", ...allStates];
  const rows = [header];
  for (const kind of kinds) {
    const have = statesFor(matrix, kind);
    const spec = STATE_SETS[kind];
    rows.push([
      spec?.label ?? kind,
      ...allStates.map((s) => {
        if (!have.has(s)) return "·";
        return spec?.required.includes(s) ? "R" : "r";
      }),
    ]);
  }

  const widths = header.map((_, i) => Math.max(...rows.map((r) => String(r[i] ?? "").length)));
  const line = (cells) => cells.map((c, i) => String(c ?? "").padEnd(widths[i])).join("  ");
  return [
    line(rows[0]),
    widths.map((w) => "─".repeat(w)).join("  "),
    ...rows.slice(1).map(line),
    "",
    "R = required state present, r = optional present, · = missing",
  ].join("\n");
}

/**
 * States a control has that no component kind claims. Used by the audit to
 * report styling that nothing in the markup can ever reach, which is how dead
 * CSS gets noticed.
 */
export function unreachableStates(rules, elements) {
  const live = new Set();
  for (const node of elements) {
    const kind = classify(node);
    if (!kind) continue;
    for (const [state] of Object.entries({ ...node.states })) live.add(`${kind}:${state}`);
  }
  const out = [];
  for (const rule of rules) {
    const kind = kindFromSelector(rule.selector);
    for (const state of Object.keys(rule.states)) {
      const key = `${kind}:${state}`;
      if (!live.has(key)) out.push({ kind, state, selector: rule.selector });
    }
  }
  return out;
}
