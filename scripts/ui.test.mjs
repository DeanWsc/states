// Component generator tests.
//
// The contract: what the builders emit must pass the audit. These tests assert
// that directly, so a change to kit/ui.mjs that reintroduces a missing state
// fails here rather than in someone's review.
import test from "node:test";
import assert from "node:assert/strict";
import { button, field, toggle, checkbox, panel, empty, row, srOnly, page, componentCss, esc, resetIds } from "../kit/ui.mjs";
import { audit } from "../kit/audit.mjs";

/** Audit a fragment wrapped in the component stylesheet. */
const auditFragment = (body, extraCss = "") =>
  audit(`<!doctype html><html><head><style>${componentCss()}${extraCss}</style></head><body><div class="wrap">${body}</div></body></html>`);

const errorsOf = (r, check) =>
  r.findings.filter((f) => f.severity === "error" && (!check || f.check === check));

test("esc neutralises markup in labels", () => {
  // A label with an ampersand or a script tag must not break the page.
  assert.equal(esc('a & b'), "a &amp; b");
  assert.equal(esc('<script>'), "&lt;script&gt;");
  assert.equal(esc('say "hi"'), "say &quot;hi&quot;");
});

test("a generated button audits clean", () => {
  const result = auditFragment(button({ label: "Save" }));
  assert.deepEqual(errorsOf(result, "state-coverage"), [], "the button must have every state");
  assert.deepEqual(errorsOf(result, "focus-indicator"), []);
  assert.deepEqual(errorsOf(result, "tap-target"), []);
});

test("a button cannot be generated without its states", () => {
  // The claim of this module is that you cannot emit a button missing a state.
  // Check the stylesheet the generator ships, not the call site.
  const css = componentCss();
  for (const state of [":hover", ":focus-visible", ":active", ":disabled"]) {
    assert.ok(css.includes(`.btn${state}`), `.btn${state} must exist`);
  }
});

test("a generated field audits clean, including the invalid state", () => {
  const result = auditFragment(
    field({ label: "Email", name: "email", invalid: true, message: "That address is not valid." }),
  );
  assert.deepEqual(errorsOf(result), [], JSON.stringify(errorsOf(result).map((f) => f.message), null, 1));
});

test("an invalid field carries its error in text, not only in colour", () => {
  const html = field({ label: "Email", name: "email", invalid: true, message: "Not valid." });
  assert.match(html, /aria-invalid="true"/);
  assert.match(html, /aria-describedby="[^"]+"/);
  assert.match(html, /field__message[^>]*>Not valid\./, "the message must be in the markup");
});

test("a field never uses a placeholder as its only label", () => {
  const html = field({ label: "Email", name: "email", placeholder: "you@example.com" });
  assert.match(html, /<label[^>]*for="[^"]+"/, "a real label element is required");
  assert.match(html, /placeholder="you@example\.com"/, "the placeholder is kept as a hint");
});

test("a generated toggle audits clean", () => {
  const result = auditFragment(
    row({ label: "Alerts", html: toggle({ label: "Alerts", checked: true }) }),
  );
  assert.deepEqual(errorsOf(result, "state-coverage"), []);
  assert.deepEqual(errorsOf(result, "color-only"), [], "the knob carries the state, not colour alone");
});

test("a generated checkbox audits clean", () => {
  const result = auditFragment(
    `<div class="row"><span class="row__text"><span class="row__label">Notify</span></span>${checkbox({ label: "Notify me" })}</div>`,
  );
  assert.deepEqual(errorsOf(result, "accessible-name"), []);
  assert.deepEqual(errorsOf(result, "tap-target"), [], "the label is the target");
});

test("an empty state is real markup, not a placeholder", () => {
  const html = empty({ title: "Nothing here", body: "Add one to begin.", action: button({ label: "Add" }) });
  assert.match(html, /empty__title">Nothing here/);
  assert.match(html, /empty__body">Add one to begin\./);
  assert.match(html, /<button/, "the empty state must offer a way out");
});

test("row uses html when given and control otherwise", () => {
  const a = row({ label: "A", control: "<em>control</em>" });
  assert.match(a, /<em>control<\/em>/);
  const b = row({ label: "B", html: "<i>html</i>" });
  assert.match(b, /<i>html<\/i>/);
  // Passing both must not emit the control twice.
  const c = row({ label: "C", control: "<em>one</em>", html: "<i>two</i>" });
  assert.ok(!c.includes("<em>one</em>"), "html wins, so the control is dropped");
});

test("a whole generated page audits clean in both themes", () => {
  const html = page({
    title: "Settings",
    lede: "A generated page.",
    content: [
      panel({
        title: "Details",
        children: [
          field({ label: "Name", name: "name", value: "Acme" }),
          `<div class="actions">${button({ label: "Save" })}${button({ label: "Discard", variant: "quiet" })}</div>`,
        ].join("\n"),
      }),
      panel({ title: "More", children: empty({ title: "Nothing yet" }) }),
    ].join("\n"),
  });
  for (const theme of ["light", "dark"]) {
    const result = audit(html, { theme });
    assert.deepEqual(
      errorsOf(result),
      [],
      `${theme}: ${JSON.stringify(errorsOf(result).map((f) => `${f.check}: ${f.message}`), null, 1)}`,
    );
  }
});

test("ids are unique so labels and descriptions can be wired", () => {
  resetIds();
  const a = field({ label: "A", name: "a" });
  const b = field({ label: "B", name: "b" });
  const idOf = (s) => /id="([^"]+)"/.exec(s)[1];
  assert.notEqual(idOf(a), idOf(b));
});

test("the component stylesheet includes the things that prevent common bugs", () => {
  const css = componentCss();
  // Without border-box, width:100% plus padding overflows every phone.
  assert.match(css, /box-sizing: border-box/);
  // Without min-width:0, a long label pushes the switch out of the row.
  assert.match(css, /\.row__text \{[\s\S]*?min-width: 0/);
  // Without flex-wrap, a third button is cut off on a phone.
  assert.match(css, /\.actions \{[\s\S]*?flex-wrap: wrap/);
  // The reduced-motion block is what the check looks for.
  assert.match(css, /@media \(prefers-reduced-motion: reduce\)/);
  // The tap size is 44px.
  assert.match(css, /min-height: 44px/);
});

test("the generated page ships a dark theme", () => {
  const html = page({ title: "T", content: "" });
  assert.match(html, /@media \(prefers-color-scheme: dark\)/);
  assert.match(html, /<meta name="viewport"[^>]*width=device-width/, "the viewport meta is what makes a phone honour the layout");
});
