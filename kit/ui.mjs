// Component primitives that emit every state by construction. No dependencies.
//
// The argument for a generator rather than a copy-paste snippet: a component
// written by hand is missing a state exactly once, and nobody notices until
// someone with a keyboard tries to use it. Here you cannot emit a button without
// its hover, focus, active and disabled rules, because they come out of the same
// function.
//
// Every builder returns markup. The matching CSS comes from componentCss(), and
// the two are meant to be used together: a button with no styles is not a button
// under this skill.

import { palette, tokensCss, resetCss, reducedMotionCss, SPACE, TYPE, RADIUS, TAP } from "./tokens.mjs";

/** Escape text for HTML. A label with an ampersand in it must not break the page. */
export function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Render an attribute map, skipping null and false. */
function attrs(map) {
  return Object.entries(map || {})
    .filter(([, v]) => v !== null && v !== undefined && v !== false)
    .map(([k, v]) => (v === true ? ` ${k}` : ` ${k}="${esc(v)}"`))
    .join("");
}

/** A unique id per call, so labels and descriptions can be wired together. */
let seq = 0;
export const nextId = (prefix = "f") => `${prefix}-${++seq}`;

/** Reset the id counter. Only useful in tests. */
export function resetIds() {
  seq = 0;
}

/**
 * A button.
 *
 * Emits the states that matter and nothing else: hover, focus-visible, active and
 * disabled. `loading` is opt-in, because a plain link-shaped button has no
 * submitting to report.
 */
export function button({
  label,
  variant = "primary",
  type = "button",
  disabled = false,
  loading = false,
  busy = false,
  icon = null,
  id = null,
  describedBy = null,
} = {}) {
  const classes = ["btn", variant !== "primary" ? `btn--${variant}` : ""]
    .filter(Boolean)
    .join(" ");

  const inner = [
    loading ? '<span class="btn__spinner" aria-hidden="true"></span>' : "",
    icon ? `<span class="btn__icon" aria-hidden="true">${icon}</span>` : "",
    `<span class="btn__label">${esc(label)}</span>`,
  ].join("");

  return `<button${attrs({
    type: loading ? "button" : type,
    class: classes,
    id,
    disabled: disabled || loading,
    "aria-busy": busy ? "true" : null,
    "aria-describedby": describedBy,
  })}>${inner}</button>`;
}

/**
 * A text field with its label and its message.
 *
 * The label is always a real <label for>, never a placeholder, and the message is
 * wired with aria-describedby so a screen reader reads the error with the field
 * rather than leaving the user to find it.
 */
export function field({
  label,
  name,
  value = "",
  type = "text",
  placeholder = null,
  hint = null,
  invalid = false,
  message = null,
  disabled = false,
  required = false,
  id = null,
} = {}) {
  const controlId = id || nextId("field");
  const hintId = hint ? `${controlId}-hint` : null;
  const messageId = message ? `${controlId}-msg` : null;
  const describedBy = [invalid && messageId, hintId].filter(Boolean).join(" ") || null;

  return [
    `<div${attrs({ class: `field${invalid ? " field--invalid" : ""}` })}>`,
    `<label${attrs({ class: "field__label", for: controlId })}>${esc(label)}</label>`,
    `<input${attrs({
      class: "field__control",
      id: controlId,
      name,
      type,
      value: value || null,
      placeholder,
      disabled,
      required,
      "aria-invalid": invalid ? "true" : null,
      "aria-describedby": describedBy,
    })}>`,
    // The invalid state is never colour alone: the message carries it in text.
    message ? `<p${attrs({ class: "field__message", id: messageId })}>${esc(message)}</p>` : "",
    hint ? `<p${attrs({ class: "field__hint", id: hintId })}>${esc(hint)}</p>` : "",
    `</div>`,
  ].filter(Boolean).join("\n");
}

/**
 * A switch.
 *
 * The knob is a pseudo-element that moves, so the state is carried by position
 * as well as colour. Without that, the check called colour-only fires, correctly.
 */
export function toggle({
  label,
  checked = false,
  disabled = false,
  describedBy = null,
} = {}) {
  const inner = `<span class="switch__label">${esc(label)}</span>`;
  return [
    `<button${attrs({
      type: "button",
      class: "switch",
      role: "switch",
      "aria-checked": checked ? "true" : "false",
      "aria-label": label,
      "aria-describedby": describedBy,
      disabled,
    })}>${inner}</button>`,
  ].join("");
}

/** A checkbox with a real label and a visible box. */
export function checkbox({ label, checked = false, disabled = false, describedBy = null } = {}) {
  const id = nextId("check");
  return [
    `<div${attrs({ class: "checkbox" })}>`,
    `<input${attrs({
      type: "checkbox",
      class: "checkbox__input",
      id,
      checked,
      disabled,
      "aria-describedby": describedBy,
    })}>`,
    `<label${attrs({ class: "checkbox__label", for: id })}>${esc(label)}</label>`,
    `</div>`,
  ].join("");
}

