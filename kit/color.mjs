// Color parsing and contrast. No dependencies.
//
// Two things live here and nothing else:
//   1. parse a CSS colour string into { r, g, b, a } with channels 0..255 and alpha 0..1
//   2. turn a pair of opaque colours into a WCAG 2.1 contrast ratio
//
// Alpha is kept, never silently dropped. Compositing happens in composite(), because a
// 60% white label over a dark surface is a real colour that the design system chose, and
// the audit has to measure the colour that actually reaches the eye.

const NAMED = {
  transparent: [0, 0, 0, 0],
  black: [0, 0, 0, 1],
  silver: [192, 192, 192, 1],
  gray: [128, 128, 128, 1],
  grey: [128, 128, 128, 1],
  white: [255, 255, 255, 1],
  maroon: [128, 0, 0, 1],
  red: [255, 0, 0, 1],
  purple: [128, 0, 128, 1],
  fuchsia: [255, 0, 255, 1],
  magenta: [255, 0, 255, 1],
  green: [0, 128, 0, 1],
  lime: [0, 255, 0, 1],
  olive: [128, 128, 0, 1],
  yellow: [255, 255, 0, 1],
  navy: [0, 0, 128, 1],
  blue: [0, 0, 255, 1],
  teal: [0, 128, 128, 1],
  aqua: [0, 255, 255, 1],
  cyan: [0, 255, 255, 1],
  orange: [255, 165, 0, 1],
  pink: [255, 192, 203, 1],
  brown: [165, 42, 42, 1],
  gold: [255, 215, 0, 1],
  indigo: [75, 0, 130, 1],
  violet: [238, 130, 238, 1],
  coral: [255, 127, 80, 1],
  salmon: [250, 128, 114, 1],
  crimson: [220, 20, 60, 1],
  tomato: [255, 99, 71, 1],
  khaki: [240, 230, 140, 1],
  lavender: [230, 230, 250, 1],
  beige: [245, 245, 220, 1],
  ivory: [255, 255, 240, 1],
  slategray: [112, 128, 144, 1],
  slategrey: [112, 128, 144, 1],
  dimgray: [105, 105, 105, 1],
  dimgrey: [105, 105, 105, 1],
  lightgray: [211, 211, 211, 1],
  lightgrey: [211, 211, 211, 1],
  darkgray: [169, 169, 169, 1],
  darkgrey: [169, 169, 169, 1],
  whitesmoke: [245, 245, 245, 1],
  steelblue: [70, 130, 180, 1],
  skyblue: [135, 206, 235, 1],
  royalblue: [65, 105, 225, 1],
  seagreen: [46, 139, 87, 1],
  forestgreen: [34, 139, 34, 1],
  springgreen: [0, 255, 127, 1],
  turquoise: [64, 224, 208, 1],
  midnightblue: [25, 25, 112, 1],
  rebeccapurple: [102, 51, 153, 1],
};

/** Clamp a number into a range. Used on every parsed channel so bad input degrades. */
export const clamp = (n, lo = 0, hi = 1) => (n < lo ? lo : n > hi ? hi : n);

/**
 * Parse one numeric CSS token. Handles plain numbers and percentages.
 * Returns a 0..1 fraction. `pct` says whether a bare number should be read as a percent.
 */
function number(token, pct = false) {
  const t = token.trim();
  if (t.endsWith("%")) return clamp(parseFloat(t) / 100);
  const n = parseFloat(t);
  if (!Number.isFinite(n)) return null;
  return pct ? clamp(n / 100) : n;
}

/** Build an {r,g,b,a} record from channels that are all expressed as 0..1 fractions. */
const rgba = (r, g, b, a = 1) => ({
  r: Math.round(clamp(r) * 255),
  g: Math.round(clamp(g) * 255),
  b: Math.round(clamp(b) * 255),
  a: clamp(a),
});

/**
 * HSL to linear-agnostic RGB fractions. s and l are 0..1, h is degrees.
 * Written as the plain six-branch form rather than the one-liner with
 * `min(k, 4-k, 1)`, because that one-liner is easy to get subtly wrong and
 * a wrong red is a wrong audit.
 */
function hueToRgb(h, s, l) {
  const hue = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const hp = hue / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r = 0;
  let g = 0;
  let b = 0;
  if (hp < 1) [r, g, b] = [c, x, 0];
  else if (hp < 2) [r, g, b] = [x, c, 0];
  else if (hp < 3) [r, g, b] = [0, c, x];
  else if (hp < 4) [r, g, b] = [0, x, c];
  else if (hp < 5) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const m = l - c / 2;
  return [r + m, g + m, b + m];
}

