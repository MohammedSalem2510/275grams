# Chirp: Junction 2026, hardware track

Edge listening stations for ecologists. An **Arduino UNO Q** hears bird calls through the kit camera's mic, identifies them on the device with BirdNET, and uploads only the analysed results (plus a 3 s clip per accepted detection, never speech) to a laptop dashboard. The dashboard shows detections per listening hour on a map.

```
[camera mic] → UNO Q Linux (Python, BirdNET) ──Bridge RPC──► UNO Q MCU (LED matrix, Modulino Buzzer / Thermo / Knob)
                    │
                    │  HTTP over Wi-Fi (protocol/http.md)
                    ▼
       laptop: FastAPI + SQLite + map dashboard (dashboard/)
```

## Project document

[Google Doc](https://docs.google.com/document/d/1t4BtwcmLkrue99UclOt9XjlUw0V_pBga41g4tzjcazQ/edit?usp=sharing)

## Tested BirdNET demo on Chirp

With the USB webcam plugged into the powered hub, connect over SSH as `arduino` and run:

```sh
cd ~/chirp-test
PYTHONPATH=lib python3 bird_audio.py --device 'plughw:CARD=Camera,DEV=0' --windows 5
```

This uses the BirdNET v2.4 model and runtime installed on the team's UNO Q. Each line reports one three-second window. The default score threshold is 0.50. For a file test, replace the device argument with `--wav soundscape.wav` and set `--windows 40` for the full sample. WAV input uses mono 16-bit PCM at 48 kHz.

For the laptop upload GUI, connect the team's UNO Q directly by USB. From the repository root on Windows, run the following and open [localhost:8765](http://localhost:8765):

```powershell
python tools/listen_gui.py "$env:LOCALAPPDATA\Arduino15\packages\arduino\tools\adb\32.0.0\adb.exe"
```

The GUI sends audio to the board over ADB. The webcam command runs on the board over SSH. The model, runtime and example recording are installed separately on the board.

## Layout

| Folder | What | Owner |
|---|---|---|
| `unoq-app/` | App Lab app: `python/` (Linux side) + `sketch/` (MCU side). Must stay self-contained. | Python + C++ |
| `dashboard/` | Laptop backend (FastAPI, SQLite, audio evidence) and map dashboard | Python + JS |
| `protocol/` | HTTP contract between station and backend (`http.md`). Change it here first. | Everyone |
| `hardware/` | 3D-printed enclosure (OpenSCAD + STL), pinouts | Everyone |
| `docs/` | Pitch notes, demo script | Everyone |

## Rules

- Commit straight to `main` (`git pull --rebase` before pushing). Prefix messages with the subsystem (`kws:`, `mcu:`, `dashboard:`, `protocol:`, `hardware:`, `docs:`) and say if a change is untested on hardware.
- Tag every working full-system build: `git tag demo-vN && git push --tags`.
- Never commit secrets. Copy `*.example*` files and fill them in locally.

## Setup

### UNO Q (deploy target — one person owns the board)
```bash
ssh arduino@<unoq-hostname>.local
git clone <repo-url> ~/repo
ln -s ~/repo/unoq-app ~/ArduinoApps/chirp-station
echo http://<laptop-ip>:8000 > ~/repo/unoq-app/python/server_url.txt
```
Deploy = `cd ~/repo && git pull`, then `arduino-app-cli app stop user:chirp-station; arduino-app-cli app start user:chirp-station`.

USB mic goes into the **powered** USB-C hub (5 V 3 A). With the hub attached, App Lab connects over Wi-Fi.

### Laptop dashboard
The integrated map is served at the backend root. From the repo root, install dependencies with `python -m pip install -r dashboard/requirements.txt` and run `python -m uvicorn dashboard.server:app --host 0.0.0.0 --port 8000` (`0.0.0.0`, not `127.0.0.1`, or the UNO Q cannot upload). Open http://127.0.0.1:8000/. The station grid and all data controls work without a Google Maps key. To enable the Google basemap, copy `dashboard/static/maps-config.js` to `dashboard/static/maps-config.local.js` and paste a browser-restricted Maps JavaScript API key between the quotes in the local copy. Git ignores the local copy.
