// iphone-agent firmware: the ESP32-S3 pretends to be a Bluetooth (BLE) mouse + keyboard for the
// iPhone, and takes orders from the computer over USB serial, one JSON object per line
// (protocol v0.2, see ../iphone_agent/protocol.py). With AssistiveTouch on, iOS shows a pointer
// that this mouse moves; clicks become taps and button-held moves become swipes.
#include <Arduino.h>
#include <ArduinoJson.h>
#include <NimBLEDevice.h>
#include <NimBLEHIDDevice.h>

#include "logic.h"

static const char* DEVICE_NAME = "iPhone Agent";
static const int STEP = 8;            // mouse units per report; small and constant (see logic.h)
static const int STEP_MS = 10;        // pause between reports, so iOS sees an even glide
static const int MAX_STEPS = 300;     // longer moves use bigger steps so a reply stays well under 5 s
static const int CLICK_MS = 40;       // how long a click holds the button
static const int KEY_MS = 15;         // how long a key is held, and the gap after it
static const int RESET_REPORTS = 40;  // (-127, -127) reports that pin the pointer to the top-left

static const uint8_t KB_ID = 1, MOUSE_ID = 2;

// One keyboard (report 1, plus the LED output report iOS expects) and one 3-button mouse with
// wheel (report 2), in a single HID service so the iPhone pairs once.
static const uint8_t REPORT_MAP[] = {
  0x05, 0x01, 0x09, 0x06, 0xA1, 0x01, 0x85, KB_ID,          // Keyboard
  0x05, 0x07, 0x19, 0xE0, 0x29, 0xE7, 0x15, 0x00, 0x25, 0x01, 0x75, 0x01, 0x95, 0x08, 0x81, 0x02,  // modifiers
  0x95, 0x01, 0x75, 0x08, 0x81, 0x01,                       // reserved byte
  0x95, 0x05, 0x75, 0x01, 0x05, 0x08, 0x19, 0x01, 0x29, 0x05, 0x91, 0x02,  // LEDs
  0x95, 0x01, 0x75, 0x03, 0x91, 0x01,                       // LED padding
  0x95, 0x06, 0x75, 0x08, 0x15, 0x00, 0x25, 0x65, 0x05, 0x07, 0x19, 0x00, 0x29, 0x65, 0x81, 0x00,  // 6 keys
  0xC0,
  0x05, 0x01, 0x09, 0x02, 0xA1, 0x01, 0x85, MOUSE_ID,       // Mouse
  0x09, 0x01, 0xA1, 0x00,
  0x05, 0x09, 0x19, 0x01, 0x29, 0x03, 0x15, 0x00, 0x25, 0x01, 0x95, 0x03, 0x75, 0x01, 0x81, 0x02,  // buttons
  0x95, 0x01, 0x75, 0x05, 0x81, 0x03,                       // padding
  0x05, 0x01, 0x09, 0x30, 0x09, 0x31, 0x09, 0x38, 0x15, 0x81, 0x25, 0x7F, 0x75, 0x08, 0x95, 0x03, 0x81, 0x06,  // x, y, wheel
  0xC0, 0xC0,
};

static NimBLEServer* server;
static NimBLEHIDDevice* hid;
static NimBLECharacteristic* kbInput;
static NimBLECharacteristic* mouseInput;
static volatile bool ready = false;   // connected AND encrypted: iOS only takes HID input then
static volatile int pendingEvent = 0; // 1 connected, -1 disconnected; printed from loop()
static uint8_t buttons = 0;

class ServerCallbacks : public NimBLEServerCallbacks {
  void onConnect(NimBLEServer* s, NimBLEConnInfo& info) override {
    // Ask for a short connection interval (7.5-15 ms) so steps arrive evenly.
    s->updateConnParams(info.getConnHandle(), 6, 12, 0, 400);
  }
  void onDisconnect(NimBLEServer*, NimBLEConnInfo&, int) override {
    ready = false;
    pendingEvent = -1;
    NimBLEDevice::startAdvertising();
  }
  void onAuthenticationComplete(NimBLEConnInfo& info) override {
    if (info.isEncrypted()) {
      ready = true;
      pendingEvent = 1;
    }
  }
};

// --- HID output ---------------------------------------------------------------------------
static void mouseReport(int8_t x, int8_t y, int8_t wheel = 0) {
  uint8_t r[4] = {buttons, (uint8_t)x, (uint8_t)y, (uint8_t)wheel};
  mouseInput->setValue(r, sizeof(r));
  mouseInput->notify();
}

static void keyReport(uint8_t mods, uint8_t code) {
  uint8_t r[8] = {mods, 0, code, 0, 0, 0, 0, 0};
  kbInput->setValue(r, sizeof(r));
  kbInput->notify();
}

