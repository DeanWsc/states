#!/usr/bin/env node
// A team permissions panel, built the way the skill says to build one.
//
//   node examples/access/build.mjs --check
//
// The brief: "a permissions panel for a team". That sentence contains no states,
// and the whole point of the skill is that the states are what you actually
// have to design. So before any markup, here is what this panel owes:
//
//   button      hover focus active disabled loading   (invite, save, revoke)
//   text field  focus invalid                          (the search field)
//   checkbox    focus checked disabled                (per-permission boxes)
//   switch      focus checked disabled                (role overrides)
//   pagination  focus disabled                        (24 people, 8 a page)
//   dialog      focus loading                         (the revoke confirmation)
//
// Every one of those is enforced by scripts/audit.mjs, so the list is not a
// promise, it is a gate. And two of the states here are the ones most often
// skipped entirely: the revoke dialog's loading state, and the empty state for
// "no results for that search" as distinct from "this team has nobody".

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  page, panel, field, button, toggle, checkbox, row, table, status,
  pagination, empty, toolbar, skeletonRows, srOnly,
} from "../../kit/ui.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT = join(HERE, "access.html");

const TONE = { Owner: "ok", Admin: "neutral", Member: "neutral", Pending: "warn" };

const PEOPLE = [
  { id: "u1", name: "Rae Okonkwo", email: "rae@studio.dev", role: "Owner", seats: "Owner since 2024" },
  { id: "u2", name: "Sam Iyer", email: "sam@studio.dev", role: "Admin", seats: "2FA on" },
  { id: "u3", name: "Noor Haddad", email: "noor@studio.dev", role: "Admin", seats: "2FA off", warn: true },
  { id: "u4", name: "Kit Alvarez", email: "kit@studio.dev", role: "Member", seats: "Invited 3 Mar" },
];

const COLUMNS = [
  {
    key: "name",
    label: "Person",
    sortable: true,
    sort: "ascending",
    render: (r) => `<span class="who"><span class="who__name">${r.name}</span><span class="who__mail">${r.email}</span></span>`,
  },
  {
    key: "role",
    label: "Role",
    sortable: true,
    render: (r) => status({ label: r.role, tone: TONE[r.role] }),
  },
  { key: "seats", label: "Security" },
  {
    key: "",
    label: "",
    render: () => button({ label: "Edit", variant: "quiet" }),
  },
];

const content = [
  panel({
    title: "Team access",
    note: "24 people · 8 shown",
    children: [
      toolbar({
        search: field({ label: "Search people", name: "q", placeholder: "Name or email" }),
        children: [
          button({ label: "Filter" , variant: "quiet" }),
          button({ label: "Invite people" }),
        ].join(""),
      }),
      table({ caption: "People with access, by name", columns: COLUMNS, rows: PEOPLE }),
      pagination({ page: 1, total: 3 }),
    ].join("\n"),
  }),

  // The state most often skipped: a search that matched nothing is not the same
  // as a team with nobody, and the copy has to say which one happened.
  panel({
    title: "Search with no results",
    note: "A different state from the one above, and it reads differently.",
    children: empty({
      title: "Nobody matches “qzx”",
      body: "This team has 24 people. Check the spelling, or clear the search.",
      action: button({ label: "Clear search", variant: "quiet" }),
    }),
  }),

  // Per-permission boxes. These are the controls most likely to ship without a
  // focus ring, because a grid of checkboxes looks finished at rest.
  panel({
    title: "What members can do",
    note: "Applies to everyone with the Member role.",
    children: [
      row({
        label: "Create and delete projects",
        note: "Members can edit anything inside a project they own.",        html: checkbox({ label: "Let members create and delete projects", checked: true }),
      }),
      row({
        label: "Invite new people",
        note: "Off means only admins and owners can invite.",        html: checkbox({ label: "Let members invite new people" }),
      }),
      row({
        label: "Export billing data",
        note: "Exports are recorded in the audit log.",        html: checkbox({ label: "Let members export billing data" }),
      }),
    ].join("\n"),
  }),

  panel({
    title: "Overrides and destructive actions",
    children: [
      row({
        label: "Owners cannot be removed",
        note: "A team must always have at least one owner.",
        html: toggle({ label: "Owners cannot be removed", checked: true }),
      }),
      row({
        label: "Require two-factor authentication",
        note: "Noor Haddad has not set one up yet.",
        html: toggle({ label: "Require two-factor authentication", checked: false }),
      }),
      `<div class="actions">
        ${button({ label: "Save changes" })}
        ${button({ label: "Discard", variant: "quiet" })}
        ${button({ label: "Revoke 3 sessions", variant: "danger" })}
        ${button({ label: "Invite people", loading: true, busy: true })}
        ${button({ label: "Transfer ownership", disabled: true })}
      </div>`,
    ].join("\n"),
  }),

  panel({
    title: "Loading",
    note: "While the people list is in flight. The bars reserve the height the rows will take, so nothing jumps.",
    children: table({
      caption: "Loading people",
      columns: COLUMNS,
      rows: [],
      skeleton: skeletonRows(3, 4),
    }),
  }),
].join("\n");

const html = page({
  title: "Team access",
  lede: "Who can see this project, and what they can do to it.",
  content,
});

mkdirSync(HERE, { recursive: true });
writeFileSync(OUT, html);
process.stdout.write(`built ${OUT}\n`);

// Step 8: audit to zero, in both themes.
for (const theme of ["light", "dark"]) {
  const audit = spawnSync(
    process.execPath,
    [join(ROOT, "scripts", "audit.mjs"), OUT, "--theme", theme, "--quiet"],
    { encoding: "utf8" },
  );
  process.stdout.write(`${theme.padEnd(6)} ${(audit.stdout ?? "").trim()}\n`);
  if (audit.status !== 0) {
    process.stderr.write(`\nbuild: the ${theme} theme failed\n`);
    spawnSync(process.execPath, [join(ROOT, "scripts", "audit.mjs"), OUT, "--theme", theme], { stdio: "inherit" });
    process.exit(audit.status ?? 1);
  }
}

if (process.argv.includes("--check")) {
  for (const width of [1280, 640, 390, 320]) {
    const m = spawnSync(
      process.execPath,
      [join(ROOT, "scripts", "measure.mjs"), OUT, "--width", String(width)],
      { encoding: "utf8" },
    );
    process.stdout.write(`${m.stdout ?? ""}`);
    if (m.status !== 0) {
      process.stderr.write(`build: layout check failed at ${width}px\n`);
      process.exit(m.status ?? 1);
    }
  }
}