/** A panel: a surface with a title and an optional note. */
export function panel({ title, note = null, children = "", className = "" } = {}) {
  return [
    `<section${attrs({ class: `panel ${className}`.trim() })}>`,
    title ? `<h2 class="panel__title">${esc(title)}</h2>` : "",
    note ? `<p class="panel__note">${esc(note)}</p>` : "",
    children,
    `</section>`,
  ].filter(Boolean).join("\n");
}

/**
 * The empty state.
 *
 * An empty list with nothing in it is a state, and it is the one most often
 * skipped. It always says what is missing and offers the way out.
 */
export function empty({ title, body = null, action = null } = {}) {
  return [
    `<div${attrs({ class: "empty" })}>`,
    `<p class="empty__title">${esc(title)}</p>`,
    body ? `<p class="empty__body">${esc(body)}</p>` : "",
    action || "",
    `</div>`,
  ].filter(Boolean).join("\n");
}

/** A row in a settings list: a label, a note and a control on the right. */
export function row({ label, note = null, control = "", html = "" } = {}) {
  return [
    `<div${attrs({ class: "row" })}>`,
    `<span class="row__text">`,
    `<span class="row__label">${esc(label)}</span>`,
    note ? `<span class="row__note">${esc(note)}</span>` : "",
    `</span>`,
    html || control,
    `</div>`,
  ].join("");
}

/** Text that only a screen reader sees. */
export function srOnly(text) {
  return `<span class="visually-hidden">${esc(text)}</span>`;
}

/**
 * A table with a caption and a sortable header.
 *
 * Tables are where the state argument is easiest to see and most often skipped.
 * A table is never just rows: it is rows that can be hovered, focused,
 * selected, sorted three ways, replaced by a skeleton while loading, empty
 * because there is no data, and empty again because a filter excluded it all.
 * Those last two look identical in code and mean completely different things to
 * the person looking at them, which is why `empty` takes a `filtered` flag.
 *
 * `aria-sort` is set on the header rather than implied by an arrow, so the sort
 * direction is announced rather than merely drawn.
 */
export function table({
  caption,
  columns,
  rows = [],
  empty: emptyState = null,
  skeleton = null,
  selected = null,
  onRowLabel = null,
} = {}) {
  // A table with no rows has no columns to sort, and leaving the header up
  // invites someone to sort data that is not there. The header is only emitted
  // when there is at least one row.
  const head = !rows.length
    ? ""
    : columns.map((col) => {
      const isSortable = Boolean(col.sortable);
      const sorted = col.sort === "ascending" || col.sort === "descending";
      const align = col.align === "right" ? ' style="text-align:right"' : "";
      if (!isSortable) {
        return `<th scope="col"${align}>${esc(col.label)}</th>`;
      }
      return [
        `<th scope="col" aria-sort="${sorted ? col.sort : "none"}"${align}>`,
        `<button type="button" class="th-sort${sorted ? " th-sort--active" : ""}"${sorted ? ` data-direction="${col.sort}"` : ""}>`,
        `<span class="th-sort__label">${esc(col.label)}</span>`,
        // The arrow is decorative; aria-sort already carries the meaning.
        `<span class="th-sort__arrow" aria-hidden="true">${sorted ? (col.sort === "ascending" ? "↑" : "↓") : "↕"}</span>`,
        srOnly(sorted ? `, sorted ${col.sort === "ascending" ? "ascending" : "descending"}` : ", not sorted"),
        `</button>`,
        `</th>`,
      ].join("");
    }).join("");

  const body = rows.length
    ? rows.map((row, i) => {
        const isSelected = selected ? selected.includes(row.id ?? String(i)) : false;
        const cells = columns.map((col, ci) => {
          const raw = row[col.key];
          // A null cell is "not included", which is different from an empty
          // string and very different from missing data. Rendering it as an
          // empty <td> makes it indistinguishable from a cell that failed to
          // load, and in a comparison table that ambiguity is the whole point.
          let value;
          if (col.render) {
            value = col.render(row);
          } else if (raw === null || raw === undefined) {
            value = `<span class="cell-no" aria-label="Not included"><span aria-hidden="true">—</span></span>`;
          } else {
            value = esc(raw);
          }
          const align = col.align === "right" ? ' style="text-align:right"' : "";
          // The row's identity cell is a real <th scope="row">, not a <td> with
          // a scope attribute: that is how a screen reader announces "Northwind,
          // row 2 of 4" instead of reading a flat grid. It also changes the
          // colour and the weight, which is why the browser's default styling
          // is overridden in the CSS rather than left to vary.
          const cellTag = ci === 0 ? "th" : "td";
          // data-label is what keeps a value attached to its heading once the
          // table collapses into cards. Without it the card reads as a list of
          // bare numbers.
          return `<${cellTag}${ci === 0 ? ' scope="row"' : ""}${align} data-label="${esc(col.label)}">${value}</${cellTag}>`;
        }).join("");
        return [
          `<tr${isSelected ? ' aria-selected="true" class="row--selected"' : ""}>`,
          cells,
          `</tr>`,
        ].join("");
      }).join("")
    : "";

  return [
    `<div class="table-wrap">`,
    `<table class="table">`,
    caption ? `<caption class="table__caption">${esc(caption)}</caption>` : "",
    // The header is only emitted with rows. A header over an empty table
    // invites someone to sort columns that are not there.
    head ? `<thead><tr>${head}</tr></thead>` : "",
    // The tbody carries whichever state applies, and says so for a screen
    // reader as well as for the eye.
    //
    // The skeleton sits outside the table on purpose. Inside a <td> it would
    // inherit the cell's layout rules, and in the narrow card layout the row
    // rules below turn every cell into a flex pair, which turns a skeleton row
    // into a stack of single bars.
    body
      ? `<tbody>${body}</tbody>`
      : `<tbody></tbody>`,
    `</table>`,
    `</div>`,
    // Loading sits after the empty table, sized like the content it replaces,
    // so the layout does not jump when the rows arrive.
    rows.length === 0 && skeleton
      ? `<div class="table-skeleton" aria-busy="true">${skeleton}</div>`
      : "",
    // The empty state also sits outside the table, because it is not tabular
    // data. "Empty because there is none" and "empty because a filter excluded
    // it all" mean different things and are written differently.
    rows.length === 0 && !skeleton && emptyState ? empty(emptyState) : "",
  ].filter(Boolean).join("\n");
}