static void tapKey(uint8_t mods, uint8_t code) {
  keyReport(mods, code);
  delay(KEY_MS);
  keyReport(0, 0);
  delay(KEY_MS);
}

static void doMove(long dx, long dy) {
  int step = STEP;
  logic::StepPlan plan = logic::planMove(dx, dy, step);
  while (plan.count() > MAX_STEPS) plan = logic::planMove(dx, dy, ++step);
  for (int i = 0; i < plan.count(); i++) {
    int8_t sx, sy;
    plan.step(i, sx, sy);
    mouseReport(sx, sy);
    delay(STEP_MS);
  }
}

// --- serial protocol ------------------------------------------------------------------------
static void reply(long id, const char* err = nullptr) {
  JsonDocument out;
  out["id"] = id;
  out["ok"] = err == nullptr;
  if (err) out["err"] = err;
  serializeJson(out, Serial);
  Serial.print('\n');
}

static void handle(const char* line) {
  JsonDocument in;
  if (deserializeJson(in, line)) return;  // not JSON: ignore, like the computer does
  long id = in["id"] | 0L;
  const char* op = in["op"] | "";

  if (!ready) return reply(id, "iPhone not connected");

  if (!strcmp(op, "reset")) {
    for (int i = 0; i < RESET_REPORTS; i++) { mouseReport(-127, -127); delay(STEP_MS); }
  } else if (!strcmp(op, "move")) {
    if (!in["dx"].is<long>() || !in["dy"].is<long>()) return reply(id, "move needs integer dx and dy");
    doMove(in["dx"].as<long>(), in["dy"].as<long>());
  } else if (!strcmp(op, "click")) {
    buttons |= 1; mouseReport(0, 0); delay(CLICK_MS);
    buttons &= ~1; mouseReport(0, 0);
  } else if (!strcmp(op, "down")) {
    buttons |= 1; mouseReport(0, 0);
  } else if (!strcmp(op, "up")) {
    buttons &= ~1; mouseReport(0, 0);
  } else if (!strcmp(op, "type")) {
    const char* text = in["text"] | "";
    for (const char* c = text; *c; c++) {
      uint8_t code; bool shift;
      if (!logic::asciiToHid(*c, code, shift)) return reply(id, "type is ASCII only");
      tapKey(shift ? logic::MOD_SHIFT : 0, code);
    }
  } else if (!strcmp(op, "key")) {
    uint8_t code, mods = 0; bool shift;
    if (!logic::keyToHid(in["code"] | "", code, shift)) return reply(id, "unknown key");
    for (JsonVariant m : in["mods"].as<JsonArray>()) {
      uint8_t bit = logic::modBit(m | "");
      if (!bit) return reply(id, "unknown modifier");
      mods |= bit;
    }
    tapKey(mods | (shift ? logic::MOD_SHIFT : 0), code);
  } else {
    return reply(id, "unknown op");
  }
  reply(id);
}

void setup() {
  Serial.begin(115200);

  NimBLEDevice::init(DEVICE_NAME);
  NimBLEDevice::setSecurityAuth(true, false, true);  // bond, no PIN (Just Works), secure connections
  NimBLEDevice::setSecurityIOCap(BLE_HS_IO_NO_INPUT_OUTPUT);

  server = NimBLEDevice::createServer();
  server->setCallbacks(new ServerCallbacks());

  hid = new NimBLEHIDDevice(server);
  kbInput = hid->getInputReport(KB_ID);
  hid->getOutputReport(KB_ID);  // LED report; iOS writes Caps Lock state here
  mouseInput = hid->getInputReport(MOUSE_ID);
  hid->setManufacturer("iphone-agent");
  hid->setPnp(0x02, 0x303A, 0x4001, 0x0100);  // USB vendor source, Espressif VID
  hid->setHidInfo(0x00, 0x02);                 // normally connectable
  hid->setReportMap((uint8_t*)REPORT_MAP, sizeof(REPORT_MAP));
  hid->setBatteryLevel(100);
  hid->startServices();

  NimBLEAdvertising* adv = NimBLEDevice::getAdvertising();
  adv->setAppearance(0x03C0);  // generic HID
  adv->addServiceUUID(hid->getHidService()->getUUID());
  adv->setName(DEVICE_NAME);
  adv->enableScanResponse(true);
  adv->start();
}

void loop() {
  static char buf[512];
  static size_t len = 0;

  if (pendingEvent) {
    Serial.print(pendingEvent > 0 ? "{\"event\":\"connected\"}\n" : "{\"event\":\"disconnected\"}\n");
    pendingEvent = 0;
  }

  while (Serial.available()) {
    char c = Serial.read();
    if (c == '\n' || c == '\r') {
      if (len) { buf[len] = 0; handle(buf); len = 0; }
    } else if (len < sizeof(buf) - 1) {
      buf[len++] = c;
    } else {
      len = 0;  // overlong line: drop it
    }
  }
  delay(1);
}
