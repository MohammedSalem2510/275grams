// UNO Q MCU side: real-time I/O for the station, exposed to Python over Bridge.
//  - LED matrix: a bird on each detection; the duty-cycle bar shows for 3 s after a Knob change, then dark
//  - Modulino Buzzer: short chirp on each detection
//  - Modulino Thermo: temperature context for every listening window
//  - Modulino Knob: duty cycle (100 / 50 / 25 / 10 % of each minute analysed); press = 100 %
// Every Modulino is optional: if one isn't plugged in, the station keeps working without it.
#include <Arduino_LED_Matrix.h>
#include <Arduino_Modulino.h>
#include <Arduino_RouterBridge.h>

Arduino_LED_Matrix matrix;
ModulinoThermo thermo;
ModulinoBuzzer buzzer;
ModulinoKnob knob;
bool has_thermo = false, has_buzzer = false, has_knob = false;

const uint8_t COLS = 13, ROWS = 8, FRAME_SIZE = COLS * ROWS;  // brightness 0-7

uint8_t detect_frame[FRAME_SIZE] = {  // a bird facing right: tail, body, wing (dimmer), eye, beak, legs
  0, 0, 0, 0, 0, 0, 0, 0, 7, 7, 7, 0, 0,
  0, 0, 0, 0, 0, 0, 0, 7, 7, 0, 7, 7, 7,
  7, 0, 0, 0, 0, 0, 7, 7, 7, 7, 7, 0, 0,
  7, 7, 0, 0, 0, 7, 7, 7, 7, 7, 7, 0, 0,
  0, 7, 7, 7, 4, 4, 4, 4, 7, 7, 0, 0, 0,
  0, 0, 7, 7, 7, 7, 7, 7, 7, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 7, 0, 7, 0, 0, 0, 0, 0,
  0, 0, 0, 0, 0, 7, 0, 7, 0, 0, 0, 0, 0,
};
uint8_t idle_frame[FRAME_SIZE];  // blank, except the duty bar for BAR_MS after a Knob change

const unsigned long SHOW_MS = 1000, SENSE_MS = 2000, BAR_MS = 3000;
const int DUTY_STEPS[] = {100, 50, 25, 10};
const float NO_SENSOR = -999.0;

// Written by Bridge handlers, read by loop(). Handlers only record or return cached values,
// so Python's Bridge.call (and the mic) is never held up by I2C or the matrix.
volatile unsigned long detected_at = 0;
volatile bool pending = false;
volatile float temperature_c = NO_SENSOR;
volatile int duty_percent = 100;
bool showing = false, bar_on = false;
unsigned long sensed_at = 0, bar_since = 0;
int knob_origin = 0, duty_index = 0;

void bird_detected() {
  detected_at = millis();  // a repeat call while showing extends the glyph
  pending = true;
}

float get_temperature() { return temperature_c; }
int get_duty() { return duty_percent; }

void draw_idle() {
  memset(idle_frame, 0, FRAME_SIZE);
  if (bar_on) {
    int lit = (duty_percent * COLS + 99) / 100;  // e.g. 25 % -> 4 of 13 columns
    for (int c = 0; c < lit; c++) idle_frame[(ROWS - 1) * COLS + c] = 2;
  }
  matrix.draw(idle_frame);
}

void show_bar() {  // (re)start the 3 s duty-bar display
  bar_on = true;
  bar_since = millis();
  if (!showing) draw_idle();
}

void read_knob() {
  if (!has_knob) return;
  int index = duty_index;
  if (knob.isPressed()) {
    knob_origin = knob.get();
    index = 0;
    if (!bar_on) show_bar();  // a press confirms 100 % even when it was already 100 %
  } else {
    int steps = knob.get() - knob_origin;
    index = ((steps % 4) + 4) % 4;
  }
  if (index != duty_index) {
    duty_index = index;
    duty_percent = DUTY_STEPS[index];
    show_bar();
  }
}

void setup() {
  matrix.begin();
  matrix.setGrayscaleBits(3);
  matrix.clear();

  Modulino.begin(Wire1);  // Qwiic chain on the UNO Q
  has_thermo = thermo.begin();
  has_buzzer = buzzer.begin();
  has_knob = knob.begin();
  if (has_knob) knob_origin = knob.get();
  show_bar();  // shows the duty setting for 3 s at start-up

  Bridge.begin();
  Bridge.provide("bird_detected", bird_detected);
  Bridge.provide("get_temperature", get_temperature);
  Bridge.provide("get_duty", get_duty);
}

void loop() {
  // All matrix, buzzer and sensor I/O happens here, never in a Bridge handler.
  if (pending) {
    pending = false;
    if (!showing) {
      matrix.draw(detect_frame);
      showing = true;
      if (has_buzzer) buzzer.tone(3800, 80);  // one short chirp per detection burst
    }
  }
  if (showing && millis() - detected_at >= SHOW_MS) {  // wrap-safe subtraction
    draw_idle();
    showing = false;
  }
  if (bar_on && millis() - bar_since >= BAR_MS) {  // bar timed out: go dark
    bar_on = false;
    if (!showing) draw_idle();
  }
  if (millis() - sensed_at >= SENSE_MS) {
    sensed_at = millis();
    if (has_thermo) temperature_c = thermo.getTemperature();
  }
  read_knob();
}
