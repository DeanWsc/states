#!/usr/bin/env node
// Build the table example, then hold it to the audit and the layout check.
//
//   node examples/invoices/build.mjs
//   node examples/invoices/build.mjs --check
//
// Chosen because a data table is where the state argument is hardest to honour
// and where the skill's claims are easiest to test:
//
//   * a table is never just rows: they hover, focus, get selected, sort three
//     ways, and are replaced by a skeleton while loading
//   * "empty because there is no data" and "empty because a filter excluded it
//     all" look identical in code and mean opposite things to the reader
//   * a table is the component that breaks hardest on a phone, and the fix is
//     not a smaller font: each value has to keep its own label
//
// So this example renders the same component in every one of those states,
// side by side, and the build refuses to leave a page that fails.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  page, panel, button, field, table, skeletonRows, pagination, status, toolbar, empty, row, toggle,
} from "../../kit/ui.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT = join(HERE, "invoices.html");

const money = (n) => `$${n.toLocaleString("en-US")}`;

const COLUMNS = [
  { key: "id", label: "Invoice", sortable: true, sort: "descending" },
  { key: "client", label: "Client", sortable: true },
  {
    key: "amount",
    label: "Amount",
    align: "right",
    sortable: true,
    render: (r) => `<span class="num">${money(r.amount)}</span>`,
  },
  {
    key: "due",
    label: "Due",
    sortable: true,
    render: (r) => `<span class="muted-text">${r.due}</span>`,
  },
  {
    key: "state",
    label: "Status",
    render: (r) => status({ label: r.state, tone: TONE[r.state] }),
  },
  {
    key: "",
    label: "",
    render: () => button({ label: "Open", variant: "quiet" }),
  },
];

const TONE = { Paid: "ok", Due: "warn", Overdue: "stop", Draft: "neutral" };

const ROWS = [
  { id: "INV-2041", client: "Northwind", amount: 12400, due: "12 Mar", state: "Paid" },
  { id: "INV-2040", client: "Contoso", amount: 8900, due: "14 Mar", state: "Due" },
  { id: "INV-2039", client: "Fabrikam", amount: 23150, due: "02 Mar", state: "Overdue" },
  { id: "INV-2038", client: "Adventure Works", amount: 4600, due: "20 Mar", state: "Draft" },
];

const content = [
  panel({
    title: "Invoices",
    note: "Sorted by invoice number, newest first. One row is selected.",
    children: [
      toolbar({
        search: field({ label: "Search clients", name: "q", placeholder: "Northwind, Contoso…" }),
        children: button({ label: "Filter", variant: "quiet" }),
      }),
      table({
        caption: "Four invoices, most recent first",
        columns: COLUMNS,
        rows: ROWS,
        selected: ["INV-2039"],
      }),
      pagination({ page: 2, total: 9 }),
    ].join("\n"),
  }),

  panel({
    title: "Loading",
    note: "The skeleton has the shape of the content it replaces, so nothing jumps when the data lands.",
    children: table({
      caption: "Loading invoices",
      columns: COLUMNS,
      rows: [],
      skeleton: skeletonRows(4, 3),
    }),
  }),

  panel({
    title: "Empty, filtered",
    note: "Not the same as no data at all, and it does not read the same way.",
    children: table({
      caption: "No invoices match “fabrikam”",
      columns: COLUMNS,
      rows: [],
      empty: {
        title: "No invoices match “fabrikam”",
        body: "Try a shorter search, or clear the filter to see all four.",
        action: button({ label: "Clear search", variant: "quiet" }),
      },
    }),
  }),

  panel({
    title: "Empty, first run",
    children: empty({
      title: "No invoices yet",
      body: "Invoices appear here once you have a billable client.",
      action: button({ label: "Create your first invoice" }),
    }),
  }),

  panel({
    title: "Selection and settings",
    children: [
      row({
        label: "Email me about overdue invoices",
        note: "Once a day, not once per invoice.",
        html: toggle({ label: "Email me about overdue invoices", checked: true }),
      }),
      row({
        label: "Show draft invoices",
        note: "Drafts are excluded from the totals above.",
        html: toggle({ label: "Show draft invoices", checked: false }),
      }),
    ].join("\n"),
  }),
].join("\n");

const html = page({
  title: "Invoices",
  lede: "Every state of the same component, side by side.",
  content,
});

mkdirSync(HERE, { recursive: true });
writeFileSync(OUT, html);
process.stdout.write(`built ${OUT}\n`);

// The gate: a generator that produces a failing page is broken.
const audit = spawnSync(process.execPath, [join(ROOT, "scripts", "audit.mjs"), OUT, "--quiet"], {
  encoding: "utf8",
});
process.stdout.write(audit.stdout?.trim() ?? "");
if (audit.status !== 0) {
  process.stderr.write("build: the generated page failed the audit\n");
  process.stderr.write(audit.stdout ?? "");
  process.exit(audit.status ?? 1);
}

// Both themes. A table that passes in light and fails in dark has a token
// problem, and the fix belongs in palette() rather than in this file.
for (const theme of ["light", "dark"]) {
  const dark = spawnSync(
    process.execPath,
    [join(ROOT, "scripts", "audit.mjs"), OUT, "--theme", theme, "--quiet"],
    { encoding: "utf8" },
  );
  if (dark.status !== 0) {
    process.stderr.write(`build: the ${theme} theme failed\n`);
    process.stderr.write(dark.stdout ?? "");
    process.exit(dark.status ?? 1);
  }
}
process.stdout.write("both themes pass\n");

if (process.argv.includes("--check")) {
  for (const width of [1280, 640, 390, 320]) {
    const measure = spawnSync(
      process.execPath,
      [join(ROOT, "scripts", "measure.mjs"), OUT, "--width", String(width)],
      { encoding: "utf8" },
    );
    process.stdout.write(measure.stdout?.trim() ?? "");
    if (measure.status !== 0) {
      process.stderr.write(`build: layout check failed at ${width}px\n`);
      process.exit(measure.status ?? 1);
    }
  }
}