/**
 * Skeleton rows, the size of the content they replace.
 *
 * A skeleton whose shape does not match the content is worse than a spinner,
 * because the layout jumps when the data lands. Reserve the space.
 */
export function skeletonRows(columns = 4, rows = 3) {
  return `<div class="skeleton" role="status"><span class="visually-hidden">Loading</span>${Array.from({ length: rows }, () => `<div class="skeleton__row">${Array.from({ length: columns }, () => `<span class="skeleton__bar"></span>`).join("")}</div>`).join("")}</div>`;
}

/**
 * A row of pagination.
 *
 * The edges are disabled rather than hidden, so the control does not change
 * shape as the user pages through, and the current page is marked in text as
 * well as by weight.
 */
export function pagination({ page: current = 1, total = 1, label = "Pagination" } = {}) {
  const atStart = current <= 1;
  const atEnd = current >= total;
  return [
    `<nav class="pagination" aria-label="${esc(label)}">`,
    `<button type="button" class="pagination__step"${atStart ? " disabled" : ""} aria-label="Previous page">`,
    `<span aria-hidden="true">←</span>`,
    `</button>`,
    `<span class="pagination__status">Page <strong>${current}</strong> of ${total}</span>`,
    `<button type="button" class="pagination__step"${atEnd ? " disabled" : ""} aria-label="Next page">`,
    `<span aria-hidden="true">→</span>`,
    `</button>`,
    `</nav>`,
  ].join("");
}

/** A status pill. The label carries the meaning; the colour only reinforces it. */
export function status({ label, tone = "neutral" } = {}) {
  return `<span class="status status--${esc(tone)}"><span class="status__dot" aria-hidden="true"></span>${esc(label)}</span>`;
}

/** A toolbar: a search field and the controls that act on the current view. */
export function toolbar({ search = null, children = "" } = {}) {
  return [
    `<div class="toolbar" role="toolbar" aria-label="Table controls">`,
    search ? search : "",
    children,
    `</div>`,
  ].filter(Boolean).join("");
}

/**
 * The stylesheet for the components above.
 *
 * Written as one function so the markup builders and the CSS cannot drift apart
 * in version, only in use. Every component block here carries all of its states;
 * that is the whole contract of this file.
 */
