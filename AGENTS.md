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
2. **demo-v1 (MVP):** the only priority right now. Camera mic → BirdNET on Linux (`unoq-app/python/main.py`) → `Bridge.call(...)` → the MCU (`unoq-app/sketch/sketch.ino`) shows the detection on the LED matrix and plays a Modulino chirp.
3. **demo-v2:** the UNO Q uploads each analysed window (recording ID, station, capture time, duration, predictions, clip) over HTTP to a **laptop backend**: FastAPI, SQLite, clips on disk, and a Leaflet dashboard with a local map-image fallback. Keep `detections` and analysed `listening` intervals in separate tables so rates are right from day one. Uploads retry with the same recording ID, so a retry never creates a duplicate. Full plan: `docs/implementation-plan.md`.
4. **Network:** the two Atech ESP32 nodes become listening stations that stream to the UNO Q as the edge gateway, with heartbeats for online/offline. This is only possible if the Atech mics expose waveform samples rather than a sound level, so check that first. If they can't, the nodes report activity level and status only.
5. Stretch: an on-demand camera livestream, human review states, multi-season trends on real data.

Don't touch `atech-node/`, Mosquitto/MQTT or `protocol/` before `demo-v1`, apart from checking the Atech mic, which is reading only. `main.py` must run without a broker.

## Hard rules
- `unoq-app/` must stay self-contained. App Lab compiles only `sketch/sketch.ino`, `sketch/*.h` and `sketch/sketch.yaml`, and runs `python/`. Nothing in it may reference files outside `unoq-app/`.
- Commit straight to `main`; no branches or PRs. Run `git pull --rebase` before every push.
- Prefix commit messages with the subsystem: `kws:`, `mcu:`, `node:`, `protocol:`, `docs:`. If a change hasn't been tested on real hardware, say so in the message.
- The last `demo-vN` tag is the known-good build. If `main` breaks, roll the board back to it.
- Tag every working full-system build `demo-vN` (`git tag demo-vN`, then `git push --tags`).
- Never commit secrets (`secrets.h`, `.env`) or raw audio (`*.wav`, `data/`). Raw audio stays in Edge Impulse.
- Change the MQTT contract in `protocol/README.md` first, in its own `protocol:` commit.

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

## Verified on our board (Ryan, commit 2b4ebf9)
- The kit camera mic works as ALSA device `plughw:CARD=Camera,DEV=0` on the powered hub. Its only mixer control is `Mic` (0–256, no automatic gain control). The boot default of 100 % (+16 dB) clips on room noise alone. 20 % (+3.2 dB) peaks around −10 dBFS on hackathon room noise, and `main.py` sets it at startup. `arecord` gives about 0.5 s of digital silence at the start of each capture.
- First live test: a phone playing a chaffinch at about 1 m, mic at 20 %. BirdNET gave `Fringilla coelebs` 0.59 and 0.72 in two windows, then `Human vocal` 0.56 when people talked. That's one controlled test, not an accuracy figure. Peaks reached −2 dBFS with no clipping, which is the worst case, so 20 % stays. Inference takes **0.26–0.32 s per 3 s window** (about 10× real time), so overlapping windows are affordable.
- SSH: the board's hostname is `Chirp`. On Junction Wi-Fi its IP was 10.0.41.148, which may change.
- BirdNET v2.4 (`BirdNET_GLOBAL_6K_V2.4_Model_FP32.tflite`) runs on the board through `ai_edge_litert`, 2 threads, on 3 s windows of 48 kHz mono S16_LE (288 000 bytes). Script: `unoq-app/python/bird_audio.py`. The model and runtime live in `~/chirp-test` on the board, not in git.
- The board is reachable over USB with Arduino's `adb.exe` (`%LOCALAPPDATA%\Arduino15\packages\arduino\tools\adb\32.0.0\adb.exe`) when Wi-Fi discovery fails.

## Still unverified
- Whether App Lab follows a symlink from `~/ArduinoApps/` into the repo clone. If it doesn't, use `tools/deploy.sh`.
- Whether the Atech microphone gives waveform samples (analogue output we can sample at 16 kHz or more, or I2S) or only a sound level. Read its datasheet or silkscreen.
- Whether App Lab installs `python/requirements.txt` (BirdNET needs `ai_edge_litert` and `numpy`). Check this on the board.
- BirdNET's sustained memory use and its behaviour over long runs.
- Whether App Lab's Python runtime can import `ai_edge_litert` (so far BirdNET has only run from an SSH shell, outside App Lab).
- The ModulinoBuzzer API (`tone(freq, ms)`?). Check the library examples before relying on it.
- The PlatformIO `board =` value for the Atech "2.2 frame" board (post-MVP).

## Environment
- The dev machines run Windows with PowerShell 5.1. There is no `&&` and no `unzip`, so give commands one per line or join them with `;`.
- The board is reachable over SSH as `arduino@<hostname>.local`. With the powered hub attached, App Lab reaches it over Wi-Fi (Network Mode).

<!-- AGENTS.md is an identical copy of this file. Edit both together. -->
