// Open a composition, read what it says about itself, and move it in time.

import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { openPage } from "./chrome.mjs";
import { RUNTIME, READ_CONFIG, parseConfig } from "./runtime.mjs";

/**
 * Load an HTML composition at its own size.
 * Returns { config, problems, page, seek(frame), still(frame), close }.
 */
export async function openComposition(file, { chrome } = {}) {
  const path = resolve(file);
  if (!existsSync(path)) throw new Error(`no such file: ${file}`);
  const url = pathToFileURL(path).href;
  const page = await openPage({ url, width: 1920, height: 1080, init: RUNTIME, chrome });
  try {
    const { config, problems } = parseConfig(await page.evaluate(READ_CONFIG));
    if (config && !problems.length) await page.resize(config.width, config.height);

    /** Put the page at a frame. Time is frame / fps, so frames never drift. */
    const seek = async (frame) => {
      const t = frame / config.fps;
      await page.evaluate(`window.__reelSeek(${t}, ${frame})`);
      return t;
    };
    const still = async (frame) => {
      await seek(frame);
      return page.screenshot();
    };
    return { config, problems, page, url, seek, still, close: page.close };
  } catch (err) {
    page.close();
    throw err;
  }
}
