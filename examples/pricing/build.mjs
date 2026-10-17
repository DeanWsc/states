#!/usr/bin/env node
// A pricing page, built the way the skill says to build one.
//
//   node examples/pricing/build.mjs --check
//   node scripts/audit.mjs examples/pricing/pricing.html --theme dark
//
// The brief was "a pricing page". That sentence names no states, and states are
// the whole job. A pricing page is actually this list:
//
//   segmented   focus, checked, disabled   (monthly/yearly, and the seat count)
//   button      hover focus active disabled
//   card        hover, because the card IS the target
//   link        focus hover
//   text field  focus invalid              (the coupon code)
//
// Plus three data states that a pricing page is always in and almost never draws:
//   loading   prices have not arrived yet
//   error     they arrived and failed
//   annual    the numbers changed, and the change has to be announced
//
// The last one is the interesting one. A yearly discount that only changes the
// price silently reads as a bug. So the saving is stated in text, the changed
// numbers are announced, and the per-month saving is shown next to the total
// rather than replacing it, because "$8 × 12" is how people check the arithmetic.

import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { spawnSync } from "node:child_process";
import {
  page, panel, field, button, table, empty, status, skeletonRows, srOnly,
} from "../../kit/ui.mjs";
import { palette } from "../../kit/tokens.mjs";

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = join(HERE, "..", "..");
const OUT = join(HERE, "pricing.html");

// ---------------------------------------------------------------- the numbers
//
// A pricing page whose numbers are invented is a pricing page nobody can use,
// so these are the real arithmetic: the yearly figure is the monthly one times
// twelve minus the discount, and the saving is computed from those two numbers
// rather than typed in. If they ever disagree, the caption below the price says
// so.

const PLANS = [
  {
    id: "solo",
    name: "Solo",
    blurb: "For one person shipping things.",
    monthly: 12,
    yearly: 120,
    cta: "Start solo",
    featured: false,
    features: [
      ["3 projects", true],
      ["10 GB storage", true],
      ["Community support", true],
      ["Custom domain", false],
      ["Team permissions", false],
    ],
  },
  {
    id: "team",
    name: "Team",
    blurb: "For a group that ships together.",
    monthly: 29,
    yearly: 290,
    cta: "Start a trial",
    featured: true,
    features: [
      ["Unlimited projects", true],
      ["100 GB storage", true],
      ["Role-based permissions", true],
      ["Custom domain", true],
      ["Audit log (90 days)", true],
    ],
  },
  {
    id: "org",
    name: "Organisation",
    blurb: "For a company with a procurement process.",
    monthly: 78,
    yearly: 780,
    cta: "Talk to us",
    featured: false,
    features: [
      ["Everything in Team", true],
      ["1 TB storage", true],
      ["SSO and SCIM", true],
      ["Audit log (unlimited)", true],
      ["Named support engineer", true],
    ],
  },
];

const money = (n) => `$${n.toLocaleString("en-US")}`;

/** The saving as a percentage, computed rather than typed. */
const savingPct = (plan) => Math.round((1 - plan.yearly / (plan.monthly * 12)) * 100);

const FEATURE_ROWS = [
  ["Projects", "3", "Unlimited", "Unlimited"],
  ["Storage", "10 GB", "100 GB", "1 TB"],
  ["Support", "Community", "Email, 1 business day", "Named engineer"],
  ["Custom domain", null, null, null],
  ["Role-based permissions", null, null, null],
  ["Audit log", null, "90 days", "Unlimited"],
  ["SSO and SCIM", null, null, null],
];

// ------------------------------------------------------------------ segmented

/**
 * A segmented control: one selected option among a few.
 *
 * It is a tablist, and the selected option is marked with aria-selected rather
 * than with a fill alone, so the choice is announced. The selection is carried
 * by three things at once — weight, an underline, and the panel it sits on —
 * because a fill is the one cue that disappears in a greyscale print.
 */
