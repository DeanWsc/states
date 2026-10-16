// Table primitive tests.
//
// Several of these assert things that only became obvious by looking at a
// screenshot: a skeleton whose bars are inside a cell and collapse to nothing,
// a caption that inherits the row rules and ends up one word wide, an empty
// table that still offers to sort columns that do not exist. A test that does
// not encode them lets them back in.
import test from "node:test";
import assert from "node:assert/strict";
import { table, skeletonRows, pagination, status, toolbar, field, button, componentCss } from "../kit/ui.mjs";
import { audit } from "../kit/audit.mjs";

const auditFragment = (body, extraCss = "") =>
  audit(`<!doctype html><html><head><style>${componentCss()}${extraCss}</style></head><body><div class="wrap">${body}</div></body></html>`);
const errorsOf = (r, check) =>
  r.findings.filter((f) => f.severity === "error" && (!check || f.check === check));

const COLUMNS = [
  { key: "id", label: "Invoice", sortable: true, sort: "descending" },
  { key: "client", label: "Client" },
  { key: "amount", label: "Amount", align: "right", render: (r) => `$${r.amount}` },
];
const ROWS = [
  { id: "INV-1", client: "Northwind", amount: 100 },
  { id: "INV-2", client: "Contoso", amount: 200 },
];

/** A fragment with the table's caption and note paragraphs around it. */
const withTable = (markup) =>
  `<section class="panel"><h2 class="panel__title">Invoices</h2><p class="panel__note">A note.</p>${markup}</section>`;

test("a table with rows audits clean", () => {
  const result = auditFragment(withTable(table({ caption: "Invoices", columns: COLUMNS, rows: ROWS })));
  assert.deepEqual(errorsOf(result), [], JSON.stringify(errorsOf(result).map((f) => f.message)));
});

