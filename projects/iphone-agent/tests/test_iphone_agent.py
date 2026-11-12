"""python -m unittest discover tests  (no hardware, no API key, no macOS needed)"""
import json
import random
import unittest
from types import SimpleNamespace

from PIL import Image

from iphone_agent import pointer, protocol
from iphone_agent.agent import Agent, accuracy_test
from iphone_agent.capture import trim_borders
from iphone_agent.planner import Action, Planner
from iphone_agent.sim import SimPhone


class Protocol(unittest.TestCase):
    def test_encode_one_json_line(self):
        line = protocol.encode(3, "move", dx=12, dy=-4)
        self.assertTrue(line.endswith("\n"))
        self.assertEqual(json.loads(line), {"id": 3, "op": "move", "dx": 12, "dy": -4})

    def test_rejects_what_the_firmware_cannot_do(self):
        with self.assertRaises(ValueError):
            protocol.encode(1, "move", dx=1.5, dy=0)
        with self.assertRaises(ValueError):
            protocol.encode(1, "type", text="你好")
        with self.assertRaises(ValueError):
            protocol.encode(1, "key", code="v", mods=["super"])
        with self.assertRaises(ValueError):
            protocol.encode(1, "fly")

    def test_decode_skips_boot_noise(self):
        self.assertIsNone(protocol.decode("ets Jun  8 2016 rst:0x1"))
        self.assertIsNone(protocol.decode("{broken"))
        self.assertEqual(protocol.decode('{"id":2,"ok":true}\r\n'), {"id": 2, "ok": True})


class Pointer(unittest.TestCase):
    def test_locate_finds_the_pointer_and_puts_it_back(self):
        s = SimPhone(noise=0)
        s.x, s.y = 200, 300
        x, y = pointer.locate(s, s.capture)
        self.assertLess(abs(x - 200) + abs(y - 300), 2)
        self.assertLess(abs(s.x - 200) + abs(s.y - 300), 2)

    def test_locate_against_the_right_edge(self):
        s = SimPhone(noise=0)
        s.x, s.y = s.w - 1, 500
        x, _ = pointer.locate(s, s.capture)
        # Half the disc is off screen, so its visible centre sits a little inside.
        self.assertLess(abs(x - (s.w - 1)), s.r * 0.6)

    def test_calibration_measures_the_gain(self):
        s = SimPhone(accel=0, noise=0.5)
        cal = pointer.calibrate(s, s.capture, s.w, s.h)
        self.assertAlmostEqual(cal.sx, s.gain, delta=0.05)
        self.assertAlmostEqual(cal.sy, s.gain, delta=0.05)

    def test_goto_converges_despite_acceleration_and_noise(self):
        s = SimPhone(gain=0.7, accel=0.001, noise=2.0, seed=3)
        cal = pointer.calibrate(s, s.capture, s.w, s.h)
        rng = random.Random(1)
        for _ in range(8):
            tx, ty = rng.uniform(40, s.w - 40), rng.uniform(80, s.h - 80)
            pointer.goto(s, s.capture, cal, tx, ty)
            # 2px of noise on every move (harsher than a real HID mouse) leaves a few
            # pixels of drift after the last check; a button is 80px or more.
            self.assertLess(((s.x - tx) ** 2 + (s.y - ty) ** 2) ** 0.5, 18)

    def test_acceptance_test_passes_on_the_simulator(self):
        s = SimPhone()
        cal = pointer.calibrate(s, s.capture, s.w, s.h)
        ok, errors = accuracy_test(s, s.capture, cal, log=lambda *_: None)
        self.assertTrue(ok)
        self.assertEqual(len(errors), 10)

    def test_no_pointer_is_reported_not_guessed(self):
        class Dead:
            def move(self, dx, dy):
                pass
        img = Image.new("RGB", (100, 200), "white")
        with self.assertRaises(pointer.PointerNotFound):
            pointer.locate(Dead(), lambda: img)


class FakePlanner:
    def __init__(self, actions):
        self.actions = list(actions)
        self.seen = []

    def next_action(self, task, screenshot, history):
        self.seen.append(list(history))
        return self.actions.pop(0)


