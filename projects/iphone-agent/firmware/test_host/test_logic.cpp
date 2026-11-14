// Host-side tests for src/logic.h (no board needed):
//   g++ -std=c++17 -Wall -Wextra -I../src test_logic.cpp -o /tmp/test_logic && /tmp/test_logic
#include <cstdio>
#include <cstdlib>
#include "logic.h"

static int failures = 0;
#define CHECK(cond) do { if (!(cond)) { std::printf("FAIL line %d: %s\n", __LINE__, #cond); failures++; } } while (0)

static void moveAddsUp(long dx, long dy, int step) {
  logic::StepPlan p = logic::planMove(dx, dy, step);
  long sx = 0, sy = 0;
  for (int i = 0; i < p.count(); i++) {
    int8_t a, b;
    p.step(i, a, b);
    CHECK(std::abs(a) <= step && std::abs(b) <= step);
    sx += a; sy += b;
  }
  CHECK(sx == dx && sy == dy);
}

int main() {
  uint8_t code; bool shift;

  CHECK(logic::asciiToHid('a', code, shift) && code == 0x04 && !shift);
  CHECK(logic::asciiToHid('Z', code, shift) && code == 0x1D && shift);
  CHECK(logic::asciiToHid('1', code, shift) && code == 0x1E && !shift);
  CHECK(logic::asciiToHid('0', code, shift) && code == 0x27 && !shift);
  CHECK(logic::asciiToHid('@', code, shift) && code == 0x1F && shift);
  CHECK(logic::asciiToHid(' ', code, shift) && code == 0x2C && !shift);
  CHECK(logic::asciiToHid('?', code, shift) && code == 0x38 && shift);
  CHECK(logic::asciiToHid('.', code, shift) && code == 0x37 && !shift);
  CHECK(!logic::asciiToHid('\x01', code, shift));
  for (char c = 32; c < 127; c++) CHECK(logic::asciiToHid(c, code, shift));  // all printable ASCII

  CHECK(logic::keyToHid("v", code, shift) && code == 0x19 && !shift);
  CHECK(logic::keyToHid("h", code, shift) && code == 0x0B);
  CHECK(logic::keyToHid("enter", code, shift) && code == 0x28);
  CHECK(logic::keyToHid("backspace", code, shift) && code == 0x2A);
  CHECK(logic::keyToHid("escape", code, shift) && code == 0x29);
  CHECK(logic::keyToHid("tab", code, shift) && code == 0x2B);
  CHECK(logic::keyToHid("up", code, shift) && code == 0x52);
  CHECK(!logic::keyToHid("nosuchkey", code, shift));

  CHECK(logic::modBit("cmd") == logic::MOD_CMD);
  CHECK(logic::modBit("shift") == logic::MOD_SHIFT);
  CHECK(logic::modBit("hyper") == 0);

  CHECK(logic::planMove(0, 0, 8).count() == 0);
  CHECK(logic::planMove(16, 3, 8).count() == 2);
  CHECK(logic::planMove(-17, 0, 8).count() == 3);
  moveAddsUp(120, -40, 8);
  moveAddsUp(-3, 7, 8);
  moveAddsUp(-999, 1001, 8);
  moveAddsUp(1, 0, 8);
  moveAddsUp(5000, -2500, 13);

  // Steps are even: no step differs from another by more than one unit.
  logic::StepPlan p = logic::planMove(100, 0, 8);
  int lo = 127, hi = -127;
  for (int i = 0; i < p.count(); i++) { int8_t a, b; p.step(i, a, b); lo = a < lo ? a : lo; hi = a > hi ? a : hi; }
  CHECK(hi - lo <= 1);

  std::printf(failures ? "%d FAILED\n" : "all logic tests passed\n", failures);
  return failures ? 1 : 0;
}
