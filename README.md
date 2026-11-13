# Junction 2026 — Hardware Track

On-device voice control on an **Arduino UNO Q**, with two **ESP32-based Atech boards** as wireless sensor nodes over MQTT.

```
[USB mic] → UNO Q Linux (Python, keyword spotting) ──Bridge RPC──► UNO Q MCU (sketch: actuators, Modulinos)
                    │
                Mosquitto broker
                    │  MQTT over Wi-Fi (2.4 GHz hotspot)
          ┌─────────┴─────────┐
     Atech node 1        Atech node 2
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

The GUI sends audio to the board over ADB. The webcam command runs on the board over SSH. App Lab still launches the stock keyword example. The model, runtime and example recording are installed separately on the board.

## Layout

| Folder | What | Owner |
|---|---|---|
| `unoq-app/` | App Lab app: `python/` (Linux side) + `sketch/` (MCU side). Must stay self-contained. | Python + C++ |
| `atech-node/` | PlatformIO firmware for both ESP32 nodes (`-e node1` / `-e node2`) | C++ |
| `protocol/` | MQTT topics + JSON schema — the contract. Change it here first. | Everyone |
| `hardware/` | Pinouts, wiring photos, BOM | Everyone |
| `docs/` | Pitch notes, demo script | Everyone |

## Rules

- Commit straight to `main` (`git pull --rebase` before pushing). Prefix messages with the subsystem (`kws:`, `mcu:`, `node:`, `protocol:`, `docs:`) and say if a change is untested on hardware.
- Tag every working full-system build: `git tag demo-vN && git push --tags`.
- Never commit secrets. Copy `*.example*` files and fill them in locally.

## Setup

### UNO Q (deploy target — one person owns the board)
```bash
ssh arduino@<unoq-hostname>.local
git clone <repo-url> ~/repo
ln -s ~/repo/unoq-app ~/ArduinoApps/junction-app   # if App Lab ignores symlinks, rsync instead
sudo apt install -y mosquitto mosquitto-clients
```
Deploy = `cd ~/repo && git pull`, then run the app from App Lab.

USB mic goes into the **powered** USB-C hub (5 V 3 A). With the hub attached, App Lab connects over Wi-Fi.

### ESP32 nodes
```bash
cd atech-node
cp include/secrets.example.h include/secrets.h   # fill in Wi-Fi + broker hostname
pio run -e node1 -t upload
pio run -e node2 -t upload
```
iPhone hotspot: turn on **Maximise Compatibility** (the ESP32 is 2.4 GHz only).

### Debug the bus
```bash
mosquitto_sub -h <unoq-hostname>.local -t '#' -v
```
