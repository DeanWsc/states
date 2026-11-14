// Pure logic for the firmware, kept free of Arduino and BLE so it can be unit-tested on a PC
// (see test_host/). Everything here is about turning protocol v0.2 commands into HID reports.
#pragma once
#include <stdint.h>
#include <stdlib.h>
#include <string.h>

namespace logic {

// HID modifier bits (first byte of a keyboard report).
const uint8_t MOD_CTRL = 0x01, MOD_SHIFT = 0x02, MOD_ALT = 0x04, MOD_CMD = 0x08;

// A protocol "mods" name -> modifier bit, or 0 if unknown.
inline uint8_t modBit(const char* name) {
  if (!strcmp(name, "cmd")) return MOD_CMD;
  if (!strcmp(name, "ctrl")) return MOD_CTRL;
  if (!strcmp(name, "alt")) return MOD_ALT;
  if (!strcmp(name, "shift")) return MOD_SHIFT;
  return 0;
}

// One printable ASCII character -> HID usage code and whether Shift is needed (US layout).
// Returns false for characters a US keyboard cannot type.
inline bool asciiToHid(char c, uint8_t& code, bool& shift) {
  shift = false;
  if (c >= 'a' && c <= 'z') { code = 0x04 + (c - 'a'); return true; }
  if (c >= 'A' && c <= 'Z') { code = 0x04 + (c - 'A'); shift = true; return true; }
  if (c >= '1' && c <= '9') { code = 0x1E + (c - '1'); return true; }
  if (c == '0') { code = 0x27; return true; }
  static const char plain[] = "\n\t -=[]\\;'`,./";
  static const uint8_t plainCodes[] = {0x28, 0x2B, 0x2C, 0x2D, 0x2E, 0x2F, 0x30, 0x31, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38};
  static const char shifted[] = "!@#$%^&*()_+{}|:\"~<>?";
  static const uint8_t shiftedCodes[] = {0x1E, 0x1F, 0x20, 0x21, 0x22, 0x23, 0x24, 0x25, 0x26, 0x27,
                                         0x2D, 0x2E, 0x2F, 0x30, 0x31, 0x33, 0x34, 0x35, 0x36, 0x37, 0x38};
  for (size_t i = 0; plain[i]; i++)
    if (plain[i] == c) { code = plainCodes[i]; return true; }
  for (size_t i = 0; shifted[i]; i++)
    if (shifted[i] == c) { code = shiftedCodes[i]; shift = true; return true; }
  return false;
}

// A protocol "key" code -> HID usage. Accepts one character ("v", "h", "1") or a name.
// Returns false if unknown. `shift` is set when the character itself needs Shift.
inline bool keyToHid(const char* name, uint8_t& code, bool& shift) {
  shift = false;
  if (name[0] && !name[1]) return asciiToHid(name[0], code, shift);
  struct Named { const char* n; uint8_t c; };
  static const Named names[] = {
    {"enter", 0x28}, {"return", 0x28}, {"escape", 0x29}, {"esc", 0x29}, {"backspace", 0x2A},
    {"delete", 0x2A}, {"tab", 0x2B}, {"space", 0x2C}, {"right", 0x4F}, {"left", 0x50},
    {"down", 0x51}, {"up", 0x52}, {"home", 0x4A}, {"end", 0x4D}, {"pageup", 0x4B}, {"pagedown", 0x4E},
  };
  for (const Named& k : names)
    if (!strcmp(name, k.n)) { code = k.c; return true; }
  return false;
}

// Splitting a relative move into small, evenly paced steps. Mouse reports carry int8 deltas,
// and iOS applies pointer acceleration, so every step uses the same small size: the gain the
// computer measured during calibration then holds for moves of any length.
struct StepPlan {
  long dx, dy;
  int n;
  int count() const { return n; }
  // Delta of step i (0-based): rounded cumulative position minus the previous one, so the
  // steps always add up exactly to (dx, dy).
  static long cum(long total, int i, int n) {
    long num = total * i;
    return num >= 0 ? (num + n / 2) / n : -((-num + n / 2) / n);
  }
  void step(int i, int8_t& sx, int8_t& sy) const {
    sx = (int8_t)(cum(dx, i + 1, n) - cum(dx, i, n));
    sy = (int8_t)(cum(dy, i + 1, n) - cum(dy, i, n));
  }
};

inline StepPlan planMove(long dx, long dy, int maxStep) {
  long m = labs(dx) > labs(dy) ? labs(dx) : labs(dy);
  int n = (int)((m + maxStep - 1) / maxStep);
  return StepPlan{dx, dy, n};
}

}  // namespace logic
