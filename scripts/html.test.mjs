// HTML parser tests. The awkward cases are the point: real hand-written
// interface markup is full of unclosed tags and stray "<".
import test from "node:test";
import assert from "node:assert/strict";
import {
  parseHTML, decodeEntities, visibleText, isInteractive, isDisabled,
  accessibleName, findById, byTag,
} from "../kit/html.mjs";

test("builds a tree with attributes and nesting", () => {
  const root = parseHTML(`<div class="card" data-id="7"><h2>Title</h2><p>Body</p></div>`);
  const div = root.children[0];
  assert.equal(div.tag, "div");
  assert.deepEqual(div.classes, ["card"]);
  assert.equal(div.attrs["data-id"], "7");
  assert.equal(div.children.length, 2);
  assert.equal(div.children[0].tag, "h2");
  assert.equal(div.children[0].text, "Title");
  assert.equal(div.label, "TitleBody", "label concatenates descendants");
});

test("sibling index is 1-based for :nth-child", () => {
  const root = parseHTML(`<ul><li>a</li><li>b</li><li>c</li></ul>`);
  const items = byTag(root, "li");
  assert.deepEqual(items.map((n) => n.index), [1, 2, 3]);
  assert.equal(items[1].text, "b");
});

test("void elements do not swallow their siblings", () => {
  const root = parseHTML(`<p><img src="a.png" alt="A">then text</p>`);
  const p = root.children[0];
  assert.equal(p.children.length, 1);
  assert.equal(p.children[0].tag, "img");
  assert.match(p.text, /then text/);
});

test("a quoted > inside an attribute does not end the tag", () => {
  const root = parseHTML(`<button title="a > b">Go</button>`);
  const b = root.children[0];
  assert.equal(b.tag, "button");
  assert.equal(b.attrs.title, "a > b");
  assert.equal(b.label, "Go");
});

test("self-closing syntax and SVG children", () => {
  const root = parseHTML(`<svg viewBox="0 0 10 10"><path d="M0 0"/><circle r="2" /></svg>`);
  const svg = root.children[0];
  assert.equal(svg.tag, "svg");
  assert.equal(svg.children.length, 2);
  assert.deepEqual(svg.children.map((c) => c.tag), ["path", "circle"]);
});

test("script and style bodies are captured raw, not parsed", () => {
  const root = parseHTML(`<style>.a::after{content:"<b>"}</style><script>if(a<b){}</script>`);
  const style = root.children[0];
  const script = root.children[1];
  assert.equal(style.tag, "style");
  assert.match(style.raw, /content:"<b>"/);
  assert.match(script.raw, /if\(a<b\)/);
  assert.equal(script.children.length, 0, "markup inside script is not elements");
});

test("comments and doctype are skipped", () => {
  const root = parseHTML(`<!doctype html><!-- note --><p>text</p><!-- another -->`);
  assert.equal(root.children.length, 1);
  assert.equal(root.children[0].tag, "p");
});

test("unclosed tags unwind at the parent boundary", () => {
  // A missing </div> must not merge the following section into the card.
  const root = parseHTML(`<div class="card"><p>one<p>two</div><section>three</section>`);
  const card = findById ? root.children[0] : null;
  assert.equal(card.tag, "div");
  const pTags = byTag(root, "p");
  assert.equal(pTags.length, 2);
  const section = byTag(root, "section");
  assert.equal(section.length, 1);
  assert.equal(section[0].text, "three", "section must be a sibling, not a descendant");
});

test("a stray closing tag is ignored rather than unwinding the tree", () => {
  const root = parseHTML(`<div><p>a</p></span><p>b</p></div>`);
  const pTags = byTag(root, "p");
  assert.equal(pTags.length, 2, "the stray </span> must not close the div");
  assert.equal(root.children[0].tag, "div");
});

test("bare less-than in text is literal", () => {
  const root = parseHTML(`<p>a &lt; b and 3<4</p>`);
  assert.equal(root.children[0].tag, "p");
  assert.equal(visibleText(root.children[0]), "a < b and 3<4");
});

