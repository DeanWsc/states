# Craft

The numbers behind the checks, and the judgement calls the checks cannot make.

## Formats

| Where it plays | Size | Notes |
|---|---|---|
| YouTube, a website, a presentation | 1920×1080 (16:9) | 3840×2160 only if the source material is that sharp; it renders four times slower. |
| Reels, TikTok, Shorts, Stories | 1080×1920 (9:16) | Keep text out of the bottom ~20% and the right ~14%: captions, names and buttons sit there. `check.mjs` warns. |
| Feed post | 1080×1080 or 1080×1350 | 4:5 takes more of a phone screen than a square. |

Frame rate: **30** by default. **24** for a filmic feel or when cutting with film footage, **25** for European broadcast, **60** for screen recordings and fast UI where 30 judders. Do not mix.

Length: short-form loses most viewers in the first 3 seconds, so the subject goes on screen in the first second, not after a logo.

## Safe areas

Television and some players crop the edge of the picture. **Title safe** is the inner 90% — 5% in from every side — and everything a viewer must read belongs inside it. Backgrounds, images and motion can and should run to the edge; only text and logos stay in.

## Type

The video will be watched on a phone more often than on anything else, and on a phone a 1080p frame is about 390 points wide. So:

| Short side | Minimum (error) | Comfortable | Headline |
|---|---|---|---|
| 1080 | 24px | 32px+ | 72–140px |
| 720 | 16px | 22px+ | 48–96px |

Captions over footage need a backing: a shadow (`text-shadow: 0 2px 12px rgb(0 0 0 / 0.6)`), a translucent bar, or a darkened lower third. The contrast check reads the actual pixels behind the text, at their worst point, so a white caption that is fine over a dark sky and invisible over a bright one fails.

Use `font-variant-numeric: tabular-nums` on any number that changes, or the digits shuffle sideways as they count.

Fonts must be installed or loaded with `@font-face` from a file next to the composition; the renderer waits for `document.fonts.ready`, so a font that never loads is a font that silently falls back. For Chinese, Japanese and Korean, name a CJK font in the stack.

## Reading time

Subtitle practice, which `check.mjs` enforces:

- about **17 characters per second** for alphabetic text,
- about **9 characters per second** for Chinese and Japanese,
- and **0.8 seconds minimum** for anything at all, even one word.

That is the time the text must be fully *readable* — at least 60% opaque and mostly on screen — not the time from the start of its entrance to the end of its exit. A two-line caption of 60 characters needs 3.5 seconds.

## Motion

- **Ease out for entrances, ease in for exits.** Things arrive fast and settle (`Easing.outExpo`, or a `spring`), and leave by accelerating away (`Easing.in`). Linear motion looks mechanical except for continuous drift.
- **Entrances: 0.3–0.6s. Exits: shorter than entrances.** A viewer waits for an entrance and does not wait for an exit.
- **Stagger related items by 60–120ms** (`stagger(i, 0.08)`). Everything at once reads as a cut; too slow reads as a loading bar.
- **One thing moves at a time** where the viewer has to read. Motion pulls the eye; reading needs it to stay put.
- **Springs**: `stiffness: 170, damping: 26` settles without bounce. Lower damping (12–18) gives a bounce, which suits playful content and not much else.
- **Cut on the beat** when there is music: put scene boundaries at the music's bar lines, which at 120 bpm fall every 2 seconds.

## Determinism

The renderer moves the page to each frame's time; it does not play it. So:

- Animate from `t`, never from "how many times have I been called". `x += 2` per frame is wrong; `x = 2 * frame` is right.
- Offset CSS animations with `animation-delay`. Adding a class from `setTimeout` starts a transition at a moment the renderer does not control.
- Load everything up front. An image that arrives during the render appears on some frames and not others.
- `Math.random()` is seeded per frame, so noise is stable on re-renders but changes every frame. For noise that should hold still, seed your own generator from a constant.

`check.mjs` renders a set of frames a second time in reverse order and compares the pixels, which catches all of the above.

## Encoding

`render.mjs` writes H.264 in `yuv420p` with `+faststart`: the one combination that plays everywhere, including in a browser while it downloads. `--crf 18` is visually lossless; 23 is ffmpeg's default and fine for previews; each +6 roughly halves the file. Audio is AAC at 192 kb/s, cut to the picture's length.

`yuv420p` stores colour at half resolution, so thin saturated lines — 1px red on blue — smear. Make fine coloured detail at least 2px.
