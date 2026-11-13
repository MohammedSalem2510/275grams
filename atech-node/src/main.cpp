// ESP32 sensor node: publishes data, obeys commands. See protocol/README.md.
#include <Arduino.h>
#include <WiFi.h>
#include <ESPmDNS.h>
#include <PubSubClient.h>
#include <ArduinoJson.h>
#include "secrets.h"

#ifndef NODE_ID
#error "NODE_ID not set: build with -e node1 or -e node2"
#endif

WiFiClient wifi;
PubSubClient mqtt(wifi);

char tStatus[32], tData[32], tCmd[32], clientId[16];

void handleCmd(char *topic, byte *payload, unsigned int len) {
  JsonDocument doc;
  if (deserializeJson(doc, payload, len)) return;
  const char *cmd = doc["cmd"] | "";
  Serial.printf("[cmd] %s\n", cmd);
  if (strcmp(cmd, "ping") == 0) {
    mqtt.publish(tStatus, "\"online\"", true);
  }
  // TODO: add commands here (and to protocol/README.md)
}

IPAddress resolveBroker() {
  IPAddress ip = MDNS.queryHost(BROKER_HOST);
  if (ip == IPAddress(0, 0, 0, 0) && strlen(BROKER_IP_FALLBACK)) ip.fromString(BROKER_IP_FALLBACK);
  return ip;
}

void connectMqtt() {
  while (!mqtt.connected()) {
    IPAddress broker = resolveBroker();
    Serial.printf("[mqtt] broker %s\n", broker.toString().c_str());
    mqtt.setServer(broker, 1883);
    // Last will: broker publishes "offline" (retained) if we drop off
    if (mqtt.connect(clientId, tStatus, 1, true, "\"offline\"")) {
      mqtt.publish(tStatus, "\"online\"", true);
      mqtt.subscribe(tCmd);
    } else {
      delay(2000);
    }
  }
}

float readSensor() {
  return analogRead(34) / 4095.0f;  // TODO: replace with the real sensor
}

void setup() {
  Serial.begin(115200);
  snprintf(tStatus, sizeof tStatus, "nodes/%d/status", NODE_ID);
  snprintf(tData, sizeof tData, "nodes/%d/data", NODE_ID);
  snprintf(tCmd, sizeof tCmd, "unoq/cmd/%d", NODE_ID);
  snprintf(clientId, sizeof clientId, "atech-%d", NODE_ID);

  WiFi.begin(WIFI_SSID, WIFI_PASS);
  while (WiFi.status() != WL_CONNECTED) delay(250);
  Serial.printf("[wifi] %s\n", WiFi.localIP().toString().c_str());
  MDNS.begin(clientId);

  mqtt.setCallback(handleCmd);
  connectMqtt();
}

void loop() {
  if (!mqtt.connected()) connectMqtt();
  mqtt.loop();

  static uint32_t last = 0;
  if (millis() - last > 1000) {
    last = millis();
    JsonDocument doc;
    doc["ts"] = millis();
    doc["value"] = readSensor();
    char buf[96];
    serializeJson(doc, buf);
    mqtt.publish(tData, buf);
  }
}