class AgentLoop(unittest.TestCase):
    def setUp(self):
        self.sim = SimPhone(seed=5)
        self.clip = []

    def agent(self, actions, confirm=None):
        self.planner = FakePlanner(actions)
        return Agent(self.sim, self.sim.capture, self.planner, clipboard=self.clip.append,
                     confirm=confirm, log=lambda *_: None, settle=0)

    def test_tap_type_and_done(self):
        a = self.agent([
            Action(action="tap", x=150, y=300, reason="open the app"),
            Action(action="type", text="hello", reason="search"),
            Action(action="done", reason="finished"),
        ])
        result = a.run("say hello")
        self.assertEqual(result.action, "done")
        tx, ty = self.sim.taps[0]
        self.assertLess(((tx - 150) ** 2 + (ty - 300) ** 2) ** 0.5, 14)
        self.assertEqual(self.sim.typed, ["hello"])
        self.assertEqual(len(self.planner.seen[-1]), 2)

    def test_chinese_goes_through_the_clipboard(self):
        a = self.agent([Action(action="type", text="你好", reason="reply"), Action(action="done", reason="ok")])
        a.cal = pointer.Calibration(sx=0.85, sy=0.85)
        import iphone_agent.agent as mod
        mod.time.sleep = lambda s: None
        a.run("reply in Chinese")
        # The simulator's screen never shows the paste, so the agent retries once, then reports.
        self.assertEqual(self.clip, ["你好", "你好"])
        self.assertEqual(self.sim.keys, [("v", ("cmd",)), ("v", ("cmd",))])
        self.assertEqual(self.sim.typed, [])

    def test_paste_that_shows_up_is_not_repeated(self):
        a = self.agent([Action(action="type", text="你好", reason="reply"), Action(action="done", reason="ok")])
        a.cal = pointer.Calibration(sx=0.85, sy=0.85)
        import iphone_agent.agent as mod
        mod.time.sleep = lambda s: None
        sim = self.sim
        real_key = sim.key
        def key(code, mods=()):
            real_key(code, mods)
            sim.screen.paste((0, 0, 0), (40, 40, 300, 90))  # the pasted text appears
        sim.key = key
        a.run("reply in Chinese")
        self.assertEqual(self.clip, ["你好"])

    def test_unchanged_screen_is_noted_for_the_next_step(self):
        a = self.agent([Action(action="tap", x=300, y=60, reason="tap empty space"), Action(action="done", reason="ok")])
        a.run("anything")
        self.assertIn("did not change", self.planner.seen[-1][0])

    def test_declined_confirmation_stops_before_acting(self):
        a = self.agent([Action(action="tap", x=100, y=200, reason="x")], confirm=lambda action: False)
        a.run("anything")
        self.assertEqual(self.sim.taps, [])

    def test_swipe_holds_the_button(self):
        a = self.agent([Action(action="swipe", x=300, y=900, x2=300, y2=300, reason="scroll"), Action(action="done", reason="ok")])
        a.run("scroll")
        self.assertFalse(self.sim.held)
        self.assertGreater(self.sim.path[0][1] - self.sim.path[-1][1], 400)


class PlannerScaling(unittest.TestCase):
    def test_coordinates_come_back_in_full_resolution_pixels(self):
        sent = {}

        class Msgs:
            def parse(self, **kw):
                sent.update(kw)
                return SimpleNamespace(stop_reason="end_turn", parsed_output=Action(action="tap", x=392, y=784, reason="r"))

        client = SimpleNamespace(beta=SimpleNamespace(messages=Msgs()))
        big = Image.new("RGB", (1179, 2556), "white")  # an iPhone 15 screenshot
        a = Planner(client=client).next_action("t", big, [])
        scale = 1568 / 2556
        self.assertEqual((a.x, a.y), (round(392 / scale), round(784 / scale)))
        self.assertEqual(sent["model"], "claude-opus-5-5")
        self.assertEqual(sent["fallbacks"], "default")
        self.assertIn("1568", sent["messages"][0]["content"][1]["text"].replace("x", " "))

    def test_refusal_is_raised(self):
        from iphone_agent.planner import Refused

        class Msgs:
            def parse(self, **kw):
                return SimpleNamespace(stop_reason="refusal", parsed_output=None)

        p = Planner(client=SimpleNamespace(beta=SimpleNamespace(messages=Msgs())))
        with self.assertRaises(Refused):
            p.next_action("t", Image.new("RGB", (100, 200)), [])


class Capture(unittest.TestCase):
    def test_trim_cuts_black_letterboxing(self):
        img = Image.new("RGB", (400, 400), "black")
        img.paste(Image.new("RGB", (180, 390), (200, 200, 200)), (110, 5))
        self.assertEqual(trim_borders(img).size, (180, 390))


if __name__ == "__main__":
    unittest.main()
