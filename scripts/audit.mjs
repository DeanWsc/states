#!/usr/bin/env node
// The audit CLI.
//
//   node scripts/audit.mjs page.html
//   node scripts/audit.mjs page.html --theme dark
//   node scripts/audit.mjs page.html --json
//   node scripts/audit.mjs page.html --check contrast --check focus-indicator
//
// Exits 0 when no error-severity finding remains, 1 otherwise. That exit code is
// the point of this skill: it turns "does this interface hold up" into something
// a build can gate on.

import { readFileSync, existsSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { audit, render } from "../kit/audit.mjs";
import { renderMatrix } from "../kit/state.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));

/** Minimal argument parsing: flags, repeated flags, and positionals. */
function parseArgs(argv) {
  const out = { _: [], checks: [] };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--check") {
      out.checks.push(argv[++i]);
    } else if (a.startsWith("--check=")) {
      out.checks.push(a.slice(8));
    } else if (a.startsWith("--")) {
      const key = a.slice(2);
      const next = argv[i + 1];
      if (next && !next.startsWith("--")) {
        out[key] = next;
        i++;
      } else {
        out[key] = true;
      }
    } else {
      out._.push(a);
    }
  }
  return out;
}

const args = parseArgs(process.argv.slice(2));

if (args.help || args.h || !args._.length) {
  process.stdout.write(`Usage: node scripts/audit.mjs <file.html|-> [options]

Options:
  --theme <light|dark>   Evaluate the stylesheet for one theme (default: light)
  --check <name>         Run only this check (repeatable)
  --min-contrast <n>     Override the contrast ratio required (default: WCAG AA)
  --tap-min <px>         Minimum target height in px (default: 24)
  --viewport <px>        Narrow viewport width to test (default: 390)
  --json                 Print the report as JSON
  --quiet                Print only the verdict line
  --help                 Show this message

Exits 0 when no error-severity finding remains, 1 otherwise.
`);
  process.exit(args.help || args.h ? 0 : 1);
}

const file = args._[0];
let html;

if (file === "-") {
  html = readFileSync(0, "utf8");
} else {
  const path = resolve(file);
  if (!existsSync(path)) {
    process.stderr.write(`audit: no such file: ${file}\n`);
    process.exit(2);
  }
  html = readFileSync(path, "utf8");
}

// Resolve <link rel=stylesheet> relative to the file, so a split-out stylesheet
// is audited with the page rather than silently ignored.
const baseDir = file === "-" ? process.cwd() : dirname(resolve(file));
const resolveFile = (href) => {
  if (/^(https?:)?\/\//.test(href)) return null;
  const candidate = join(baseDir, href.replace(/^\.\//, ""));
  return existsSync(candidate) ? readFileSync(candidate, "utf8") : null;
};

const result = audit(html, {
  resolveFile,
  theme: args.theme || "light",
  checks: args.checks.length ? args.checks : undefined,
  minContrast: args["min-contrast"] ? Number(args["min-contrast"]) : null,
  tapMin: args["tap-min"] ? Number(args["tap-min"]) : undefined,
  viewport: args.viewport ? Number(args.viewport) : undefined,
});

if (args.json) {
  process.stdout.write(`${JSON.stringify(result, (k, v) => (k === "matrix" || k === "node" ? undefined : v), 2)}\n`);
} else if (args.quiet) {
  process.stdout.write(`${result.ok ? "audit passed" : "audit failed"}: ${result.errors} errors, ${result.warnings} warnings\n`);
} else {
  const title = file === "-" ? "stdin" : file;
  process.stdout.write(`${render(result, { title, theme: args.theme || "light" })}\n`);
  if (args.matrix) {
    process.stdout.write(`\nfull state matrix:\n${renderMatrix(result.matrix)}\n`);
  }
}

process.exit(result.ok ? 0 : 1);
