"""Getting the iPhone's screen onto the computer.

The supported way: plug the iPhone into a Mac with a data cable, open QuickTime
Player > File > New Movie Recording, pick the iPhone in the menu next to the
record button, and leave the preview window open (no need to record). The phone
stays unlocked, so the ESP32 can tap it while we watch.

Do not use iPhone Mirroring for this: it needs the iPhone locked, and stops as
soon as the phone itself is touched.
"""
import shutil
import subprocess
import tempfile

import numpy as np
from PIL import Image


class CaptureError(RuntimeError):
    pass


def quicktime_window_id():
    """The CGWindowID of QuickTime Player's frontmost window, via Quartz (pyobjc)."""
    try:
        import Quartz  # pyobjc-framework-Quartz
    except ImportError as e:
        raise CaptureError("install pyobjc-framework-Quartz, or pass --region x,y,w,h") from e
    windows = Quartz.CGWindowListCopyWindowInfo(Quartz.kCGWindowListOptionOnScreenOnly, Quartz.kCGNullWindowID)
    best = None
    for w in windows:
        if w.get("kCGWindowOwnerName") != "QuickTime Player" or w.get("kCGWindowLayer", 0) != 0:
            continue
        b = w.get("kCGWindowBounds", {})
        area = b.get("Width", 0) * b.get("Height", 0)
        if best is None or area > best[0]:
            best = (area, w["kCGWindowNumber"])
    if not best:
        raise CaptureError("no QuickTime Player window; open File > New Movie Recording and choose the iPhone")
    return best[1]


def trim_borders(img, threshold=24):
    """Cut the black bars around the phone image (letterboxing inside the window)."""
    a = np.asarray(img.convert("L"))
    rows = np.where(a.max(axis=1) > threshold)[0]
    cols = np.where(a.max(axis=0) > threshold)[0]
    if not len(rows) or not len(cols):
        return img
    return img.crop((int(cols[0]), int(rows[0]), int(cols[-1]) + 1, int(rows[-1]) + 1))


class MacCapture:
    """Screenshots of the iPhone preview, as PIL images in the phone's own orientation."""

    def __init__(self, region=None, crop=(0, 0, 0, 0)):
        if not shutil.which("screencapture"):
            raise CaptureError("screencapture not found; this needs macOS")
        self.region = region        # (x, y, w, h) in screen points, or None for the QuickTime window
        self.crop = crop            # extra (top, right, bottom, left) pixels to cut, e.g. a title bar
        self.window = None if region else quicktime_window_id()
        self.size = None

    def __call__(self):
        with tempfile.NamedTemporaryFile(suffix=".png") as f:
            args = ["screencapture", "-x", "-o"]
            if self.region:
                args += ["-R", ",".join(str(v) for v in self.region)]
            else:
                args += ["-l", str(self.window)]
            r = subprocess.run(args + [f.name], capture_output=True)
            if r.returncode:
                raise CaptureError(r.stderr.decode() or "screencapture failed (Screen Recording permission?)")
            img = Image.open(f.name).convert("RGB")
        t, r_, b, l = self.crop
        if any(self.crop):
            img = img.crop((l, t, img.width - r_, img.height - b))
        img = trim_borders(img)
        self.size = img.size
        return img


def set_mac_clipboard(text):
    """Put text on the Mac clipboard; Universal Clipboard carries it to the iPhone."""
    subprocess.run(["pbcopy"], input=text.encode("utf-8"), check=True)
