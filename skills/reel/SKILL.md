---
name: reel
description: Make a video with code — a title card, an explainer, a product promo, a data animation, a captioned short for Reels, TikTok or Shorts, a lower third, an animated chart — as an HTML page that is rendered frame by frame in headless Chrome and encoded to an H.264 MP4 with ffmpeg. Like Remotion or Revideo, but with no dependencies and no build step, and with a check that exits non-zero while text sits outside the title-safe area, is too small to read on a phone, leaves the screen before it can be read, fights its background, or renders differently on a second pass. Use this whenever someone wants a video, an animation exported as MP4, motion graphics, a video template, captions burned into a clip, or asks to "make this into a video".
license: MIT
compatibility: Written for Claude Code; also runs in Antigravity, OpenCode, Codex and MiniMax Code. Needs Node.js 22+, Chrome or Chromium, and ffmpeg for MP4 output.
metadata:
  opencode/slash: "true"
---

# Reel

A video made in a browser has one problem that a web page does not: **time has to be a number you set, not something that happens to you.** A web page animates on the wall clock. A video is frame 0, frame 1, frame 2, each of which must look the same whether it is rendered first, last, twice, on a slow machine, or in four browsers at once.

So the rule this skill is built on:

> **A frame is a function of time. Nothing else.**

`kit/runtime.mjs` makes that true for the page — it replaces every clock the page can read before the page's own scripts run — and `scripts/check.mjs` exits non-zero when it is not.

## The idea that matters

Motion graphics fail in two ways, and neither shows up in the one frame you look at:

- **The frame nobody checked.** The title is perfect at 2.5s. At 0.4s it is half off the screen and at 5.8s the caption under it has been visible for a third of a second. A video is a few hundred screenshots; you looked at one.
- **The frame that changes.** An animation that counts calls instead of reading time, a `Math.random()` that is different on every pass, a CSS transition triggered by a timer. It looks fine in the preview and stutters, jumps or flickers in the render, because the renderer does not play the page, it visits it.

The fix for both is the same as in States: **name what a viewer needs, then check it by machine.** `check.mjs` samples the whole video ten times a second, measures every piece of text that a viewer is meant to read, and renders a set of frames a second time, backwards, to prove they come out the same.

## Workflow

1. **Decide the format before the content.** Size, frame rate, duration. 1920×1080 for a landscape video, 1080×1920 for Reels, TikTok and Shorts, 1080×1080 for a feed square. 30 fps unless there is a reason: 24 for film, 60 for screen recordings and fast UI. Dimensions must be even. Write them into `window.__reel` first.
2. **Write the script as beats with times.** Before any markup: what is on screen from when to when, and what the viewer should read at each moment. `references/craft.md` has the timing rules — a caption needs about 17 characters a second in English and 9 in Chinese, and nothing at all is readable in under 0.8s.
3. **Build the page at the exact pixel size.** One self-contained HTML file. `html, body { width: 1920px; height: 1080px; overflow: hidden }`. Put fonts, images and video next to it with relative paths. Keep settled text inside the 5% title-safe margin; on a 9:16 video also keep it clear of the bottom fifth and the right edge, where the apps put their own captions and buttons.
4. **Animate with time, not with events.** Three ways, all deterministic:
   - CSS `@keyframes` and transitions, and the Web Animations API. The renderer pauses every animation and moves it to the frame's time. Animations count from t = 0, so offset them with `animation-delay`, never with a timer that adds a class later.
   - `window.__reel.seek(t)`, a function that sets the page up for time `t` from scratch. The most robust option: it is pure, so frame 90 does not depend on frame 89. Use the helpers in `kit/motion.js` — `interpolate`, `spring`, `Easing`, `scene`, `stagger`, `typewriter` — which are pure too.
   - `requestAnimationFrame`, `performance.now()`, `Date` and `Math.random()` all run on the video's clock, so existing canvas and chart code mostly works unchanged. Code that *accumulates* state between frames (a physics step, `x += speed`) still breaks when frames are rendered in parallel or out of order: rewrite it as a function of `t`.