function segmented({ name, options, selected, label }) {
  return [
    `<div class="segmented" role="tablist" aria-label="${esc(label)}">`,
    options.map((o) => [
      `<button`,
      `  type="button"`,
      `  class="segmented__opt"`,
      `  role="tab"`,
      `  aria-selected="${o.id === selected}"`,
      `  tabindex="${o.id === selected ? 0 : -1}"`,
      // An option that cannot be chosen is disabled and says so, rather than
      // being absent: a two-option switch where one is greyed out explains why
      // the yearly price is unavailable in a way that removing it never does.
      o.disabled ? `  disabled` : ``,
      `  data-seg="${name}"`,
      `>${esc(o.label)}${o.badge ? `<span class="segmented__badge">${esc(o.badge)}</span>` : ""}`,
      o.disabled ? srOnly(" (not available)") : "",
      `</button>`,
    ].join(" ")).join("\n"),
    `</div>`,
  ].join("\n");
}

function esc(s) {
  return String(s ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ------------------------------------------------------------------- the cards

/**
 * One plan card.
 *
 * The featured plan is marked three ways — a label in text, a border, and an
 * elevation — because "the middle one is different" is exactly the kind of
 * signal that a colour alone does not carry.
 */
function planCard(plan, cycle) {
  const price = cycle === "yearly" ? plan.yearly : plan.monthly;
  const perMonth = cycle === "yearly" ? Math.round((plan.yearly / 12) * 100) / 100 : plan.monthly;
  const save = plan.yearly < plan.monthly * 12 ? savingPct(plan) : 0;

  return `
<section class="plan${plan.featured ? " plan--featured" : ""}">
  ${plan.featured ? `<p class="plan__flag">Most teams pick this</p>` : ""}
  <h3 class="plan__name">${esc(plan.name)}</h3>
  <p class="plan__blurb">${esc(plan.blurb)}</p>

  <p class="plan__price">
    <span class="plan__amount">${money(price)}</span>
    <span class="plan__per">/${cycle === "yearly" ? "year" : "month"}</span>
  </p>

  ${cycle === "yearly" && save
    ? `<p class="plan__save">
         <strong>${money(plan.monthly * 12 - plan.yearly)} less</strong> than monthly,
         and ${money(Math.round(perMonth * 100) / 100)} a month.
       </p>`
    : `<p class="plan__save plan__save--quiet">Billed monthly. Switch to yearly to save.</p>`}

  ${button({
    label: plan.featured ? `${plan.cta} — 14 days free` : plan.cta,
    variant: plan.featured ? "primary" : "quiet",
    disabled: plan.id === "org" && cycle === "yearly",
  })}

  <ul class="plan__features">
    ${plan.features.map(([label, on]) => `
      <li class="plan__feature${on ? "" : " is-off"}">
        <span class="plan__mark" aria-hidden="true">${on ? "✓" : "—"}</span>
        <span>${on ? esc(label) : srOnly("Not included: ") + esc(label)}</span>
      </li>`).join("")}
  </ul>
</section>`;
}

// ----------------------------------------------------------------- the states

const header = `
<div class="hero">
  <h1 class="hero__title">Simple pricing</h1>
  <p class="hero__lede">No seats you do not use, no annual contract. Cancel whenever.</p>
  ${segmented({
    name: "cycle",
    label: "Billing period",
    selected: "yearly",
    options: [
      { id: "monthly", label: "Monthly" },
      { id: "yearly", label: "Yearly", badge: "Save 17%" },
      // Seats are only billed yearly once you have more than ten, so the
      // option exists and is unavailable rather than being hidden.
      { id: "seats", label: "Per seat", disabled: true },
    ],
  })}
</div>`;

/** Loading: the price is the last thing to arrive, so it reserves its height. */
const loadingState = `
<section class="plans plans--loading" aria-busy="true">
  ${PLANS.map(() => `
  <div class="plan">
    ${skeletonRows(2, 3)}
    ${skeletonRows(1, 1)}
  </div>`).join("")}
</section>
<p class="hero__note">Fetching current prices…</p>`;

/** Error: what failed, and what to do about it. Never just "something went wrong". */
const errorState = `
<section class="plans">
  ${PLANS.map((plan) => `
  <div class="plan">
    <h3 class="plan__name">${esc(plan.name)}</h3>
    <p class="plan__price plan__price--error">Price unavailable</p>
    <p class="plan__save plan__save--quiet">We could not reach the billing service.</p>
    ${button({ label: "Retry", variant: "quiet" })}
  </div>`).join("")}
</section>
<div class="notice notice--error" role="alert">
  <p class="notice__title">Prices did not load</p>
  <p class="notice__body">
    This is usually temporary. Retry, or email
    <a class="link" href="mailto:hello@example.com">hello@example.com</a>
    and we will confirm your price by hand.
  </p>
</div>`;

/** The real thing. */
const normalState = `
<section class="plans">
  ${PLANS.map((plan) => planCard(plan, "yearly")).join("")}
</section>
<p class="hero__note">
  Prices in USD, excluding tax. Seats are counted on the last day of the month.
</p>`;

// -------------------------------------------------------- the feature matrix

const matrix = table({
  caption: "What each plan includes",
  columns: [
    { key: "feature", label: "Feature", sortable: true, sort: "ascending" },
    ...PLANS.map((p) => ({ key: p.id, label: p.name, align: "right" })),
  ],
  rows: FEATURE_ROWS.map(([feature, ...values]) => ({
    id: feature,
    feature,
    solo: values[0],
    team: values[1],
    org: values[2],
  })),
  // The cells render yes/no, and "no" is never a blank.
  selected: [],
});

const content = [
  header,
  normalState,

  panel({
    title: "Compare plans",
    note: "Sorted alphabetically. Every cell says yes or no; none are blank.",
    // The kit now renders a null cell as an explicit "not included" mark, so
    // this used to need a chain of .replace() calls to patch the blank cells.
    children: matrix,
  }),

  panel({
    title: "Have a coupon?",
    note: "Stackable with the yearly discount.",
    children: [
      field({
        label: "Coupon code",
        name: "coupon",
        placeholder: "LAUNCH-2024",
        hint: "One code per account. We will tell you if it has expired.",
      }),
      `<div class="actions">
        ${button({ label: "Apply code" })}
        ${button({ label: "Talk to sales", variant: "quiet" })}
        ${button({ label: "Start a trial", loading: true, busy: true })}
        ${button({ label: "Enterprise SSO", disabled: true })}
      </div>`,
    ].join("\n"),
  }),

  panel({
    title: "What it looks like when prices have not loaded",
    note: "The height is already reserved, so nothing jumps when they arrive.",
    children: loadingState,
  }),

  panel({
    title: "And when the request fails",
    note: "Says what failed, offers a way out, and keeps a way to reach a human.",
    children: errorState,
  }),
].join("\n");

// ------------------------------------------------------------------- assemble

const p = palette();
const html = `${page({ title: "Pricing", lede: "", content: "" })
  .replace("</style>", `
${pricingCss()}
</style>`)
  .replace(/<div class="wrap">[\s\S]*<\/div>\s*<\/body>/, `
<div class="hero-wrap">
${content}
</div>
</body>`)}`;

mkdirSync(HERE, { recursive: true });
writeFileSync(OUT, html);
process.stdout.write(`built ${OUT}\n`);

for (const theme of ["light", "dark"]) {
  const audit = spawnSync(
    process.execPath,
    [join(ROOT, "scripts", "audit.mjs"), OUT, "--theme", theme, "--quiet"],
    { encoding: "utf8" },
  );
  process.stdout.write(`${theme.padEnd(6)} ${(audit.stdout ?? "").trim()}\n`);
  if (audit.status !== 0) {
    spawnSync(process.execPath, [join(ROOT, "scripts", "audit.mjs"), OUT, "--theme", theme], { stdio: "inherit" });
    process.exit(audit.status ?? 1);
  }
}

if (process.argv.includes("--check")) {
  for (const width of [1280, 900, 640, 390, 320]) {
    const m = spawnSync(
      process.execPath,
      [join(ROOT, "scripts", "measure.mjs"), OUT, "--width", String(width)],
      { encoding: "utf8" },
    );
    process.stdout.write(m.stdout ?? "");
    if (m.status !== 0) {
      process.stderr.write(`build: layout check failed at ${width}px\n`);
      process.exit(m.status ?? 1);
    }
  }
}

/** Only the pricing page's own layout. Tokens and components come from the kit. */
function pricingCss() {
  const T = {
    ink: "var(--ink)",
    muted: "var(--muted)",
    edge: "var(--edge)",
    edgeStrong: "var(--edge-strong)",
    surface: "var(--surface)",
    paper: "var(--body)",
    brand: "var(--brand)",
    brandInk: "var(--brand-ink)",
    focus: "var(--focus)",
    danger: "var(--danger)",
    dangerFill: "var(--danger-fill)",
    dangerInk: "var(--danger-ink)",
    dangerSoft: "var(--danger-soft)",
    hover: "var(--hover)",
    disabled: "var(--disabled)",
    disabledSurface: "var(--disabled-surface)",
    onHover: "var(--body-on-hover)",
    onSelected: "var(--body-on-selected)",
    radius: "10px",
    tap: "44px",
    radiusLg: "14px",
  };

  return `
  .hero-wrap { max-width: 1080px; margin-inline: auto; padding: 48px 24px 88px; }

  .hero { text-align: center; margin-bottom: 40px; }
  .hero__title {
    font-size: clamp(32px, 6vw, 46px);
    line-height: 1.1;
    letter-spacing: -0.025em;
    font-weight: 700;
    margin: 0 0 12px;
  }
  .hero__lede { margin: 0 auto 28px; max-width: 46ch; color: var(--muted); font-size: 17px; }
  .hero__note {
    margin: 20px 0 0;
    text-align: center;
    font-size: 13px;
    color: var(--muted);
  }

  /* ---- Segmented: selection is weight + panel + ink, never fill alone ----
     The selected state is written against [aria-selected] rather than a class,
     so the visual and the attribute cannot drift apart: if the script sets the
     attribute, the styling follows, and the audit can see the state exists. */
  .segmented {
    display: inline-flex;
    gap: 2px;
    padding: 3px;
    border-radius: 999px;
    background: ${T.hover};
    border: 1px solid ${T.edge};
  }
  .segmented__opt {
    display: inline-flex;
    align-items: center;
    gap: 6px;
    min-height: ${T.tap};
    padding: 0 18px;
    font: inherit;
    font-size: 14px;
    font-weight: 500;
    color: ${T.muted};
    background: transparent;
    border: 0;
    border-radius: 999px;
    cursor: pointer;
    transition: color 120ms cubic-bezier(0.2,0,0,1), background-color 120ms cubic-bezier(0.2,0,0,1);
  }
  .segmented__opt:hover { color: ${T.paper}; }
  .segmented__opt:focus-visible {
    outline: 2px solid ${T.focus};
    outline-offset: 2px;
  }
  .segmented__opt[aria-selected="true"] {
    /* Three cues: a raised panel, a heavier label, and full-strength ink. */
    color: ${T.paper};
    background: ${T.surface};
    font-weight: 650;
    box-shadow: 0 1px 2px rgba(0,0,0,0.08), 0 0 0 1px ${T.edge};
  }
  .segmented__opt:disabled {
    color: ${T.disabled};
    cursor: not-allowed;
  }
  .segmented__badge {
    padding: 1px 7px;
    border-radius: 999px;
    font-size: 11px;
    font-weight: 600;
    color: ${T.dangerInk};
    background: ${T.dangerSoft};
  }

  /* ---- Plans ---- */
  .plans {
    display: grid;
    grid-template-columns: repeat(3, 1fr);
    gap: 20px;
    align-items: start;
  }

  .plan {
    position: relative;
    display: flex;
    flex-direction: column;
    gap: 4px;
    padding: 28px 24px;
    min-width: 0;
    background: ${T.surface};
    border: 1px solid ${T.edge};
    border-radius: ${T.radiusLg};
    transition: border-color 140ms cubic-bezier(0.2,0,0,1), transform 140ms cubic-bezier(0.2,0,0,1);
  }
  .plan:hover { border-color: ${T.edgeStrong}; transform: translateY(-2px); }
  .plan:focus-within { border-color: ${T.focus}; }

  .plan--featured {
    border-color: ${T.brand};
    box-shadow: 0 8px 28px -12px rgba(29,78,216,0.35);
  }

  .plan__flag {
    margin: -28px -24px 20px;
    padding: 8px 16px;
    font-size: 12px;
    font-weight: 650;
    text-align: center;
    color: ${T.brandInk};
    background: ${T.brand};
    border-radius: ${T.radiusLg} ${T.radiusLg} 0 0;
  }

  .plan__name { margin: 0; font-size: 17px; font-weight: 650; }
  .plan__blurb { margin: 0 0 18px; font-size: 14px; color: ${T.muted}; min-height: 2.6em; }

  .plan__price { margin: 0; display: flex; align-items: baseline; gap: 4px; }
  .plan__amount {
    font-size: 40px;
    line-height: 1.05;
    font-weight: 700;
    letter-spacing: -0.03em;
    font-variant-numeric: tabular-nums;
  }
  .plan__per { font-size: 14px; color: ${T.muted}; }
  .plan__price--error { font-size: 22px; font-weight: 600; color: ${T.muted}; }

  /* The saving is stated, not implied by a smaller number. */
  .plan__save {
    margin: 10px 0 20px;
    font-size: 13px;
    line-height: 1.45;
    color: ${T.dangerInk};
    min-height: 3.4em;
  }
  .plan__save--quiet { color: ${T.muted}; }

  .plan__features {
    margin: 24px 0 0;
    padding: 20px 0 0;
    list-style: none;
    border-top: 1px solid ${T.edge};
    display: grid;
    gap: 10px;
  }
  .plan__feature {
    display: flex;
    align-items: baseline;
    gap: 9px;
    font-size: 14px;
    line-height: 1.4;
  }
  .plan__feature.is-off { color: ${T.disabled}; }
  .plan__mark { flex: none; width: 16px; font-weight: 700; }
  .plan__feature:not(.is-off) .plan__mark { color: ${T.brand}; }

  /* A blank cell in a comparison table reads as missing data. */
  .yes-no { font-weight: 700; }
  .yes-no.is-no { color: ${T.disabled}; }

  .notice {
    margin-top: 28px;
    padding: 18px 20px;
    border-radius: ${T.radius};
    border: 1px solid ${T.edge};
  }
  .notice--error { border-color: ${T.danger}; background: ${T.dangerSoft}; }
  .notice__title { margin: 0 0 6px; font-size: 15px; font-weight: 650; }
  .notice__body { margin: 0; font-size: 14px; line-height: 1.5; }

  .link { color: ${T.brand}; text-decoration: underline; text-underline-offset: 2px; }
  .link:focus-visible { outline: 2px solid ${T.focus}; outline-offset: 2px; border-radius: 3px; }
  .link:hover { color: var(--brand-hover); }

  /* Three columns become one, and the featured card stops being featured
     because "most teams pick this" means nothing in a single column. */
  @media (max-width: 900px) {
    .plans { grid-template-columns: 1fr; gap: 16px; }
    .plan__blurb, .plan__save { min-height: 0; }
    .plan--featured { order: -1; }
    .plan__flag { margin: -28px -24px 20px; }
  }

  @media (max-width: 480px) {
    .hero-wrap { padding: 32px 16px 64px; }
    .hero__title { font-size: 30px; }
    .hero__lede { font-size: 15px; }
    .segmented { width: 100%; justify-content: center; }
    .segmented__opt { flex: 1; justify-content: center; padding: 0 10px; }
    .plan { padding: 22px 18px; }
    .plan__flag { margin: -22px -18px 18px; }
  }
`;
}
