"""The loop: look, decide, act, check."""
import time

import numpy as np

from . import pointer


def _same(a, b, threshold=6):
    if a.size != b.size:
        return False
    d = np.abs(np.asarray(a.convert("L"), dtype=np.int16) - np.asarray(b.convert("L"), dtype=np.int16))
    return float(d.mean()) < threshold / 10


class Agent:
    def __init__(self, dev, capture, planner, cal=None, clipboard=None, confirm=None, log=print, settle=0.8):
        self.dev = dev
        self.capture = capture
        self.planner = planner
        self.cal = cal
        self.clipboard = clipboard      # function(text) that sets the Mac clipboard, or None
        self.confirm = confirm          # function(action) -> bool, asked before every action; None to skip
        self.log = log
        self.settle = settle            # seconds for animations to finish after an action

    # --- primitives --------------------------------------------------------
    def calibrate(self):
        img = self.capture()
        self.cal = pointer.calibrate(self.dev, self.capture, *img.size)
        self.log(f"calibrated: {self.cal.sx:.3f} x {self.cal.sy:.3f} px per mouse unit")
        return self.cal

    def tap(self, x, y):
        pointer.goto(self.dev, self.capture, self.cal, x, y)
        self.dev.click()

    def swipe(self, x, y, x2, y2, steps=8):
        pointer.goto(self.dev, self.capture, self.cal, x, y)
        self.dev.down()
        dx, dy = (x2 - x) / self.cal.sx / steps, (y2 - y) / self.cal.sy / steps
        for _ in range(steps):
            self.dev.move(int(round(dx)), int(round(dy)))
        self.dev.up()

    def type_text(self, text):
        """ASCII goes straight to the keyboard. Anything else (Chinese, emoji) cannot be typed as
        HID key codes, so it goes through the clipboard: set it on the Mac, let Universal Clipboard
        carry it to the iPhone, and paste with Cmd+V."""
        if text.isascii():
            self.dev.type(text)
            return
        if not self.clipboard:
            raise RuntimeError("non-ASCII text needs the clipboard path (Mac + iPhone on the same Apple ID)")
        # Universal Clipboard holds a copy only briefly, so copy and paste back to back,
        # with nothing slow (screenshots, model calls) in between. If the screen did not
        # change, the paste missed: copy again and paste once more.
        for attempt in range(2):
            before = self.capture()
            self.clipboard(text)
            time.sleep(1.5)
            self.dev.key("v", ["cmd"])
            time.sleep(self.settle)
            if not _same(before, self.capture()):
                return
        self.log("paste did not change the screen; is Universal Clipboard on (same Apple ID, Handoff, Wi-Fi, Bluetooth)?")

    def home(self):
        self.dev.key("h", ["cmd"])

    # --- the loop -----------------------------------------------------------
    def run(self, task, max_steps=25):
        if self.cal is None:
            self.calibrate()
        history = []
        for step in range(1, max_steps + 1):
            before = self.capture()
            a = self.planner.next_action(task, before, history)
            self.log(f"[{step}] {a.action} {self._args(a)} - {a.reason}")
            if a.action in ("done", "fail"):
                return a
            if self.confirm and not self.confirm(a):
                self.log("stopped: not confirmed")
                return a
            if a.action == "tap":
                self.tap(a.x, a.y)
            elif a.action == "swipe":
                self.swipe(a.x, a.y, a.x2, a.y2)
            elif a.action == "type":
                self.type_text(a.text or "")
            elif a.action == "key":
                self.dev.key(a.key or "enter", a.mods or [])
            elif a.action == "home":
                self.home()
            time.sleep(self.settle)
            note = ""
            if a.action in ("tap", "swipe") and _same(before, self.capture()):
                note = " (the screen did not change)"
            history.append(f"{a.action} {self._args(a)} - {a.reason}{note}")
        self.log(f"stopped after {max_steps} steps")
        return None

    @staticmethod
    def _args(a):
        if a.action == "tap":
            return f"({a.x}, {a.y})"
        if a.action == "swipe":
            return f"({a.x}, {a.y}) -> ({a.x2}, {a.y2})"
        if a.action == "type":
            return repr(a.text)
        if a.action == "key":
            return "+".join([*(a.mods or []), a.key or ""])
        return ""


def accuracy_test(dev, capture, cal, points=10, margin=60, tolerance=None, seed=7, log=print):
    """Acceptance test 1: tap-free placement at random points, worst error reported."""
    import random

    rng = random.Random(seed)
    img = capture()
    w, h = img.size
    tol = tolerance or max(8, round(min(w, h) * 0.02))
    errors = []
    for i in range(points):
        tx, ty = rng.uniform(margin, w - margin), rng.uniform(margin * 2, h - margin * 2)
        px, py = pointer.goto(dev, capture, cal, tx, ty)
        err = ((px - tx) ** 2 + (py - ty) ** 2) ** 0.5
        errors.append(err)
        log(f"  point {i + 1}: target ({tx:.0f}, {ty:.0f}) error {err:.1f}px")
    worst = max(errors)
    log(f"worst error {worst:.1f}px, tolerance {tol}px: {'PASS' if worst <= tol * 1.5 else 'FAIL'}")
    return worst <= tol * 1.5, errors
