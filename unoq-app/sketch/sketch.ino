// UNO Q MCU side: functions Python can call over Bridge.
#include <Arduino_RouterBridge.h>

void keyword_detected() {
  // TODO: drive actuators / Modulinos here
  digitalWrite(LED_BUILTIN, HIGH);
  delay(200);
  digitalWrite(LED_BUILTIN, LOW);
}

void setup() {
  pinMode(LED_BUILTIN, OUTPUT);
  Bridge.begin();
  Bridge.provide("keyword_detected", keyword_detected);
}

void loop() {
}
