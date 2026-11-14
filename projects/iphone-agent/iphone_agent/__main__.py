"""python -m iphone_agent <command>

  demo                          run everything against the built-in simulator (no hardware, no API key)
  ports                         list serial ports
  calibrate --port P            find the pointer and measure its gain
  accuracy  --port P            acceptance test: 10 random points
  tap X Y   --port P            move to a screenshot pixel and tap
  run "TASK" --port P [--yes]   let Claude do a task; asks before every action unless --yes
  scroll --port P               刷视频: swipe to the next video every --interval seconds
         [--interval 8] [--count N] [--like-every N]     (no API key needed; Ctrl+C stops)
  shot [--out FILE]             save what the capture sees (check the crop)
"""
import argparse
import json
import sys
from pathlib import Path

from . import pointer

CAL_FILE = Path.home() / ".iphone-agent-calibration.json"


def _capture(args):
    from .capture import MacCapture

    region = tuple(int(v) for v in args.region.split(",")) if args.region else None
    crop = tuple(int(v) for v in args.crop.split(",")) if args.crop else (0, 0, 0, 0)
    return MacCapture(region=region, crop=crop)


def _device(args):
    from .device import SerialDevice

    if not args.port:
        sys.exit("--port is required (see: python -m iphone_agent ports)")
    return SerialDevice(args.port)


def _load_cal():
    if CAL_FILE.exists():
        d = json.loads(CAL_FILE.read_text())
        return pointer.Calibration(**d)
    return None


def _save_cal(cal):
    CAL_FILE.write_text(json.dumps(cal.__dict__))


def _ask(action):
    reply = input(f"  do it? [y/N] ").strip().lower()
    return reply in ("y", "yes")


def main(argv=None):
    p = argparse.ArgumentParser(prog="iphone_agent", description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    p.add_argument("command", choices=["demo", "ports", "calibrate", "accuracy", "tap", "run", "shot", "scroll"])
    p.add_argument("rest", nargs="*")
    p.add_argument("--port")
    p.add_argument("--region", help="x,y,w,h screen region instead of finding the QuickTime window")
    p.add_argument("--crop", help="top,right,bottom,left pixels to cut, e.g. a window title bar")
    p.add_argument("--out", default="shot.png")
    p.add_argument("--yes", action="store_true", help="do not ask before each action")
    p.add_argument("--steps", type=int, default=25)
    p.add_argument("--effort", default="medium", choices=["low", "medium", "high"])
    p.add_argument("--interval", type=float, default=8.0, help="scroll: seconds to watch each video")
    p.add_argument("--count", type=int, help="scroll: stop after this many videos (default: until Ctrl+C)")
    p.add_argument("--like-every", type=int, default=0, help="scroll: double-tap to like every Nth video")
    args = p.parse_args(argv)

    if args.command == "demo":
        from .agent import accuracy_test
        from .sim import SimPhone

        sim = SimPhone()
        cal = pointer.calibrate(sim, sim.capture, sim.w, sim.h)
        print(f"simulator calibrated: {cal.sx:.3f} x {cal.sy:.3f} px/unit (true gain {sim.gain})")
        ok, _ = accuracy_test(sim, sim.capture, cal)
        return 0 if ok else 1

    if args.command == "ports":
        from serial.tools import list_ports

        for port in list_ports.comports():
            print(f"{port.device}\t{port.description}")
        return 0

    capture = _capture(args)
    if args.command == "shot":
        capture().save(args.out)
        print(f"wrote {args.out} ({capture.size[0]}x{capture.size[1]})")
        return 0

    dev = _device(args)
    try:
        if args.command == "calibrate":
            from .agent import Agent

            cal = Agent(dev, capture, planner=None).calibrate()
            _save_cal(cal)
            print(f"saved to {CAL_FILE}")
            return 0
        cal = _load_cal()
        if cal is None:
            sys.exit("run calibrate first")
        if args.command == "accuracy":
            from .agent import accuracy_test

            ok, _ = accuracy_test(dev, capture, cal)
            return 0 if ok else 1
        if args.command == "tap":
            x, y = (float(v) for v in args.rest[:2])
            pointer.goto(dev, capture, cal, x, y)
            dev.click()
            return 0
        if args.command == "scroll":
            from .agent import Agent

            agent = Agent(dev, capture, planner=None, cal=cal)
            agent.scroll_videos(count=args.count, interval=args.interval, like_every=args.like_every)
            return 0
        if args.command == "run":
            from .agent import Agent
            from .capture import set_mac_clipboard
            from .planner import Planner

            task = " ".join(args.rest)
            agent = Agent(dev, capture, Planner(effort=args.effort), cal=cal, clipboard=set_mac_clipboard,
                          confirm=None if args.yes else _ask)
            result = agent.run(task, max_steps=args.steps)
            return 0 if result is not None and result.action == "done" else 1
    finally:
        dev.close()


if __name__ == "__main__":
    sys.exit(main())