5. **Look at single frames first.** `node scripts/render.mjs comp.html --still 2.5 --out shots/2_5.png`. It is a second per frame instead of a minute per video. Look at the first frame, the last, and every scene change.
6. **Check to zero.** `node scripts/check.mjs comp.html` must end `check passed` with 0 errors. Fix the composition, never the rule: lengthen the beat, move the text in, make it bigger. Text that is purely ornamental (a giant background numeral, a watermark) can carry `data-reel-decorative`, which exempts it from the size, reading-time and contrast checks — not from the safe area.
7. **Render.** `node scripts/render.mjs comp.html --out out/comp.mp4`. Add music with `--audio music.mp3`, or declare tracks in `__reel.audio = [{ src, at, volume }]`. Render a slice with `--frames 120-180` while iterating.
8. **Watch the MP4 once, end to end.** The check reads text; it cannot tell that the pacing drags or that two scenes cut on the wrong beat.

## The composition contract

```html
<script src="../../kit/motion.js"></script>
<script>
  const { interpolate, spring, Easing } = Reel;
  window.__reel = {
    width: 1920, height: 1080, fps: 30, duration: 6,   // required
    audio: [{ src: "music.mp3", at: 0, volume: 0.8 }],  // optional
    seek(t, frame) {                                     // optional, may be async
      title.style.opacity = interpolate(t, [0.3, 0.8], [0, 1]);
      title.style.transform = `translateY(${(1 - spring(t, { delay: 0.3 })) * 60}px)`;
    },
  };
</script>
```

`<video>` elements are muted and seeked to each frame; `data-reel-start="2.5"` starts one 2.5s into the composition. Their sound is not captured: give it to `audio` as a separate track.

## Files

| File | Use it for |
|---|---|
| `kit/motion.js` | In the page. `interpolate`, `spring` (closed-form, so exact at any t), `Easing` (the CSS curves, plus `outExpo` and `inOutCubic`), `scene`, `stagger`, `typewriter`. |
| `kit/runtime.mjs` | The clock: what the renderer injects before the page runs. Read it to know exactly what is controlled. |
| `kit/chrome.mjs` | Headless Chrome over the DevTools protocol. Set `CHROME_PATH` to choose a browser. |
| `kit/checks.mjs` | The six checks as pure functions, and the report. |
| `scripts/check.mjs` | The CLI. Exits 1 on any error, 2 when there is no Chrome. `--json` for machines. |
| `scripts/render.mjs` | Frames → ffmpeg → MP4. `--still`, `--frames`, `--audio`, `--crf`, `--concurrency`. |
| `examples/title-card/` | The reference composition: CSS keyframes and a `seek()` in one page. Copy it. |
| `examples/broken/` | One defect per check, on purpose. The tests assert it keeps failing in exactly those ways. |
| `references/craft.md` | Formats, safe areas, type sizes, reading speed, pacing, easing, and what ffmpeg settings mean. |

## The six checks

| Check | Error means |
|---|---|
| `contract` | `window.__reel` is missing, a number is not positive, or a dimension is odd |
| `determinism` | a frame rendered a second time, in reverse order, came out different |
| `safe-area` | text that has settled sits outside the 5% title-safe margin (`--safe` changes it) |
| `font-size` | settled text under 2.2% of the short side — 24px on 1080p; under 3% is a warning |
| `reading-time` | a piece of text is readable for less time than it takes to read it |
| `contrast` | settled text against the pixels actually behind it, at their worst point, is under 4.5:1, or 3:1 for large text |

Text counts as **settled** once it is fully opaque, fully on screen and has stopped moving for 0.2s. Text in the middle of an entrance is allowed to be anywhere; text the viewer is meant to read is not.

## Rendering speed

Each frame is a real screenshot, so a render costs roughly a quarter of a second per 1080p frame per page, and `--concurrency` renders several pages at once — about 20 seconds for the 6-second example on four cores. Every page is a separate Chrome, so one cannot leak state into another's frames.

## Compared with Remotion and Revideo

Remotion (React) and Revideo (generators on a canvas) are the established ways to make video from code, and both are more capable: a timeline editor, a player component, cloud rendering. Use them for a product. This skill is for the case they are heavy for — an agent writing one video from a prompt, with nothing to install but Chrome and ffmpeg — and it borrows their best ideas: Remotion's `interpolate` and `spring`, and the rule that a frame must be a pure function of time. Remotion is source-available and larger companies need a paid license for it — check its current terms before building on it; this kit is MIT.
