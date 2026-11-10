// Motion helpers for compositions. A classic script, so it works from file://:
//
//   <script src="../../kit/motion.js"></script>
//   const { interpolate, spring, Easing, scene } = Reel;
//
// Every function here is a pure function of time. Nothing accumulates between
// frames, so frame 90 is the same whether it is rendered first or last.
(function (root) {
  "use strict";

  const clamp01 = (x) => Math.min(1, Math.max(0, x));

  const bezier = (x1, y1, x2, y2) => {
    // Solve x(s) = x for s with Newton, then return y(s). Same curve as CSS.
    const a = (p1, p2) => 1 - 3 * p2 + 3 * p1, b = (p1, p2) => 3 * p2 - 6 * p1, c = (p1) => 3 * p1;
    const at = (s, p1, p2) => ((a(p1, p2) * s + b(p1, p2)) * s + c(p1)) * s;
    const slope = (s, p1, p2) => 3 * a(p1, p2) * s * s + 2 * b(p1, p2) * s + c(p1);
    return (x) => {
      if (x <= 0) return 0;
      if (x >= 1) return 1;
      let s = x;
      for (let i = 0; i < 8; i++) {
        const d = slope(s, x1, x2);
        if (Math.abs(d) < 1e-6) break;
        s -= (at(s, x1, x2) - x) / d;
      }
      let lo = 0, hi = 1;
      for (let i = 0; i < 20 && Math.abs(at(s, x1, x2) - x) > 1e-6; i++) {
        if (at(s, x1, x2) < x) lo = s; else hi = s;
        s = (lo + hi) / 2;
      }
      return at(s, y1, y2);
    };
  };

  const Easing = {
    linear: (x) => x,
    ease: bezier(0.25, 0.1, 0.25, 1),
    in: bezier(0.42, 0, 1, 1),
    out: bezier(0, 0, 0.58, 1),
    inOut: bezier(0.42, 0, 0.58, 1),
    // The two curves most motion design actually uses.
    outExpo: (x) => (x >= 1 ? 1 : 1 - Math.pow(2, -10 * x)),
    inOutCubic: (x) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2),
    bezier,
  };

  /**
   * Map t from an input range to an output range, like Remotion's interpolate.
   *   interpolate(t, [0, 1], [0, 100])
   *   interpolate(t, [0, 0.5, 1], [0, 1, 0], { easing: Easing.inOut })
   * Clamps at both ends unless { clamp: false }.
   */
  function interpolate(t, input, output, { easing = Easing.linear, clamp = true } = {}) {
    if (input.length !== output.length || input.length < 2) throw new Error("interpolate needs two ranges of the same length, at least 2 long");
    for (let i = 1; i < input.length; i++) if (!(input[i] > input[i - 1])) throw new Error("interpolate input must be strictly increasing");
    let i = 1;
    while (i < input.length - 1 && t > input[i]) i++;
    const [x0, x1, y0, y1] = [input[i - 1], input[i], output[i - 1], output[i]];
    let p = (t - x0) / (x1 - x0);
    if (clamp) p = clamp01(p);
    return y0 + (y1 - y0) * easing(p);
  }

  /**
   * A damped spring from 0 to 1, started at `delay` seconds. Solved in closed
   * form, so it is exact at any t and costs nothing to evaluate out of order.
   */
  function spring(t, { delay = 0, stiffness = 170, damping = 26, mass = 1, from = 0, to = 1 } = {}) {
    const s = t - delay;
    if (s <= 0) return from;
    const w0 = Math.sqrt(stiffness / mass);
    const zeta = damping / (2 * Math.sqrt(stiffness * mass));
    let x; // displacement from rest, starting at -1 with zero velocity
    if (zeta < 1) {
      const wd = w0 * Math.sqrt(1 - zeta * zeta);
      x = -Math.exp(-zeta * w0 * s) * (Math.cos(wd * s) + ((zeta * w0) / wd) * Math.sin(wd * s));
    } else if (zeta === 1) {
      x = -Math.exp(-w0 * s) * (1 + w0 * s);
    } else {
      const r1 = -w0 * (zeta - Math.sqrt(zeta * zeta - 1));
      const r2 = -w0 * (zeta + Math.sqrt(zeta * zeta - 1));
      const c2 = r1 / (r2 - r1), c1 = -1 - c2;
      x = c1 * Math.exp(r1 * s) + c2 * Math.exp(r2 * s);
    }
    return from + (to - from) * (1 + x);
  }

  /**
   * Where t is inside a scene that starts at `start` and lasts `duration`:
   *   { active, local, progress } — local in seconds, progress 0..1.
   */
  function scene(t, start, duration) {
    const local = t - start;
    return { active: local >= 0 && local < duration, local, progress: clamp01(local / duration) };
  }

  /** The delay for item i of a staggered entrance. */
  const stagger = (i, step = 0.08, start = 0) => start + i * step;

  /** Characters revealed by t for a typewriter effect, at `cps` characters a second. */
  const typewriter = (text, t, { start = 0, cps = 18 } = {}) =>
    Array.from(text).slice(0, Math.max(0, Math.floor((t - start) * cps))).join("");

  root.Reel = { interpolate, spring, Easing, scene, stagger, typewriter, clamp01 };
})(typeof window !== "undefined" ? window : globalThis);
