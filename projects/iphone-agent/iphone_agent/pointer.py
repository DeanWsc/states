"""Find the pointer on the screen, learn how far it moves, and put it where it is wanted.

iOS gives a Bluetooth mouse only relative movement, with acceleration, so a
target can never be reached by arithmetic alone. Instead, every placement is a
closed loop: find the pointer, move by the estimated amount, find it again,
correct. The pointer is found by nudging it and looking at what changed between
two screenshots: the only thing that moved is the pointer.
"""
from dataclasses import dataclass

import numpy as np


class PointerNotFound(RuntimeError):
    pass


def _gray(img):
    return np.asarray(img.convert("L"), dtype=np.int16)


def _changed(a, b, threshold=18):
    return np.abs(_gray(a) - _gray(b)) > threshold


def _split_two(ys, xs, axis_values):
    """Split changed pixels into the two discs (old and new pointer) along one axis."""
    order = np.argsort(axis_values)
    v = axis_values[order]
    gaps = np.diff(v)
    if not len(gaps):
        raise PointerNotFound("too few changed pixels")
    cut = int(np.argmax(gaps)) + 1
    lo, hi = order[:cut], order[cut:]
    return (ys[lo].mean(), xs[lo].mean()), (ys[hi].mean(), xs[hi].mean())


@dataclass
class Calibration:
    sx: float   # screenshot pixels per mouse unit, x
    sy: float   # and y
    nudge: int = 40  # mouse units used to find the pointer


def locate(dev, capture, nudge=40):
    """Where the pointer is, in screenshot pixels. Leaves it (about) where it was.

    Nudges right; if the pointer is against the right edge and cannot move,
    nudges left instead. If the nudge was too small for the pointer's size (the
    before and after discs overlap, which skews both), it doubles the nudge and
    looks again: the disc's height, which horizontal overlap does not change,
    says how big the pointer is.
    """
    for size in (nudge, nudge * 2, nudge * 4):
        for direction in (1, -1):
            a = capture()
            dev.move(direction * size, 0)
            b = capture()
            ys, xs = np.nonzero(_changed(a, b))
            if len(xs) < 20:
                # Nothing moved: the pointer is against this edge. Do not move back,
                # or it would leave the edge by a full nudge.
                continue
            dev.move(-direction * size, 0)
            (y1, x1), (y2, x2) = _split_two(ys, xs, xs.astype(float))
            diameter = float(ys.max() - ys.min() + 1)
            if abs(x2 - x1) < diameter * 1.2:
                break  # discs overlap: try a bigger nudge
            # Moving right, the old disc is the left one; moving left, the right one.
            left = xs < (x1 + x2) / 2
            part = left if direction == 1 else ~left
            return float(xs[part].mean()), float(ys[part].mean())
    raise PointerNotFound("the pointer did not show up; is AssistiveTouch on and the ESP32 paired?")


def measure_gain(dev, capture, units=120):
    """Screenshot pixels per mouse unit on each axis, measured, not assumed."""
    gains = []
    for dx, dy in ((units, 0), (0, units)):
        x0, y0 = locate(dev, capture)
        dev.move(dx, dy)
        x1, y1 = locate(dev, capture)
        dev.move(-dx, -dy)
        moved = (x1 - x0) if dx else (y1 - y0)
        if abs(moved) < 5:
            raise PointerNotFound("the pointer did not move; is it pinned against an edge?")
        gains.append(moved / (dx or dy))
    return Calibration(sx=gains[0], sy=gains[1])


def calibrate(dev, capture, width, height):
    """Put the pointer mid-screen, then measure the gain there."""
    dev.reset()
    # Walk towards the centre in small steps; the gain is unknown yet.
    for _ in range(12):
        x, y = locate(dev, capture)
        ex, ey = width / 2 - x, height / 2 - y
        if abs(ex) < width * 0.1 and abs(ey) < height * 0.1:
            break
        dev.move(max(-80, min(80, ex)), max(-80, min(80, ey)))
    return measure_gain(dev, capture)


def goto(dev, capture, cal, x, y, tolerance=6, attempts=6):
    """Move the pointer to (x, y) in screenshot pixels; return where it ended up."""
    px, py = locate(dev, capture, cal.nudge)
    for _ in range(attempts):
        ex, ey = x - px, y - py
        if abs(ex) <= tolerance and abs(ey) <= tolerance:
            return px, py
        dev.move(int(round(ex / cal.sx)), int(round(ey / cal.sy)))
        px, py = locate(dev, capture, cal.nudge)
    if abs(x - px) <= tolerance * 2 and abs(y - py) <= tolerance * 2:
        return px, py
    raise PointerNotFound(f"could not settle on ({x:.0f}, {y:.0f}); last seen at ({px:.0f}, {py:.0f})")
