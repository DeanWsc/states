#!/usr/bin/env node
// Build the generated example, then hold it to the audit.
//
//   node examples/upload-queue/build.mjs
//
// The point of building through kit/ui.mjs rather than writing HTML by hand is
// that the states come out of the same function as the markup, so they cannot
// drift apart. This script proves the claim: it builds the page, runs the audit
// on what it produced, and refuses to leave a failing page behind.
//
// Adding --check runs the layout measurement too, which needs Chrome. Without
// Chrome it reports that and still succeeds, because a build machine without a
// browser is not a broken build.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import { page, panel, field, button, toggle, checkbox, row, empty, srOnly } from "../../kit/ui.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT = join(HERE, "upload-queue.html");

/**
 * An upload queue.
 *
 * Chosen because it is the interface shape that shows why states matter: a file
 * list is empty on first run, busy on every upload, and partly failed at the
 * worst possible moment. A design that only ever renders "three files uploading"
 * is not a design, it is a screenshot.
 */
const content = [
  panel({
    title: "Upload queue",
    note: "Files are scanned before they leave your browser.",
    children: [
      // The happy path, with a field that is currently wrong. The error is shown
      // in text and wired with aria-describedby, not by tinting the border.
      field({
        label: "Destination folder",
        name: "folder",
        value: "/Users/ryan/Downloads",
        invalid: true,
        message: "That folder no longer exists. Pick another.",
      }),
      field({
        label: "Max size per file",
        name: "max",
        type: "number",
        value: "250",
        hint: "Files above this are split automatically.",
      }),
      `<div class="actions">
        ${button({ label: "Choose folder" })}
        ${button({ label: "Clear", variant: "quiet" })}
        ${button({ label: "Upload 3 files", loading: true, busy: true })}
        ${button({ label: "Upload all", disabled: true })}
      </div>`,
    ].join("\n"),
  }),

  panel({
    title: "Behaviour",
    children: [
      row({
        label: "Scan before upload",
        note: "Looks for duplicates and secrets. Adds about a second.",
        html: toggle({ label: "Scan before upload", checked: true }),
      }),
      row({
        label: "Keep the folder structure",
        note: "Recreates subfolders on the server.",
        html: toggle({ label: "Keep the folder structure", checked: false }),
      }),
      row({
        label: "Notify when finished",
        note: "A toast, once everything has been scanned.",
        html: checkbox({ label: "Notify me when every file has been scanned" }),
      }),
    ].join("\n"),
  }),

  // The state most often left out. It has a title, an explanation and a way out.
  panel({
    title: "Failed uploads",
    children: empty({
      title: "Nothing has failed yet",
      body: "Files that error out will appear here with the reason.",
      action: button({ label: "View the retry guide", variant: "quiet" }),
    }),
  }),
].join("\n");

const html = page({
  title: "Upload queue",
  lede: "Three files are uploading. One needs your attention.",
  content,
});

mkdirSync(HERE, { recursive: true });
writeFileSync(OUT, html);
process.stdout.write(`built ${OUT}\n`);

// Audit what was just built. A generator that produces a failing page is broken,
// and this is where that gets noticed rather than in review.
const audit = spawnSync(process.execPath, [join(ROOT, "scripts", "audit.mjs"), OUT, "--quiet"], {
  encoding: "utf8",
});
process.stdout.write(audit.stdout?.trim() ?? "");
if (audit.status !== 0) {
  process.stderr.write("build: the generated page failed the audit\n");
  process.stderr.write(audit.stdout ?? "");
  process.exit(audit.status ?? 1);
}

if (process.argv.includes("--check")) {
  for (const width of [1280, 390, 320]) {
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
