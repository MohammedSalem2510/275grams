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

const unsigned long SHOW_MS = 1000;

// Written by the Bridge handler, read by loop(). The handler only records the
// event and returns, so Python's Bridge.call (and the mic) is never held up.
volatile unsigned long detected_at = 0;
volatile bool pending = false;
bool showing = false;

void bird_detected() {
  detected_at = millis();  // a repeat call while showing extends the glyph
  pending = true;
}

void setup() {
  matrix.begin();
  matrix.setGrayscaleBits(3);
  matrix.clear();
  matrix.draw(idle_frame);

  Bridge.begin();
  Bridge.provide("bird_detected", bird_detected);
}

void loop() {
  // All matrix drawing happens here, never in the Bridge handler.
  if (pending) {
    pending = false;
    if (!showing) {
      matrix.draw(detect_frame);
      showing = true;
    }
  }
  if (showing && millis() - detected_at >= SHOW_MS) {  // wrap-safe subtraction
    matrix.draw(idle_frame);
    showing = false;
  }
}
