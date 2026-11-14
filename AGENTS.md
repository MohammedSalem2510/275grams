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
1. ~~demo-v0 (stock check)~~: skipped, because demo-v1 proved the same things.
2. ✅ **demo-v1 (tagged 14 Nov):** Camera mic → BirdNET on Linux (`unoq-app/python/main.py`) → `Bridge.call(...)` → the MCU (`unoq-app/sketch/sketch.ino`) shows the detection on the LED matrix and plays a Modulino chirp.
3. ✅ **demo-v2 (tagged 14 Nov):** the UNO Q uploads each analysed window (recording ID, station, capture time, duration, predictions, clip) over HTTP to a **laptop backend**: FastAPI, SQLite, clips on disk, and a Leaflet dashboard with a local map-image fallback. Keep `detections` and analysed `listening` intervals in separate tables so rates are right from day one. Uploads retry with the same recording ID, so a retry never creates a duplicate. Full plan: `docs/implementation-plan.md`.
4. ~~Network of Atech ESP32 nodes~~: **dropped 14 Nov**. Their mics were never verified, and the code and MQTT contract are removed. Pitch it as future work ("cheap satellite nodes"), don't build it.
5. ✅ **`final` = `demo-v9` (tagged 14 Nov): the frozen submission build.** It's Ryan's `demo-v8` (`dashboard/station_uploads.py`) plus the submission README. The station code and HTTP contract are unchanged from Ryan's `f1348fc`: mic gain 20 %, top-1 BirdNET at 0.5, 3 s windows. The board runs that station code. It also serves the dashboard on its own **Chirp** hotspot (`http://10.42.0.1:8000/map.html`). If anything breaks, roll back to `final`.
   - Tried outdoors on 14 Nov and reverted, so they're not in `final`: mic gain at 60–100 % (still clipped 1–2 % on loud close sources), multi-label BirdNET at 0.25 (`722e18a`, which caught quieter birds), and overlapping 1.5 s windows (`33b462a`). Without a seasonal species filter, the station logged an out-of-season River Warbler. That's future work.
6. Stretch (not built): an on-demand camera livestream, human review states, multi-season trends on real data.

Now: the code is final. Only rehearse the demo (`docs/demo-script.md`). Change code only to fix a bug found in rehearsal, then tag the fix `demo-v10`.

## Hard rules
- `unoq-app/` must stay self-contained. App Lab compiles only `sketch/sketch.ino`, `sketch/*.h` and `sketch/sketch.yaml`, and runs `python/`. Nothing in it may reference files outside `unoq-app/`.
- Commit straight to `main`; no branches or PRs. Run `git pull --rebase` before every push.
- Prefix commit messages with the subsystem: `kws:`, `mcu:`, `node:`, `protocol:`, `docs:`. If a change hasn't been tested on real hardware, say so in the message.
- The last `demo-vN` tag is the known-good build. If `main` breaks, roll the board back to it.
- Tag every working full-system build `demo-vN` (`git tag demo-vN`, then `git push --tags`).
- Never commit secrets (`secrets.h`, `.env`) or raw audio (`*.wav`, `data/`). Raw audio stays in Edge Impulse.
- Change the HTTP contract in `protocol/http.md` first, in its own `protocol:` commit.

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
- **The full app runs in App Lab** (`user:chirp-station`): camera mic → BirdNET → `Bridge.call("bird_detected")`. Deploy:
  - The repo is cloned to `~/repo` on the board, and `~/ArduinoApps/chirp-station` is a symlink to `~/repo/unoq-app`. App Lab follows it.
  - To update: `cd ~/repo; git pull; arduino-app-cli app stop user:chirp-station; arduino-app-cli app start user:chirp-station`. Read logs with `arduino-app-cli app logs user:chirp-station --tail 40`.