/**
 * Split the inside of a functional colour into tokens.
 *
 * Splits on top-level commas AND top-level whitespace AND the top-level slash,
 * so all three real syntaxes tokenise the same way:
 *   rgba(0, 0, 0, 0.5)   -> ["0", "0", "0", "0.5"]
 *   rgb(255 0 0 / 50%)   -> ["255", "0", "0", "/", "50%"]
 *   rgb(255, 0, 0, .5)   -> ["255", "0", "0", ".5"]
 *
 * Nested functions are respected, so rgb(calc(...)) does not split mid-value.
 * The slash is emitted as its own bare "/" token.
 */
function args(body) {
  const out = [];
  let depth = 0;
  let cur = "";
  const flush = () => {
    const t = cur.trim();
    if (t) out.push(t);
    cur = "";
  };
  for (const ch of body) {
    if (ch === "(") {
      depth++;
      cur += ch;
      continue;
    }
    if (ch === ")") {
      depth--;
      cur += ch;
      continue;
    }
    if (depth === 0 && ch === ",") {
      flush();
      continue;
    }
    if (depth === 0 && ch === "/") {
      flush();
      out.push("/");
      continue;
    }
    if (depth === 0 && /\s/.test(ch)) {
      flush();
      continue;
    }
    cur += ch;
  }
  flush();
  return out;
}

/**
 * Turn already-tokenised arguments into { head, alpha }.
 *
 * `args()` has already split on commas, whitespace and the top-level slash, so
 * a slash token marks where alpha begins. Legacy four-argument form
 * (rgb(r, g, b, a)) has no slash and is detected by arity instead.
 */
function alphaSplit(tokens) {
  let cut = tokens.findIndex((p) => p === "/");
  let head;
  let alpha = 1;

  if (cut !== -1) {
    head = tokens.slice(0, cut);
    const tail = tokens.slice(cut + 1).filter(Boolean);
    if (tail.length) {
      const a = number(tail[0], String(tail[0]).includes("%"));
      if (a !== null) alpha = a;
    }
  } else {
    head = tokens;
    if (head.length === 4) {
      const a = number(head[3], String(head[3]).includes("%"));
      if (a !== null) {
        alpha = a;
        head = head.slice(0, 3);
      }
    }
  }
  return { head, alpha };
}

/**
 * Parse a CSS colour string.
 *
 * Understands: #rgb, #rgba, #rrggbb, #rrggbbaa, rgb(), rgba(), hsl(), hsla(),
 * hwb(), lab(), lch(), oklab(), oklch(), and the 40 named colours this module
 * needs. Returns null for anything it cannot read, so callers can tell "no
 * colour here" apart from "black".
 */
