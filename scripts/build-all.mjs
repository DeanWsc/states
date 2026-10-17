#!/usr/bin/env node
// Rebuild every generated example, in one command.
//
//   node scripts/build-all.mjs            # rebuild, then verify
//   node scripts/build-all.mjs --check    # also measure the layout
//
// This exists because of a specific repeated mistake. Three times now the kit
// has changed and two of the three builds were rerun, and CI's regression lock
// caught the third with "8 insertions". Every example is generated from the same
// kit, so changing the kit means rebuilding all of them, and doing that by
// remembering is a way of guaranteeing the lock will fail.
//
// So: one command, every build, then the audits. If anything drifts, it is
// caught here rather than on a push.

import { spawnSync } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..");
const checkLayout = process.argv.includes("--check");

// Every directory under examples/ with a build.mjs, discovered rather than
// listed, so adding an example cannot mean forgetting to add it here.
const { readdirSync } = await import("node:fs");
const examplesDir = join(ROOT, "examples");
const builds = readdirSync(examplesDir)
  .filter((name) => existsSync(join(examplesDir, name, "build.mjs")))
  .sort();

if (!builds.length) {
  process.stderr.write("build-all: no generated examples found\n");
  process.exit(2);
}

let failed = 0;

for (const name of builds) {
  process.stdout.write(`\n=== ${name} ===\n`);
  const args = [join(examplesDir, name, "build.mjs")];
  if (checkLayout) args.push("--check");
  const run = spawnSync(process.execPath, args, { encoding: "utf8", stdio: "pipe" });
  process.stdout.write(run.stdout ?? "");
  if (run.stderr) process.stderr.write(run.stderr);
  if (run.status !== 0) {
    process.stderr.write(`build-all: ${name} failed\n`);
    failed++;
  }
}

process.stdout.write(`\n${builds.length} example(s) rebuilt, ${failed} failed\n`);

// The lock's own question: does rebuilding reproduce what is committed?
const diff = spawnSync("git", ["status", "--porcelain"], { encoding: "utf8", cwd: ROOT });
if (diff.status === 0 && diff.stdout.trim()) {
  process.stdout.write("\nUncommitted changes after rebuilding:\n");
  process.stdout.write(diff.stdout.split("\n").filter(Boolean).map((l) => `  ${l}`).join("\n"));
  process.stdout.write("\nCommit them, or the regression lock will fail.\n");
}

process.exit(failed > 0 ? 1 : 0);