- App Lab runs `python/` in a Docker container (`python-apps-base`, Python 3.13) that sees only the app folder as `/app`. It installs `python/requirements.txt` with uv, and `arecord`, `amixer` and the camera are available inside it.
- The model therefore has to sit at `unoq-app/models/birdnet/` on the board. It's gitignored, so copy it by hand: `cp ~/chirp-test/BirdNET_GLOBAL_6K_V2.4_{Labels.txt,Model_FP32.tflite} ~/repo/unoq-app/models/birdnet/`.
- Sketch profiles don't resolve library dependencies. Bridge needs `MsgPack` plus `DebugLog`, `ArxContainer` and `ArxTypeTraits` listed in `sketch.yaml`. The FQBN resolves to `arduino:zephyr:unoq` (platform 0.51.0).
- **The board uploads every analysed window to the laptop backend** (`dashboard/server.py`, contract `protocol/http.md`). To run it, from the repo root: `python -m uvicorn dashboard.server:app --host 0.0.0.0 --port 8000`. `SERVER` in `main.py` is the laptop's IP (10.0.39.120 on Junction Wi-Fi, which may change). Board → laptop connections work on Junction Wi-Fi.
- **Board-local settings:** the backend address lives in `unoq-app/python/server_url.txt` (gitignored). Never edit the IP in `main.py`: that blocks `git pull` on the board. Chirp Station is the board's **default app**, so it starts on boot (`arduino-app-cli properties set default user:chirp-station`).
- **Early warning:** `/api/alerts` compares the last 2 weeks with the previous 6 per station and species, counted in detection-minutes. The rule is in `protocol/http.md`. Run `python -m dashboard.seed_simulated` for 12 weeks of labelled synthetic data with one planted decline (Willow Tit, a year-round resident, at sim-5; migrants fade out before the alert window).
- **Modulinos verified 14 Nov:** Thermo (reads ~23.7 °C indoors), Knob (duty 100/50/25/10 %; press = 100 %) and Buzzer (`buzzer.tone(3800, 80)` chirps per detection) all work on the Qwiic chain. They're detected only at sketch start, so restart the app after plugging one in. At 50 % duty the station is deaf for half of every minute: keep 100 % for demos.
- **Dashboard map verified 14 Nov:** with a Maps key in `dashboard/static/maps-config.local.js` (gitignored), Street and Satellite (with Seun's 3D tilt) both work.
- **LED matrix:** each detection shows the static Lil' Birb (CC0) bird for 1 s. A flapping animation was tried and dropped from scope on 14 Nov (the buzzer stopped working on that build; cause not isolated). The duty bar shows for 3 s after a Knob change, then the matrix goes dark.
- **Dashboard times** are shown in Helsinki time (`Europe/Helsinki`); the backend stores UTC.
- **Audio evidence:** each accepted detection's 3 s WAV is PUT to `/api/evidence/{window_id}` after its window uploads, and the dashboard plays it inline. Clips are stored in `dashboard/evidence/` on the laptop (gitignored).
- SSH: the board's hostname is `Chirp`. On Junction Wi-Fi its IP was 10.0.41.148, which may change.
- BirdNET v2.4 (`BirdNET_GLOBAL_6K_V2.4_Model_FP32.tflite`) runs on the board through `ai_edge_litert`, 2 threads, on 3 s windows of 48 kHz mono S16_LE (288 000 bytes). Script: `unoq-app/python/bird_audio.py`. The model and runtime live in `~/chirp-test` on the board, not in git.
- The board is reachable over USB with Arduino's `adb.exe` (`%LOCALAPPDATA%\Arduino15\packages\arduino\tools\adb\32.0.0\adb.exe`) when Wi-Fi discovery fails.

## Still unverified
- BirdNET's sustained memory use and its behaviour over long runs.

## Environment
- The dev machines run Windows with PowerShell 5.1. There is no `&&` and no `unzip`, so give commands one per line or join them with `;`.
- The board is reachable over SSH as `arduino@<hostname>.local`. With the powered hub attached, App Lab reaches it over Wi-Fi (Network Mode).

<!-- AGENTS.md is an identical copy of this file. Edit both together. -->