export function parse(input) {
  if (typeof input !== "string") return null;
  const s = input.trim().toLowerCase();
  if (!s) return null;

  if (s === "currentcolor" || s === "inherit" || s === "initial" || s === "unset") return null;
  if (Object.hasOwn(NAMED, s)) {
    const [r, g, b, a] = NAMED[s];
    return { r, g, b, a };
  }

  if (s.startsWith("#")) {
    const h = s.slice(1);
    const rep = (c) => parseInt(c + c, 16);
    if (h.length === 3 || h.length === 4) {
      if (!/^[0-9a-f]+$/.test(h)) return null;
      return { r: rep(h[0]), g: rep(h[1]), b: rep(h[2]), a: h.length === 4 ? rep(h[3]) / 255 : 1 };
    }
    if (h.length === 6 || h.length === 8) {
      if (!/^[0-9a-f]+$/.test(h)) return null;
      return {
        r: parseInt(h.slice(0, 2), 16),
        g: parseInt(h.slice(2, 4), 16),
        b: parseInt(h.slice(4, 6), 16),
        a: h.length === 8 ? parseInt(h.slice(6, 8), 16) / 255 : 1,
      };
    }
    return null;
  }

  const fn = /^([a-z-]+)\(([\s\S]*)\)$/.exec(s);
  if (!fn) return null;
  const name = fn[1];
  const { head, alpha } = alphaSplit(args(fn[2]));

  if (name === "rgb" || name === "rgba") {
    if (head.length < 3) return null;
    const [r, g, b] = head.slice(0, 3).map((t) => number(t, String(t).includes("%")));
    if (r === null || g === null || b === null) return null;
    return rgba(r, g, b, alpha);
  }

  if (name === "hsl" || name === "hsla") {
    if (head.length < 3) return null;
    const hRaw = parseFloat(head[0]);
    const h = Number.isFinite(hRaw) ? hRaw : 0;
    const s = number(head[1], true) ?? 0;
    const l = number(head[2], true) ?? 0;
    const [r, g, b] = hueToRgb(h, s, l);
    return rgba(r, g, b, alpha);
  }

  if (name === "hwb") {
    if (head.length < 3) return null;
    const hRaw = parseFloat(head[0]);
    const h = Number.isFinite(hRaw) ? hRaw : 0;
    const w = number(head[1], true) ?? 0;
    const bl = number(head[2], true) ?? 0;
    // Whitening and blackening a pure hue.
    let [r, g, b] = hueToRgb(h, 1, 0.5);
    r = r * (1 - w) + w;
    g = g * (1 - w) + w;
    b = b * (1 - w) + w;
    r = r * (1 - bl);
    g = g * (1 - bl);
    b = b * (1 - bl);
    return rgba(r, g, b, alpha);
  }

  // lab/lch/oklab/oklch: convert to sRGB through the matrices, then gamma-encode.
  if (name === "lab" || name === "oklab" || name === "lch" || name === "oklch") {
    // Cartesian forms: L, a, b. Polar forms: L, C, H — the hue is head[2],
    // not head[3]. Getting this wrong silently produces a wildly out-of-gamut
    // colour, so the two shapes are handled separately and on purpose.
    const L = number(head[0], String(head[0]).includes("%")) ?? 0;
    const chromaOrA = number(head[1]) ?? 0;
    let r = 0;
    let g = 0;
    let b = 0;

    const polarToCartesian = (c, h) => {
      const rad = (h * Math.PI) / 180;
      return { A: c * Math.cos(rad), B: c * Math.sin(rad) };
    };

    if (name === "oklab") {
      const { A, B } = { A: chromaOrA, B: number(head[2]) ?? 0 };
      const l_ = L + 0.3963377774 * A + 0.2158037573 * B;
      const m_ = L - 0.1055613458 * A - 0.0638541728 * B;
      const s_ = L - 0.0894841775 * A - 1.291485548 * B;
      const l = l_ * l_ * l_;
      const m = m_ * m_ * m_;
      const s = s_ * s_ * s_;
      // CSS Color 4 sample code, forward oklab -> linear sRGB.
      r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
      g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
      b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
    } else if (name === "oklch") {
      const { A, B } = polarToCartesian(chromaOrA, parseFloat(head[2]) || 0);
      const l_ = L + 0.3963377774 * A + 0.2158037573 * B;
      const m_ = L - 0.1055613458 * A - 0.0638541728 * B;
      const s_ = L - 0.0894841775 * A - 1.291485548 * B;
      const l = l_ * l_ * l_;
      const m = m_ * m_ * m_;
      const s = s_ * s_ * s_;
      r = 4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s;
      g = -1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s;
      b = -0.0041960863 * l - 0.7034186147 * m + 1.707614701 * s;
    // lab() and lch() use the D50 white point and the Bradford-adapted matrix,
    // per CSS Color 4. Using the D65 constants instead is a small but real
    // error: it turns pure red into rgb(255, 5, 0), which then misreports
    // contrast by a few hundredths.
    } else if (name === "lab") {
      const { A, B } = { A: chromaOrA, B: number(head[2]) ?? 0 };
      const fy = (L * 100 + 16) / 116;
      const fx = fy + A / 500;
      const fz = fy - B / 200;
      const finv = (t) => (t > 6 / 29 ? t * t * t : 3 * (6 / 29) ** 2 * (t - 4 / 29));
      const x = finv(fx) * 0.3457 / 0.3585;
      const y = finv(fy);
      const z = finv(fz) * 0.2958 / 0.3585;
      r = 3.1338561 * x - 1.6168667 * y - 0.4906146 * z;
      g = -0.9787684 * x + 1.9161415 * y + 0.033454 * z;
      b = 0.0719453 * x - 0.2289914 * y + 1.4052427 * z;
    } else {
      // lch
      const { A, B } = polarToCartesian(chromaOrA, parseFloat(head[2]) || 0);
      const fy = (L * 100 + 16) / 116;
      const fx = fy + A / 500;
      const fz = fy - B / 200;
      const finv = (t) => (t > 6 / 29 ? t * t * t : 3 * (6 / 29) ** 2 * (t - 4 / 29));
      const x = finv(fx) * 0.3457 / 0.3585;
      const y = finv(fy);
      const z = finv(fz) * 0.2958 / 0.3585;
      r = 3.1338561 * x - 1.6168667 * y - 0.4906146 * z;
      g = -0.9787684 * x + 1.9161415 * y + 0.033454 * z;
      b = 0.0719453 * x - 0.2289914 * y + 1.4052427 * z;
    }

    // The matrices output linear sRGB. Out-of-gamut results are clipped, which
    // is what a browser does, then gamma-encoded back into sRGB.
    const enc = (v) => {
      const c = clamp(v, 0, 1);
      return c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    };
    return rgba(enc(r), enc(g), enc(b), alpha);
  }

  return null;
}

