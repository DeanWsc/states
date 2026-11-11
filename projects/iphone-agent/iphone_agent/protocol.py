"""The serial protocol between the computer and the ESP32: one JSON object per line.

Computer -> ESP32 (v0.2; v0.1 plus relative moves, button down/up and key modifiers):
    {"id": 1, "op": "reset"}                         push the pointer into the top-left corner
    {"id": 2, "op": "move", "dx": 120, "dy": -40}    relative move, in mouse units; the firmware
                                                     splits it into small, evenly paced steps
    {"id": 3, "op": "click"}                         left click
    {"id": 4, "op": "down"} / {"id": 5, "op": "up"}  hold / release the button (drags, swipes)
    {"id": 6, "op": "type", "text": "hello"}         ASCII only; see Agent.type_text for anything else
    {"id": 7, "op": "key", "code": "v", "mods": ["cmd"]}
ESP32 -> computer:
    {"id": 2, "ok": true}  or  {"id": 2, "ok": false, "err": "..."}
    {"event": "connected"} / {"event": "disconnected"}   when the iPhone pairs or drops
"""
import json

OPS = {"reset", "move", "click", "down", "up", "type", "key"}
MODS = {"cmd", "ctrl", "alt", "shift"}


def encode(msg_id, op, **fields):
    if op not in OPS:
        raise ValueError(f"unknown op {op!r}")
    if op == "move":
        for k in ("dx", "dy"):
            if not isinstance(fields.get(k), int):
                raise ValueError(f"move needs integer {k}")
    if op == "type" and not str(fields.get("text", "")).isascii():
        raise ValueError("type is ASCII only; paste other text through the clipboard")
    if op == "key":
        bad = set(fields.get("mods", [])) - MODS
        if bad:
            raise ValueError(f"unknown modifiers {sorted(bad)}")
    return json.dumps({"id": msg_id, "op": op, **fields}, ensure_ascii=True, separators=(",", ":")) + "\n"


def decode(line):
    """A reply or event from the ESP32, or None for blank or non-JSON lines (boot noise)."""
    line = line.strip()
    if not line.startswith("{"):
        return None
    try:
        return json.loads(line)
    except json.JSONDecodeError:
        return None
