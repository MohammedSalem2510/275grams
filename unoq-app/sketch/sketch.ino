// UNO Q MCU side: functions Python can call over Bridge.
#include <Arduino_LED_Matrix.h>
#include <Arduino_RouterBridge.h>

Arduino_LED_Matrix matrix;

const uint8_t FRAME_SIZE = 13 * 8;  // 13 cols x 8 rows, brightness 0-7

uint8_t idle_frame[FRAME_SIZE] = {0};  // blank = listening

uint8_t detect_frame[FRAME_SIZE] = {  // speaker-ish "heard it" glyph
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 7, 0, 0, 0, 7, 0, 0, 0, 0,
  0, 0, 0, 7, 7, 0, 7, 0, 0, 7, 0, 0, 0,
  0, 7, 7, 7, 7, 0, 0, 7, 0, 7, 0, 0, 0,
  0, 7, 7, 7, 7, 0, 0, 7, 0, 7, 0, 0, 0,
  0, 0, 0, 7, 7, 0, 7, 0, 0, 7, 0, 0, 0,
  0, 0, 0, 0, 7, 0, 0, 0, 7, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
};

void keyword_detected() {
  // TODO(human): show detect_frame, then return to idle_frame.
}

void setup() {
  matrix.begin();
  matrix.setGrayscaleBits(3);
  matrix.clear();
  matrix.draw(idle_frame);

  Bridge.begin();
  Bridge.provide("keyword_detected", keyword_detected);
}

void loop() {
}
