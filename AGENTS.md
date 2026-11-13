# 275grams: Junction 2026, hardware track (Arduino challenge)

Brief: "a greener Europe". Direction: on-device voice/audio AI on the Arduino UNO Q.
Team of 4. Hackathon ends Sunday. Write British English, be concise and opinionated, give no time estimates.

## Use case (decided): Chirp
The full brief is the "Project_Chirp" Google Doc linked from README.md; it is the source of truth for requirements. In short: a network of listening stations that identify bird and wildlife calls at the edge, feeding a map-based dashboard where ecologists see species activity per station and how it changes over time.
- One-line pitch: low-power stations that tell ecologists where species are thriving or declining, without shipping hours of audio (or anyone's voice) to the cloud.
- Honesty rules from the brief: the metric is **detections per valid listening hour**; zero listening time is "no data", never zero activity; areas without stations are "unsampled"; detections are not individual animals; trends are "changes in detected activity", not population loss; synthetic or historical data is always labelled as such; model confidence is not accuracy.
- Classifier: **BirdNET on the UNO Q Linux side** (the teammate is evaluating it). BirdNET-Analyzer expects 48 kHz mono audio in 3 s windows, so capture with `Microphone(..., sample_rate=48000, channels=1)` from `arduino.app_peripherals.microphone`, and pass lat/lon (Espoo ≈ 60.2, 24.7) plus the week number to filter species. Check the licence: the BirdNET models are, as far as we know, CC BY-NC-SA 4.0. The fallback is an Edge Impulse model through `arduino:audio_classification`.
- Discard human speech on the device: never store clips that contain speech.

## Milestones
1. **demo-v0 (stock check):** the stock "Hey Arduino" KWS example runs on our board. This proves the mic, the Brick and Bridge.
2. **demo-v1 (MVP):** the only priority right now. USB mic → BirdNET on Linux (`unoq-app/python/main.py`) → `Bridge.call(...)` → the MCU (`unoq-app/sketch/sketch.ino`) shows the detection on the LED matrix and plays a Modulino chirp. Python writes to SQLite with separate `detections` (id, ts, station, species, confidence, model_version, clip) and `listening_sessions` (station, start, end) tables, so rates are right from day one.
3. **demo-v2:** a dashboard served from the UNO Q (map, station status, per-station rate markers, species and date filters, a detail panel) over one live station plus clearly labelled seeded stations and history.
4. **Network:** the two Atech ESP32 nodes become listening stations that stream to the UNO Q as the edge gateway, with heartbeats for online/offline. This is only possible if the Atech mics expose waveform samples rather than a sound level, so check that first. If they can't, the nodes report activity level and status only.
5. Stretch: an on-demand camera livestream, human review states, multi-season trends on real data.

Don't touch `atech-node/`, Mosquitto/MQTT or `protocol/` before `demo-v1`, apart from checking the Atech mic, which is reading only. `main.py` must run without a broker.

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
- Whether the Atech microphone gives waveform samples (analogue output we can sample at 16 kHz or more, or I2S) or only a sound level. Read its datasheet or silkscreen.
- Whether App Lab installs `python/requirements.txt` (BirdNET needs `birdnetlib` or `tflite-runtime` plus `librosa`). Check this on the board.
- BirdNET's speed and memory use on the UNO Q's Cortex-A53 with 2 GB of RAM.
- The ModulinoBuzzer API (`tone(freq, ms)`?). Check the library examples before relying on it.
- The PlatformIO `board =` value for the Atech "2.2 frame" board (post-MVP).

## Environment
- The dev machines run Windows with PowerShell 5.1. There is no `&&` and no `unzip`, so give commands one per line or join them with `;`.
- The board is reachable over SSH as `arduino@<hostname>.local`. With the powered hub attached, App Lab reaches it over Wi-Fi (Network Mode).

<!-- AGENTS.md is an identical copy of this file. Edit both together. -->
