// The clock a composition runs on.
//
// A browser page normally runs on wall-clock time: an animation is wherever it
// happens to be when you look. A video cannot work like that. Frame 90 has to
// look the same whether it is rendered first, last, on a fast machine or a slow
// one. So before the page's own scripts run, this replaces every clock the page
// can read with one the renderer sets:
//
//   - CSS animations, transitions and the Web Animations API are paused and
//     moved to the frame's time;
//   - requestAnimationFrame callbacks run once per frame, with the frame's time;
//   - performance.now(), Date.now() and new Date() read the frame's time;
//   - Math.random() is seeded per frame, so noise is the same on every render;
//   - <video> elements are seeked to the frame, offset by data-reel-start.
//
// A composition can also define window.__reel.seek(t) to set itself up for
// time t directly. That is the most robust way to animate, because it is a pure
// function of t and nothing has to be replayed.

export const RUNTIME = String.raw`(() => {
  if (window.__reelSeek) return;
  const EPOCH = Date.UTC(2026, 0, 1);
  const RealDate = Date;
  let now = 0;           // seconds
  let seed = 0x9e3779b9;

  Math.random = () => {
    seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5;
    return (seed >>> 0) / 4294967296;
  };
  performance.now = () => now * 1000;
  class ReelDate extends RealDate {
    constructor(...args) { args.length ? super(...args) : super(EPOCH + now * 1000); }
    static now() { return EPOCH + now * 1000; }
  }
  window.Date = ReelDate;

  let queue = [];
  window.requestAnimationFrame = (cb) => { queue.push(cb); return queue.length; };
  window.cancelAnimationFrame = (id) => { if (queue[id - 1]) queue[id - 1] = null; };

  const waitFor = (el, event, ms) => new Promise((ok) => {
    const t = setTimeout(ok, ms);
    el.addEventListener(event, () => { clearTimeout(t); ok(); }, { once: true });
  });

  let ready = null;
  const prepare = () => ready ??= (async () => {
    await document.fonts.ready;
    await Promise.all([...document.images].map((img) => img.decode().catch(() => {})));
    await Promise.all([...document.querySelectorAll("video")].map((v) => {
      v.muted = true; v.pause();
      return v.readyState >= 2 ? null : waitFor(v, "loadeddata", 10000);
    }));
  })();

  window.__reelSeek = async (t, frame) => {
    await prepare();
    now = t;
    seed = (0x9e3779b9 ^ Math.imul(frame + 1, 0x85ebca6b)) >>> 0 || 1;

    for (const a of document.getAnimations()) {
      a.pause();
      a.currentTime = t * 1000;
    }

    const cfg = window.__reel || {};
    if (typeof cfg.seek === "function") await cfg.seek(t, frame);

    // Callbacks queued during the last frame run now, at this frame's time.
    // Callbacks they queue wait for the next frame, as in a real browser.
    const run = queue; queue = [];
    for (const cb of run) if (cb) cb(t * 1000);

    await Promise.all([...document.querySelectorAll("video")].map((v) => {
      const start = parseFloat(v.dataset.reelStart || "0");
      const local = Math.max(0, Math.min(t - start, (v.duration || Infinity) - 0.001));
      if (Math.abs(v.currentTime - local) < 0.0005) return null;
      const seeked = waitFor(v, "seeked", 5000);
      v.currentTime = local;
      return seeked;
    }));
    return true;
  };
})();`;

/** Read and validate window.__reel from a loaded page. */
export function parseConfig(raw) {
  const problems = [];
  if (!raw || typeof raw !== "object") {
    return { config: null, problems: ["the page does not define window.__reel = { width, height, fps, duration }"] };
  }
  const config = {
    width: Number(raw.width),
    height: Number(raw.height),
    fps: Number(raw.fps ?? 30),
    duration: Number(raw.duration),
    audio: Array.isArray(raw.audio) ? raw.audio : [],
  };
  for (const key of ["width", "height", "fps", "duration"]) {
    if (!Number.isFinite(config[key]) || config[key] <= 0) problems.push(`__reel.${key} must be a positive number`);
  }
  if (config.width % 2 || config.height % 2) problems.push(`H.264 needs even dimensions; got ${config.width}×${config.height}`);
  if (config.width > 4096 || config.height > 4096) problems.push("dimensions above 4096 are not supported");
  config.frames = Math.round(config.duration * config.fps);
  return { config, problems };
}

/** The config, read from the page as plain data (a seek function cannot cross). */
export const READ_CONFIG = `(() => {
  const c = window.__reel;
  if (!c || typeof c !== "object") return null;
  return { width: c.width, height: c.height, fps: c.fps, duration: c.duration, audio: c.audio };
})()`;
