"""A pretend iPhone and ESP32, so the whole loop can be tested without hardware.

The simulator is deliberately unkind in the ways the real thing is: the pointer
gain is not exactly what calibration will find, larger moves travel slightly
further than smaller ones (pointer acceleration), every move picks up a little
noise, and the pointer stops at the screen edges.
"""
import random

from PIL import Image, ImageDraw


def demo_screen(width=590, height=1278):
    """A plain home-screen-like image: a grid of coloured app tiles."""
    img = Image.new("RGB", (width, height), (238, 238, 243))
    d = ImageDraw.Draw(img)
    size, gap = width // 5, width // 25
    for row in range(5):
        for col in range(4):
            x = gap + col * (size + gap)
            y = 120 + row * (size + gap * 3)
            hue = (row * 4 + col) * 37 % 255
            d.rounded_rectangle([x, y, x + size, y + size], radius=size // 5, fill=(hue, 120, 255 - hue))
    return img


class SimPhone:
    def __init__(self, screen=None, gain=0.85, accel=0.0006, noise=1.5, seed=1, pointer_radius=14):
        self.screen = screen or demo_screen()
        self.w, self.h = self.screen.size
        self.gain = gain            # screenshot pixels per mouse unit, at small moves
        self.accel = accel          # extra gain per unit of move length
        self.noise = noise          # pixels of random error per move
        self.rng = random.Random(seed)
        self.r = pointer_radius
        self.x, self.y = self.w / 2, self.h / 2
        self.taps = []
        self.typed = []
        self.keys = []
        self.held = False
        self.path = []

    # --- the device side -------------------------------------------------
    def _clamp(self):
        self.x = min(max(self.x, 0), self.w - 1)
        self.y = min(max(self.y, 0), self.h - 1)

    def reset(self):
        self.x, self.y = 0.0, 0.0

    def move(self, dx, dy):
        length = (dx * dx + dy * dy) ** 0.5
        g = self.gain * (1 + self.accel * length)
        self.x += dx * g + self.rng.gauss(0, self.noise)
        self.y += dy * g + self.rng.gauss(0, self.noise)
        self._clamp()
        if self.held:
            self.path.append((self.x, self.y))

    def click(self):
        self.taps.append((self.x, self.y))

    def down(self):
        self.held = True
        self.path = [(self.x, self.y)]

    def up(self):
        self.held = False

    def type(self, text):
        self.typed.append(text)

    def key(self, code, mods=()):
        self.keys.append((code, tuple(mods)))

    def close(self):
        pass

    # --- the screen side --------------------------------------------------
    def capture(self):
        img = self.screen.copy()
        d = ImageDraw.Draw(img, "RGBA")
        x, y, r = self.x, self.y, self.r
        # The AssistiveTouch pointer: a grey disc with a lighter rim.
        d.ellipse([x - r, y - r, x + r, y + r], fill=(60, 60, 60, 150), outline=(255, 255, 255, 200), width=2)
        return img
