"""Things that can move a pointer: the real ESP32 over serial, or a simulator."""
import time

from . import protocol


class DeviceError(RuntimeError):
    pass


class SerialDevice:
    """The ESP32 on a USB serial port (115200 8N1)."""

    def __init__(self, port, baud=115200, timeout=5.0):
        import serial  # pyserial; imported here so the simulator needs nothing

        self.ser = serial.Serial(port, baud, timeout=0.1)
        self.timeout = timeout
        self.next_id = 1
        self.connected = None
        time.sleep(1.5)  # many ESP32 boards reset when the port opens
        self.ser.reset_input_buffer()

    def send(self, op, **fields):
        msg_id = self.next_id
        self.next_id += 1
        self.ser.write(protocol.encode(msg_id, op, **fields).encode())
        deadline = time.monotonic() + self.timeout
        while time.monotonic() < deadline:
            msg = protocol.decode(self.ser.readline().decode(errors="replace"))
            if not msg:
                continue
            if "event" in msg:
                self.connected = msg["event"] == "connected"
                continue
            if msg.get("id") == msg_id:
                if not msg.get("ok"):
                    raise DeviceError(f"{op} failed: {msg.get('err', 'unknown error')}")
                return msg
        raise DeviceError(f"no reply to {op} within {self.timeout}s; is the firmware running?")

    def reset(self):
        self.send("reset")

    def move(self, dx, dy):
        self.send("move", dx=int(round(dx)), dy=int(round(dy)))

    def click(self):
        self.send("click")

    def down(self):
        self.send("down")

    def up(self):
        self.send("up")

    def type(self, text):
        self.send("type", text=text)

    def key(self, code, mods=()):
        self.send("key", code=code, mods=list(mods))

    def close(self):
        self.ser.close()