test("a sortable header is a real button with aria-sort", () => {
  const columns = [
    { key: "id", label: "Invoice", sortable: true, sort: "descending" },
    { key: "client", label: "Client", sortable: true },
    { key: "amount", label: "Amount", align: "right" },
  ];
  const html = table({ caption: "Invoices", columns, rows: ROWS });
  // The direction is announced, not only drawn.
  assert.match(html, /<th scope="col" aria-sort="descending">/);
  assert.match(html, /class="th-sort th-sort--active"/);
  assert.match(html, /<button type="button" class="th-sort/);
  // A sortable column that is not currently sorted still declares itself as one.
  assert.match(html, /aria-sort="none"/);
  // A column that cannot be sorted does not pretend otherwise.
  assert.match(html, /<th scope="col" style="text-align:right">Amount<\/th>/);
  // The arrow is decorative; the meaning is in aria-sort and the sr-only text.
  assert.match(html, /th-sort__arrow" aria-hidden="true"/);
  assert.match(html, /, sorted descending/);
});

test("an unsorted column still offers a sort control", () => {
  const columns = [
    { key: "id", label: "Invoice", sortable: true },
    { key: "client", label: "Client" },
  ];
  const html = table({ caption: "I", columns, rows: ROWS });
  assert.match(html, /, not sorted/);
  assert.match(html, /↕/, "an unsorted sortable column still shows it can be sorted");
  assert.match(html, /aria-sort="none"/);
});

test("an empty table has no header to sort nothing with", () => {
  // Leaving <thead> up invites someone to sort data that is not there.
  const html = table({
    caption: "No invoices",
    columns: COLUMNS,
    rows: [],
    empty: { title: "Nothing yet", body: "Add one." },
  });
  assert.ok(!html.includes("<thead"), "an empty table must not render a header");
  assert.ok(!html.includes("th-sort"), "and must not offer a sort control");
  assert.match(html, /Nothing yet/);
});

test("skeleton rows produce bars, and they are not inside a cell", () => {
  const bars = skeletonRows(4, 3);
  assert.equal((bars.match(/skeleton__bar/g) || []).length, 12);
  assert.equal((bars.match(/skeleton__row/g) || []).length, 3);

  // In a cell they inherit the cell's layout rules, and in the narrow card
  // layout every cell becomes a flex pair, which collapses the row to nothing.
  const html = table({ caption: "L", columns: COLUMNS, rows: [], skeleton: bars });
  assert.match(html, /table-skeleton/);
  assert.ok(!html.includes("<td"), "the skeleton must not live inside a table cell");
  assert.match(html, /aria-busy="true"/);
});

test("a skeleton is announced as loading", () => {
  const bars = skeletonRows(3, 2);
  assert.match(bars, /role="status"/);
  assert.match(bars, /Loading/);
});

test("every cell carries its own label for the collapsed layout", () => {
  // Below 640px each row becomes a card whose cells read "Amount  $23,150".
  // Without data-label a card is a column of bare numbers.
  const html = table({ caption: "I", columns: COLUMNS, rows: ROWS });
  assert.match(html, /data-label="Invoice"/);
  assert.match(html, /data-label="Client"/);
  assert.match(html, /data-label="Amount"/);
});

test("the first column is a row header", () => {
  // A real <th scope="row">, not a <td> with a scope attribute: that is how a
  // screen reader announces "Northwind, row 2 of 4" instead of a flat grid.
  const html = table({ caption: "I", columns: COLUMNS, rows: ROWS });
  assert.match(html, /<th scope="row" data-label="Invoice">INV-1<\/th>/);
  assert.ok(!html.includes("<td scope"), "scope belongs on th, not td");
});

test("a selected row is marked and carries a second cue", () => {
  const html = table({ caption: "I", columns: COLUMNS, rows: ROWS, selected: ["INV-2"] });
  assert.match(html, /aria-selected="true"/);
  assert.match(html, /row--selected/);
  // The rail is what survives a greyscale render, so selection is not a tint
  // alone.
  const css = componentCss();
  assert.match(css, /row--selected td:first-child/);
  assert.match(css, /inset 3px 0 0 var\(--brand\)/);
});

test("text inside a selected row keeps its contrast", () => {
  // The selected row is a tinted surface, and the text on it has to be judged
  // against the tint. This caught a palette whose selection was 92% brand.
  const result = auditFragment(
    withTable(table({
      caption: "Invoices",
      columns: [
        ...COLUMNS,
        { key: "state", label: "Status", render: (r) => status({ label: r.state || "Paid", tone: "ok" }) },
        { key: "", label: "", render: () => button({ label: "Open", variant: "quiet" }) },
      ],
      rows: ROWS.map((r) => ({ ...r, state: "Paid" })),
      selected: ["INV-1"],
    })),
  );
  assert.deepEqual(errorsOf(result, "contrast"), [], "a selected row must stay readable");
});

test("pagination disables its edges rather than hiding them", () => {
  const first = pagination({ page: 1, total: 5 });
  assert.match(first, /aria-label="Previous page"[^>]*disabled|disabled[^>]*aria-label="Previous page"/);
  assert.ok(!/Next page"[^>]*disabled/.test(first), "next is available on page 1");
  const last = pagination({ page: 5, total: 5 });
  assert.match(last, /disabled/, "previous is available on page 5");
  // The current page is stated in text, not only implied by weight.
  assert.match(first, /Page <strong>1<\/strong> of 5/);
});

test("status carries the meaning in words, not only in a colour", () => {
  const html = status({ label: "Overdue", tone: "stop" });
  assert.match(html, /Overdue/);
  assert.match(html, /status__dot" aria-hidden="true"/);
});

test("a toolbar puts its controls in a flex row that wraps", () => {
  const html = toolbar({ search: field({ label: "Search", name: "q" }), children: button({ label: "Filter" }) });
  assert.match(html, /role="toolbar"/);
  assert.match(html, /aria-label="Table controls"/);
  const css = componentCss();
  // Without flex-wrap a third control is cut off on a phone.
  assert.match(css, /\.toolbar \{[\s\S]*?flex-wrap: wrap/);
});

test("the narrow layout turns rows into cards that keep their labels", () => {
  const css = componentCss();
  const block = /@media \(max-width: 640px\) \{[\s\S]*?\n\}/.exec(css);
  assert.ok(block, "there must be a narrow-width block");
  const narrow = block[0];
  assert.match(narrow, /\.table thead \{ display: none; \}/);
  // The row header is a th, so it has to be in the block-to-full-width rule or
  // the first line of every card renders at the browser's default width.
  assert.match(narrow, /\.table, \.table tbody, \.table tr, \.table td, \.table th\[scope="row"\] \{ display: block; width: 100%; \}/);
  assert.match(narrow, /content: attr\(data-label\)/);
  // The caption is not a cell, and letting it into the row rules turns it into
  // a stack of one-word lines.
  assert.match(narrow, /\.table caption \{/);
});

test("identifiers and dates do not wrap mid-token", () => {
  const css = componentCss();
  assert.match(css, /th\[scope="row"\][\s\S]*?white-space: nowrap/);
});

test("the table CSS contains the states it promises", () => {
  const css = componentCss();
  for (const selector of [".table tbody tr:hover", ".table tbody tr.row--selected", ".th-sort:focus-visible", ".pagination__step:disabled"]) {
    assert.ok(css.includes(selector), `${selector} must exist`);
  }
});

test("every table state audits clean", () => {
  // The example's claim is that all of these pass, so the test says so.
  const states = [
    table({ caption: "Rows", columns: COLUMNS, rows: ROWS, selected: ["INV-1"] }),
    table({ caption: "Loading", columns: COLUMNS, rows: [], skeleton: skeletonRows(3, 3) }),
    table({ caption: "Filtered empty", columns: COLUMNS, rows: [], empty: { title: "No matches", body: "Try fewer letters.", action: button({ label: "Clear" }) } }),
    pagination({ page: 2, total: 9 }),
  ];
  const result = auditFragment(states.map(withTable).join(""));
  assert.deepEqual(
    errorsOf(result),
    [],
    JSON.stringify(errorsOf(result).map((f) => `${f.check}: ${f.message}`), null, 1),
  );
});
