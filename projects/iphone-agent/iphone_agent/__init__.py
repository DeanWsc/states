"""Drive an iPhone like a person: look at the screen, decide, tap through an ESP32.

The ESP32 pretends to be a Bluetooth mouse and keyboard (iOS AssistiveTouch
pointer). This package is the computer side: it captures the iPhone's screen,
asks Claude what to do, and moves the pointer in a closed loop, checking where
the pointer actually is before every tap.
"""
__version__ = "0.1.0"