/**
 * Composite a possibly translucent colour over an opaque backdrop.
 * `over` must be opaque. This is source-over alpha, done in gamma space, which
 * matches how browsers composite ordinary non-linear sRGB.
 */
export function composite(fg, bg) {
  if (!fg) return null;
  if (fg.a >= 1) return { ...fg, a: 1 };
  const a = fg.a;
  return {
    r: Math.round(fg.r * a + bg.r * (1 - a)),
    g: Math.round(fg.g * a + bg.g * (1 - a)),
    b: Math.round(fg.b * a + bg.b * (1 - a)),
    a: 1,
  };
}

/** Un-premultiply the alpha: what this colour looks like if drawn on white. */
export function flattenOnWhite(c) {
  return c ? composite(c, { r: 255, g: 255, b: 255, a: 1 }) : null;
}

/** Relative luminance, WCAG 2.1 definition. Input should be opaque. */
export function luminance({ r, g, b }) {
  const lin = (v) => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/** WCAG 2.1 contrast ratio, 1..21. Both colours should already be opaque. */
export function contrast(a, b) {
  if (!a || !b) return null;
  const la = luminance(a);
  const lb = luminance(b);
  const hi = Math.max(la, lb);
  const lo = Math.min(la, lb);
  return (hi + 0.05) / (lo + 0.05);
}

/** Hex string for a colour, for reporting. */
export function toHex({ r, g, b }) {
  const h = (n) => n.toString(16).padStart(2, "0");
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * The WCAG level a ratio meets for a given text size.
 * `size` is in px, `bold` matches `font-weight: 700` or heavier, `disabled`
 * exempts the element (WCAG 1.4.3 exempts inactive controls).
 */
export function wcagLevel(ratio, { size = 14, bold = false, disabled = false } = {}) {
  if (disabled) return "exempt";
  const large = size >= 24 || (bold && size >= 18.66);
  const aa = large ? 3 : 4.5;
  const aaa = large ? 4.5 : 7;
  if (ratio >= aaa) return "AAA";
  if (ratio >= aa) return "AA";
  if (ratio >= 3) return "AA-large";
  return "fail";
}

/**
 * Relative luminance difference, used for the colour-blind and
 * colour-only-depends-on-text checks. Pairs that differ in luminance but not
 * in hue read the same to a protanope; see also hueDistance below.
 */
export function luminanceOnly(a, b) {
  const la = luminance(a);
  const lb = luminance(b);
  return Math.abs(la - lb);
}

/**
 * Angle between two hues in degrees, 0..180. Zero means the same hue, so the
 * pair is distinguished only by lightness, which a monochrome or colour-blind
 * rendering collapses.
 */
export function hueDistance(a, b) {
  const hue = ({ r, g, b }) => {
    const max = Math.max(r, g, b);
    const min = Math.min(r, g, b);
    const d = max - min;
    if (d === 0) return null;
    let h;
    if (max === r) h = ((g - b) / d) % 6;
    else if (max === g) h = (b - r) / d + 2;
    else h = (r - g) / d + 4;
    return ((h * 60) % 360 + 360) % 360;
  };
  const ha = hue(a);
  const hb = hue(b);
  if (ha === null || hb === null) return null;
  const d = Math.abs(ha - hb);
  return d > 180 ? 360 - d : d;
}

/**
 * Which side of a border a readable label should go. Used by the audit when a
 * control has a floating label that must sit on the fill, not on the page.
 */
export function betterOn(bg, candidates) {
  let best = null;
  for (const c of candidates) {
    const ratio = contrast(bg, c);
    if (best === null || ratio > best.ratio) best = { color: c, ratio };
  }
  return best;
}