test("entity decoding in text and attributes", () => {
  assert.equal(decodeEntities("a &amp; b"), "a & b");
  assert.equal(decodeEntities("&hellip;done"), "…done");
  assert.equal(decodeEntities("&#8594;"), "→");
  assert.equal(decodeEntities("&#x2192;"), "→");
  assert.equal(decodeEntities("&unknownentity;"), "&unknownentity;", "unknown entities stay visible");
  const root = parseHTML(`<p title="a &amp; b">c &copy; d</p>`);
  assert.equal(root.children[0].attrs.title, "a & b");
  assert.equal(visibleText(root.children[0]), "c © d");
});

test("visible text skips script and style", () => {
  const root = parseHTML(`<div>Hello<style>.x{color:red}</style><script>var a=1</script>World</div>`);
  assert.equal(visibleText(root.children[0]), "HelloWorld");
});

test("interactive detection follows the spec", () => {
  const root = parseHTML(`
    <a href="/x">link</a>
    <a>no href</a>
    <button>press</button>
    <div role="button">role</div>
    <div tabindex="0">tabbable</div>
    <p>plain</p>
  `);
  const nodes = [...root.children];
  assert.equal(isInteractive(nodes[0]), true, "a[href] is a control");
  assert.equal(isInteractive(nodes[1]), false, "a without href is a placeholder");
  assert.equal(isInteractive(nodes[2]), true);
  assert.equal(isInteractive(nodes[3]), true, "role=button");
  assert.equal(isInteractive(nodes[4]), true, "tabindex makes it focusable");
  assert.equal(isInteractive(nodes[5]), false);
});

test("disabled detection covers attribute, aria and fieldset", () => {
  const root = parseHTML(`
    <button id="a" disabled>x</button>
    <button id="b" aria-disabled="true">y</button>
    <fieldset disabled><button id="c">z</button><legend><button id="d">w</button></legend></fieldset>
  `);
  const a = findById(root, "a");
  const b = findById(root, "b");
  const c = findById(root, "c");
  const d = findById(root, "d");
  assert.equal(isDisabled(a), true);
  assert.equal(isDisabled(b), true);
  assert.equal(isDisabled(c), true, "a disabled fieldset disables its buttons");
  assert.equal(isDisabled(d), false, "a button in the legend stays enabled");
});

test("accessible name follows the accname order", () => {
  const root = parseHTML(`
    <h2 id="title">Receipt</h2>
    <button aria-labelledby="title">x</button>
    <button aria-label="Close dialog">x</button>
    <label for="email">Email address</label><input id="email">
    <label>Wrapped <input id="w"></label>
    <button>Save</button>
    <button title="Tooltip name">x</button>
    <input id="ph" placeholder="Search">
    <img src="a.png" alt="">
  `);
  const nodes = [...root.descendants()];
  assert.equal(accessibleName(nodes.find((n) => n.tag === "button" && n.attrs["aria-labelledby"]), root), "Receipt");
  assert.equal(accessibleName(findById(root, "w").parent, root), "Wrapped");
  assert.equal(accessibleName(findById(root, "email"), root), "Email address");
  assert.equal(accessibleName(findById(root, "ph"), root), null, "a placeholder is not a name");
  const save = nodes.find((n) => n.tag === "button" && n.label === "Save");
  assert.equal(accessibleName(save, root), "Save", "content is the fallback name");
  const decorative = nodes.find((n) => n.tag === "img");
  assert.equal(accessibleName(decorative, root), null, 'alt="" is correctly decorative');
});

test("path and line numbers help a report point at the file", () => {
  const src = `<div>\n  <section>\n    <button>go</button>\n  </section>\n</div>`;
  const root = parseHTML(src);
  const btn = byTag(root, "button")[0];
  assert.equal(btn.path(), "div > section > button");
  assert.equal(btn.line, 3);
});

test("aria-live regions and roles are readable", () => {
  const root = parseHTML(`<div role="status" aria-live="polite"><p>Saved</p></div>`);
  const d = root.children[0];
  assert.equal(d.attrs.role, "status");
  assert.equal(d.attrs["aria-live"], "polite");
  assert.equal(visibleText(d), "Saved");
});