export function componentCss(p = palette(), { indent = "  " } = {}) {
  return `${resetCss({ indent })}
${tokensCss(p, { indent })}

${indent}body {
${indent}  background: var(--surface);
${indent}  color: var(--body);
${indent}  font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
${indent}  font-size: ${TYPE.base.size};
${indent}  line-height: ${TYPE.base.line};
${indent}}

${indent}.wrap {
${indent}  max-width: 640px;
${indent}  margin-inline: auto;
${indent}  padding: ${SPACE[10]} ${SPACE[6]} ${SPACE[16]};
${indent}}

${indent}h1 {
${indent}  font-size: ${TYPE["2xl"].size};
${indent}  line-height: ${TYPE["2xl"].line};
${indent}  font-weight: ${TYPE["2xl"].weight};
${indent}  margin: 0 0 ${SPACE[2]};
${indent}}

${indent}.lede {
${indent}  margin: 0 0 ${SPACE[8]};
${indent}  color: var(--muted);
${indent}  font-size: ${TYPE.base.size};
${indent}}

/* ---- Panel ---- */

${indent}.panel {
${indent}  /* No width: the panel takes its container, which is what keeps it
${indent}     inside a phone. A declared width overflows. */
${indent}  background: var(--surface);
${indent}  color: var(--body);
${indent}  border: 1px solid var(--edge);
${indent}  border-radius: ${RADIUS.lg};
${indent}  padding: ${SPACE[6]};
${indent}}

${indent}.panel + .panel { margin-top: ${SPACE[4]}; }

${indent}.panel__title {
${indent}  margin: 0 0 ${SPACE[1]};
${indent}  font-size: ${TYPE.md.size};
${indent}  font-weight: 600;
${indent}}

${indent}.panel__note {
${indent}  margin: 0 0 ${SPACE[5]};
${indent}  color: var(--muted);
${indent}  font-size: ${TYPE.sm.size};
${indent}}

/* ---- Button: hover, focus, active, disabled, loading ---- */

${indent}.btn {
${indent}  display: inline-flex;
${indent}  align-items: center;
${indent}  justify-content: center;
${indent}  gap: ${SPACE[2]};
${indent}  min-height: ${TAP};
${indent}  padding: 10px 20px;
${indent}  font: inherit;
${indent}  font-size: ${TYPE.base.size};
${indent}  font-weight: 600;
${indent}  color: var(--brand-ink);
${indent}  background: var(--brand);
${indent}  border: 1px solid transparent;
${indent}  border-radius: ${RADIUS.md};
${indent}  cursor: pointer;
${indent}  transition: background-color 120ms cubic-bezier(0.2, 0, 0, 1),
${indent}              transform 80ms cubic-bezier(0.2, 0, 0, 1);
${indent}}

${indent}.btn:hover { background: var(--brand-hover); }
${indent}.btn:active { transform: translateY(1px); }

${indent}.btn:focus-visible {
${indent}  outline: 2px solid var(--focus);
${indent}  outline-offset: 2px;
${indent}}

${indent}.btn--quiet {
${indent}  color: var(--body);
${indent}  background: transparent;
${indent}  border-color: var(--edge-strong);
${indent}}

${indent}.btn--quiet:hover { background: var(--surface); }

/* A destructive action is a distinct button, not a warning label on a normal
   one, and it carries its own hover, focus and disabled so that revoking a
   person's access never looks like saving a setting. */
${indent}.btn--danger {
${indent}  color: var(--brand-ink);
${indent}  background: var(--danger-fill);
${indent}  border-color: transparent;
${indent}}
${indent}.btn--danger:hover { background: var(--danger-hover); }
${indent}.btn--danger:active { transform: translateY(1px); }
${indent}.btn--danger:focus-visible {
${indent}  outline: 2px solid var(--focus);
${indent}  outline-offset: 2px;
${indent}}
${indent}.btn--danger:disabled {
${indent}  background: var(--disabled-surface);
${indent}  color: var(--disabled);
${indent}  border-color: var(--edge);
${indent}  cursor: not-allowed;
${indent}  transform: none;
${indent}}

${indent}.btn:disabled {
${indent}  /* A disabled control reads as unavailable by being pale, not heavy.
${indent}     A dark fill with white text passes contrast comfortably and still
${indent}     looks like a button you are meant to press. */
${indent}  background: var(--disabled-surface);
${indent}  color: var(--disabled);
${indent}  border-color: var(--edge);
${indent}  cursor: not-allowed;
${indent}  transform: none;
${indent}}

${indent}.btn--quiet:disabled { background: transparent; }

${indent}.btn__spinner {
${indent}  width: 14px;
${indent}  height: 14px;
${indent}  border: 2px solid currentColor;
${indent}  border-top-color: transparent;
${indent}  border-radius: 50%;
${indent}  animation: states-spin 700ms linear infinite;
${indent}}

${indent}.btn[aria-busy="true"] { cursor: progress; }

@keyframes states-spin { to { transform: rotate(360deg); } }

/* ---- Field ---- */

${indent}.field { margin-bottom: ${SPACE[5]}; }
${indent}.field:last-child { margin-bottom: 0; }

${indent}.field__label {
${indent}  display: block;
${indent}  margin-bottom: ${SPACE[2]};
${indent}  font-size: ${TYPE.sm.size};
${indent}  font-weight: 500;
${indent}}

${indent}.field__control {
${indent}  display: block;
${indent}  width: 100%;
${indent}  min-width: 0;
${indent}  min-height: ${TAP};
${indent}  padding: 10px 14px;
${indent}  font: inherit;
${indent}  font-size: ${TYPE.base.size};
${indent}  color: var(--body);
${indent}  background: var(--surface);
${indent}  border: 1px solid var(--edge-strong);
${indent}  border-radius: ${RADIUS.md};
${indent}  transition: border-color 120ms cubic-bezier(0.2, 0, 0, 1);
${indent}}

${indent}.field__control::placeholder { color: var(--muted); opacity: 1; }
${indent}.field__control:hover { border-color: var(--muted); }

${indent}.field__control:focus-visible {
${indent}  outline: 2px solid var(--focus);
${indent}  outline-offset: 2px;
${indent}  border-color: var(--focus);
${indent}}

${indent}.field__control:disabled {
${indent}  background: var(--disabled-surface, var(--surface));
${indent}  color: var(--disabled);
${indent}  cursor: not-allowed;
${indent}}

${indent}.field__control[aria-invalid="true"] {
${indent}  border-color: var(--danger);
${indent}  background: var(--danger-soft);
${indent}}

${indent}.field__control[aria-invalid="true"]:focus-visible {
${indent}  outline-color: var(--danger);
${indent}}

${indent}.field__message {
${indent}  margin: ${SPACE[2]} 0 0;
${indent}  font-size: ${TYPE.sm.size};
${indent}  color: var(--danger-ink);
${indent}}

${indent}.field__message::before { content: "\\26A0 "; }

${indent}.field__hint {
${indent}  margin: ${SPACE[2]} 0 0;
${indent}  font-size: ${TYPE.sm.size};
${indent}  color: var(--muted);
${indent}}

/* ---- Switch: the knob moves, so the state is not colour alone ---- */

${indent}.switch {
${indent}  position: relative;
${indent}  flex: none;
${indent}  width: 46px;
${indent}  height: 26px;
${indent}  padding: 0;
${indent}  border: 1px solid var(--edge-strong);
${indent}  border-radius: ${RADIUS.full};
${indent}  background: var(--surface);
${indent}  cursor: pointer;
${indent}  appearance: none;
${indent}  transition: background-color 140ms cubic-bezier(0.2, 0, 0, 1);
${indent}}

${indent}.switch::after {
${indent}  content: "";
${indent}  position: absolute;
${indent}  top: 2px;
${indent}  left: 2px;
${indent}  width: 20px;
${indent}  height: 20px;
${indent}  border-radius: 50%;
${indent}  background: var(--muted);
${indent}  transition: transform 140ms cubic-bezier(0.2, 0, 0, 1);
${indent}}

${indent}.switch[aria-checked="true"] {
${indent}  background: var(--brand);
${indent}  border-color: var(--brand);
${indent}}

${indent}.switch[aria-checked="true"]::after {
${indent}  transform: translateX(20px);
${indent}  background: var(--brand-ink);
${indent}}

${indent}.switch:hover { border-color: var(--muted); }

${indent}.switch:focus-visible {
${indent}  outline: 2px solid var(--focus);
${indent}  outline-offset: 2px;
${indent}}

${indent}.switch:disabled { opacity: 0.45; cursor: not-allowed; }
${indent}.switch__label { display: none; }

/* ---- Checkbox: the box itself is the signal ---- */

${indent}.checkbox {
${indent}  display: flex;
${indent}  align-items: center;
${indent}  gap: ${SPACE[2]};
${indent}  min-height: ${TAP};
${indent}}

${indent}.checkbox__input {
${indent}  flex: none;
${indent}  width: 20px;
${indent}  height: 20px;
${indent}  accent-color: var(--brand);
${indent}}

${indent}.checkbox__input:focus-visible {
${indent}  outline: 2px solid var(--focus);
${indent}  outline-offset: 2px;
${indent}}

${indent}.checkbox__input:disabled { opacity: 0.45; cursor: not-allowed; }

${indent}.checkbox__label {
${indent}  font-size: ${TYPE.base.size};
${indent}  cursor: pointer;
${indent}}

${indent}.checkbox__input:disabled + .checkbox__label { color: var(--disabled); cursor: not-allowed; }

/* ---- Row: min-width:0 is what keeps the control on screen ---- */

${indent}.row {
${indent}  display: flex;
${indent}  align-items: center;
${indent}  gap: ${SPACE[4]};
${indent}  min-height: ${TAP};
${indent}  padding: 10px 0;
${indent}}

${indent}.row + .row { border-top: 1px solid var(--edge); }

${indent}.row__text {
${indent}  flex: 1;
${indent}  min-width: 0;
${indent}}

${indent}.row__label {
${indent}  display: block;
${indent}  font-size: ${TYPE.base.size};
${indent}  font-weight: 500;
${indent}}

${indent}.row__note {
${indent}  display: block;
${indent}  margin-top: 2px;
${indent}  font-size: ${TYPE.sm.size};
${indent}  color: var(--muted);
${indent}}

${indent}.actions {
${indent}  display: flex;
${indent}  gap: ${SPACE[3]};
${indent}  flex-wrap: wrap;
${indent}  margin-top: ${SPACE[6]};
${indent}  padding-top: ${SPACE[5]};
${indent}  border-top: 1px solid var(--edge);
${indent}}

/* ---- Empty state: a state, not an afterthought ---- */

${indent}.empty {
${indent}  padding: ${SPACE[8]} ${SPACE[6]};
${indent}  text-align: center;
${indent}  border: 1px dashed var(--edge-strong);
${indent}  border-radius: ${RADIUS.lg};
${indent}}

${indent}.empty__title {
${indent}  margin: 0 0 ${SPACE[2]};
${indent}  font-size: ${TYPE.base.size};
${indent}  font-weight: 600;
${indent}}

${indent}.empty__body {
${indent}  margin: 0 0 ${SPACE[4]};
${indent}  font-size: ${TYPE.sm.size};
${indent}  color: var(--muted);
${indent}}

${indent}.visually-hidden {
${indent}  position: absolute;
${indent}  width: 1px;
${indent}  height: 1px;
${indent}  padding: 0;
${indent}  margin: -1px;
${indent}  overflow: hidden;
${indent}  clip-path: inset(50%);
${indent}  white-space: nowrap;
${indent}  border: 0;
${indent}}

/* ---- Table ----
   A table is the component that breaks hardest on a phone, and the fix is not
   a smaller font: it is deciding what a row means when the columns cannot sit
   side by side. Below 640px each row becomes a card with its own labels, so no
   value is ever orphaned from its heading. */

${indent}.table-wrap {
${indent}  /* overflow-x:auto on a wide table is the honest fallback for the
${indent}     mid sizes, but it is a last resort: the card layout below means
${indent}     it is rarely reached. */
${indent}  overflow-x: auto;
${indent}  margin: 0 calc(-1 * ${SPACE[6]});
${indent}  padding: 0 ${SPACE[6]};
${indent}}

${indent}.table {
${indent}  width: 100%;
${indent}  border-collapse: collapse;
${indent}  font-size: ${TYPE.base.size};
${indent}}

${indent}.table__caption {
${indent}  text-align: left;
${indent}  padding-bottom: ${SPACE[3]};
${indent}  color: var(--muted);
${indent}  font-size: ${TYPE.sm.size};
${indent}}

${indent}.table th,
${indent}.table td {
${indent}  padding: ${SPACE[3]} ${SPACE[4]};
${indent}  text-align: left;
${indent}  border-bottom: 1px solid var(--edge);
${indent}}

${indent}.table th {
${indent}  font-size: ${TYPE.sm.size};
${indent}  font-weight: 600;
${indent}  color: var(--muted);
${indent}  white-space: nowrap;
${indent}}

${indent}.table th[scope="row"] {
${indent}  font-weight: 500;
${indent}  color: var(--body);
${indent}}

${indent}/* An identifier, a date and a money value are single tokens. Letting them
${indent}   wrap mid-token ("INV-" over "2041") is what makes a table look
${indent}   broken at a glance even when every column is legible. */
${indent}.table th[scope="row"],
${indent}.table td[data-label="Invoice"],
${indent}.table td[data-label="Due"] { white-space: nowrap; }

${indent}.num { font-variant-numeric: tabular-nums; }

/* A cell that says "not included". The dash is decorative and the label carries
   the meaning, and it is muted rather than invisible: a cell that is only just
   visible reads as an accident. */
${indent}.cell-no {
${indent}  color: var(--muted);
${indent}  font-weight: 600;
${indent}}

${indent}.table tbody tr { transition: background-color 100ms cubic-bezier(0.2, 0, 0, 1); }
${indent}.table tbody tr:hover { background: var(--hover); }
${indent}.table tbody tr:hover td,
${indent}.table tbody tr:hover th { color: var(--body-on-hover); }
${indent}.table tbody tr.row--selected { background: var(--selected); }
${indent}.table tbody tr.row--selected td,
${indent}.table tbody tr.row--selected th { color: var(--body-on-selected); }
${indent}.table tbody tr.row--selected td:first-child {
${indent}  /* Selection is a tint plus a rail, so the state never depends on the
${indent}     tint alone, and the rail survives a greyscale render. */
${indent}  box-shadow: inset 3px 0 0 var(--brand);
${indent}}
${indent}.table tbody tr.row--selected .status--ok { color: var(--ok-ink-on-selected); }
${indent}.table tbody tr.row--selected .status--warn { color: var(--warn-ink-on-selected); }
${indent}.table tbody tr.row--selected .status--stop { color: var(--danger-ink-on-selected); }
${indent}.table tbody tr.row--selected .status--neutral { color: var(--body-on-selected); }

${indent}/* Inside a tinted row the pill's own soft fill would be a third layer of
${indent}   tint on top of the row tint, and the ink loses contrast against the
${indent}   result. Dropping the fill costs nothing: the row already says it is
${indent}   selected, and the word in the pill still carries the status. */
${indent}tr.row--selected .status { background: transparent; padding-left: 0; padding-right: 0; }

${indent}/* A control inside a tinted row keeps its own fill, and its label is
${indent}   re-judged against that fill rather than against the row. Without this
${indent}   a quiet button in a selected row loses contrast twice over. */
${indent}tr.row--selected .btn--quiet {
${indent}  color: var(--body-on-brand-soft);
${indent}  border-color: var(--edge-strong-on-selected);
${indent}}

/* The sortable header is a real button, so it is a real target with a ring. */
${indent}.th-sort {
${indent}  display: inline-flex;
${indent}  align-items: center;
${indent}  gap: ${SPACE[1]};
${indent}  min-height: ${TAP};
${indent}  margin: calc(-1 * ${SPACE[3]}) calc(-1 * ${SPACE[4]});
${indent}  padding: ${SPACE[3]} ${SPACE[4]};
${indent}  font: inherit;
${indent}  color: inherit;
${indent}  background: transparent;
${indent}  border: 0;
${indent}  cursor: pointer;
${indent}}

${indent}.th-sort:hover { color: var(--body); }

${indent}.th-sort:focus-visible {
${indent}  outline: 2px solid var(--focus);
${indent}  outline-offset: -2px;
${indent}  border-radius: ${RADIUS.sm};
${indent}}

${indent}.th-sort--active { color: var(--body); }
${indent}.th-sort__arrow { font-size: 11px; opacity: 0.65; }
${indent}.th-sort--active .th-sort__arrow { opacity: 1; }

/* ---- Skeleton: the shape of the content it replaces ---- */

${indent}.table-skeleton {
${indent}  /* Sits under an empty table, so the height it reserves is the height
${indent}     the rows will take. A spinner here would collapse the layout. */
${indent}  padding: ${SPACE[2]} 0 ${SPACE[4]};
${indent}}
${indent}.skeleton { display: grid; gap: ${SPACE[3]}; }
${indent}.skeleton__row { display: flex; gap: ${SPACE[4]}; }
${indent}.skeleton__bar {
${indent}  flex: 1;
${indent}  height: 14px;
${indent}  border-radius: ${RADIUS.sm};
${indent}  /* A visible base colour with a pulse on top, rather than a pulse
${indent}     alone. A skeleton whose only signal is an opacity animation
${indent}     renders as an empty box in any screenshot taken between keyframes,
${indent}     which is exactly when somebody is looking for evidence. */
${indent}  background: var(--hover);
${indent}  animation: states-pulse 1.4s ease-in-out infinite;
${indent}}
/* The pulse fades rather than disappearing, so the bar is always at least
   half visible and the shape never vanishes between keyframes. */
@keyframes states-pulse {
  0%, 100% { opacity: 1; }
  50% { opacity: 0.6; }
}

/* ---- Status: the word carries the meaning, the dot only reinforces it ---- */

${indent}.status {
${indent}  display: inline-flex;
${indent}  align-items: center;
${indent}  gap: 6px;
${indent}  padding: 2px 10px;
${indent}  border-radius: ${RADIUS.full};
${indent}  font-size: ${TYPE.xs.size};
${indent}  font-weight: 500;
${indent}  white-space: nowrap;
${indent}}

${indent}.status__dot {
${indent}  width: 6px;
${indent}  height: 6px;
${indent}  border-radius: 50%;
${indent}  background: currentColor;
${indent}}

${indent}.status--ok { color: var(--ok-ink); background: var(--ok-soft); }
${indent}.status--warn { color: var(--warn-ink); background: var(--warn-soft); }
${indent}.status--stop { color: var(--danger-ink); background: var(--danger-soft); }
${indent}.status--neutral { color: var(--muted); background: var(--hover); }

/* Secondary text inside a tinted row, re-judged against the tint. */
${indent}.muted-text { color: var(--muted); }
${indent}tr:hover .muted-text { color: var(--muted-on-hover); }
${indent}tr.row--selected .muted-text { color: var(--muted-on-selected); }

/* ---- Pagination: the edges are disabled, not hidden ---- */

${indent}.pagination {
${indent}  display: flex;
${indent}  align-items: center;
${indent}  justify-content: space-between;
${indent}  gap: ${SPACE[3]};
${indent}  margin-top: ${SPACE[4]};
${indent}}

${indent}.pagination__step {
${indent}  display: inline-flex;
${indent}  align-items: center;
${indent}  justify-content: center;
${indent}  width: ${TAP};
${indent}  height: ${TAP};
${indent}  font: inherit;
${indent}  color: var(--body);
${indent}  background: transparent;
${indent}  border: 1px solid var(--edge-strong);
${indent}  border-radius: ${RADIUS.md};
${indent}  cursor: pointer;
${indent}}

${indent}.pagination__step:hover:not(:disabled) { background: var(--hover); }

${indent}.pagination__step:focus-visible {
${indent}  outline: 2px solid var(--focus);
${indent}  outline-offset: 2px;
${indent}}

${indent}.pagination__step:disabled {
${indent}  color: var(--disabled);
${indent}  border-color: var(--edge);
${indent}  cursor: not-allowed;
${indent}}

${indent}.pagination__status { font-size: ${TYPE.sm.size}; color: var(--muted); }

/* ---- Toolbar ---- */

${indent}.toolbar {
${indent}  display: flex;
${indent}  flex-wrap: wrap;
${indent}  align-items: flex-end;
${indent}  gap: ${SPACE[3]};
${indent}  margin-bottom: ${SPACE[4]};
${indent}}

${indent}.toolbar .field { margin-bottom: 0; flex: 1; min-width: 180px; }

${reducedMotionCss({ indent }).replace(/^ {2}/gm, indent)}

/* A table turns into a stack of cards on a phone. Each value keeps its own
   label, because a bare value with no heading is unreadable in a card. */
@media (max-width: 640px) {
  .table-wrap { overflow-x: visible; margin-inline: 0; padding-inline: 0; }
  .table thead { display: none; }
  .table, .table tbody, .table tr, .table td, .table th[scope="row"] { display: block; width: 100%; }
  /* The caption is not a cell. Letting it into the row rules turns it into a
     stack of one-word lines, which is how a caption ends up one word wide. */
  .table caption { display: block; width: 100%; padding: 0 0 12px; }
  .table tr {
    border: 1px solid var(--edge);
    border-radius: ${RADIUS.md};
    padding: ${SPACE[3]} ${SPACE[4]};
    margin-bottom: ${SPACE[3]};
  }
  .table tbody tr.row--selected td:first-child { box-shadow: none; }
  .table tbody tr.row--selected { border-color: var(--brand); }
  .table td, .table th[scope="row"] {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: ${SPACE[4]};
    padding: 6px 0;
    border-bottom: 0;
    /* The row header is bold in the wide layout; in the card layout the row's
       identity should not shout over the values it heads. */
    font-weight: 500;
  }
  .table td::before, .table th[scope="row"]::before {
    content: attr(data-label);
    flex: none;
    font-size: ${TYPE.xs.size};
    font-weight: 500;
    color: var(--muted);
  }
  /* A label that does not apply, like the row action cell, gets no label
     rather than an empty one. */
  .table td[data-label=""]::before { content: none; }
}

@media (max-width: 480px) {
  .wrap { padding: ${SPACE[6]} ${SPACE[4]} ${SPACE[12]}; }
  .panel { padding: ${SPACE[4]}; }
  .actions .btn { flex: 1; }
}`;
}

/**
 * A whole page, assembled.
 *
 * `body` is the markup; `componentCss()` is the stylesheet. Emitting both from
 * one call is what stops a page from shipping with the markup and the CSS out of
 * step, which is the failure that makes every other rule in this skill moot.
 */
export function page({ title, lede = null, content } = {}) {
  const light = palette();
  const dark = palette({ surface: "#0e1116", brand: "#7c9cff", danger: "#ff8a80" });
  const css = [
    componentCss(light),
    "",
    "// The dark palette is the same tokens, re-pointed. Shipping only a light",
    "// theme is how an interface becomes unreadable at night.",
    "@media (prefers-color-scheme: dark) {",
    tokensCss(dark, { indent: "  " }),
    "}",
  ].join("\n");

  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(title)}</title>
<style>
${css}
</style>
</head>
<body>
<div class="wrap">
  <h1>${esc(title)}</h1>
  ${lede ? `<p class="lede">${esc(lede)}</p>` : ""}
${content}
</div>
</body>
</html>
`;
}
