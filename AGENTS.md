# 275grams: Junction 2026, hardware track (Arduino challenge)

Brief: "a greener Europe". Direction: on-device voice/audio AI on the Arduino UNO Q.
Team of 4. Hackathon ends Sunday. Write British English, be concise and opinionated, give no time estimates.

## Use case (decided)
Edge-AI biodiversity stations. Each station listens in a forest or park, identifies bird and animal calls on the device, and logs detections by species. Scientists get an interactive map of the stations with species search, date filters, a per-station heatmap of detections per hour of listening (areas with no station are shown as unsampled), a breakdown and clips for each station, and trends across weeks, seasons and years.
- One-line pitch: low-power stations that tell ecologists where species are thriving or declining, without shipping hours of audio (or anyone's voice) to the cloud.
- Be honest about the limits: detections are not individual animals. On the map, one station is live and the others are seeded or simulated, and the map labels them that way.
- Classify with `arduino:audio_classification` (multi-class), not keyword spotting. Train a custom Edge Impulse model on a few species that are common in Finland, plus `noise` and `human` classes. Discard `human` detections on the device for privacy.

## Milestones
1. **demo-v0 (stock check):** the stock "Hey Arduino" KWS example runs on our board. This proves the mic, the Brick and Bridge.
2. **demo-v1 (MVP):** the only priority right now. Mic → `audio_classification` on Linux (`unoq-app/python/main.py`) → `Bridge.call(...)` → the MCU (`unoq-app/sketch/sketch.ino`) shows the species on the LED matrix and plays a Modulino chirp. Python appends each detection to SQLite (`ts, station, species, confidence`).
3. **demo-v2:** a web dashboard served from the UNO Q with the map, heatmap and filters, over one live station plus seeded history.
4. Stretch: camera evidence, extra stations (`atech-node/`), MQTT, `protocol/`.

Don't touch `atech-node/`, Mosquitto/MQTT or `protocol/` before `demo-v1`. `main.py` must run without a broker.

## Hard rules
- `unoq-app/` must stay self-contained. App Lab compiles only `sketch/sketch.ino`, `sketch/*.h` and `sketch/sketch.yaml`, and runs `python/`. Nothing in it may reference files outside `unoq-app/`.
- `main` always runs the demo. Use short-lived branches named by subsystem: `kws/…`, `mcu/…`, `node/…`, `protocol/…`.
- Merge by PR using the template. Self-merge is fine, but only after testing on real hardware.
- Tag every working full-system build `demo-vN` (`git tag demo-vN`, then `git push --tags`).
- Never commit secrets (`secrets.h`, `.env`) or raw audio (`*.wav`, `data/`). Raw audio stays in Edge Impulse.
- Change the MQTT contract in `protocol/README.md` first, in a `protocol/…` PR.

## Verified platform facts (from arduino/app-bricks-py and app-bricks-examples, Nov 2026)
- Brick id: `arduino:keyword_spotting` (colon, not slash). Audio classification is `arduino:audio_classification`.
- `from arduino.app_bricks.keyword_spotting import KeywordSpotting`
  - `KeywordSpotting(mic=None, confidence=0.8, debounce_sec=2.0)`
  - `on_detect(label, callback)`: the callback takes **no arguments** and must be a plain function or lambda, not a bound method. It runs on the detection thread, and audio is dropped while it runs, so keep it short.
  - The stock model's label is `hey_arduino`. Labels are case-insensitive.
  - Several `on_detect` labels are allowed, but only the single best match above `confidence` fires per inference. Extra keywords need a custom Edge Impulse model (`.eim`).
- Mic: by default it is device 0 (USB mics come first). To be explicit, use `from arduino.app_peripherals.microphone import Microphone` and `Microphone(Microphone.USB_MIC_1, sample_rate=16000, channels=1)`.
- `sketch.yaml` has no `fqbn`. It sets only `platform: arduino:zephyr`. `Arduino_RouterBridge` and `Arduino_LED_Matrix` ship with the platform. Modulino needs `Arduino_Modulino (0.7.0)` plus its dependencies (copy them from the App Lab library picker).
- Bridge: `#include <Arduino_RouterBridge.h>`. On the MCU, use `Bridge.begin()` and `Bridge.provide("name", fn)` to expose a function, and `Bridge.notify("name", args...)` to push to Python. In Python, `from arduino.app_utils import App, Bridge` and `Bridge.call("name", args...)`.
- LED matrix: 13 × 8 = 104 px. Use `matrix.begin()`, `matrix.setGrayscaleBits(3)`, then `matrix.draw(uint8_t frame[104])` with values 0–7.
- Modulino: `Modulino.begin(Wire1);` on the UNO Q, then `while (!buzzer.begin()) delay(1000);`.

## Still unverified
- Whether App Lab follows a symlink from `~/ArduinoApps/` into the repo clone. If it doesn't, use `tools/deploy.sh`.
- Whether the kit camera has a mic.
- The ModulinoBuzzer API (`tone(freq, ms)`?). Check the library examples before relying on it.
- The PlatformIO `board =` value for the Atech "2.2 frame" board (post-MVP).

## Environment
- The dev machines run Windows with PowerShell 5.1. There is no `&&` and no `unzip`, so give commands one per line or join them with `;`.
- The board is reachable over SSH as `arduino@<hostname>.local`. With the powered hub attached, App Lab reaches it over Wi-Fi (Network Mode).

<!-- AGENTS.md is an identical copy of this file. Edit both together. -->
