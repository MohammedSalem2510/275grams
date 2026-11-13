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

## Layout

| Folder | What | Owner |
|---|---|---|
| `unoq-app/` | App Lab app: `python/` (Linux side) + `sketch/` (MCU side). Must stay self-contained. | Python + C++ |
| `atech-node/` | PlatformIO firmware for both ESP32 nodes (`-e node1` / `-e node2`) | C++ |
| `protocol/` | MQTT topics + JSON schema — the contract. Change it here first. | Everyone |
| `hardware/` | Pinouts, wiring photos, BOM | Everyone |
| `docs/` | Pitch notes, demo script | Everyone |

## Rules

- `main` always runs the demo. Work on branches: `kws/…`, `mcu/…`, `node/…`, `protocol/…`.
- Merge via PR. Self-merge is fine, but only after testing on real hardware.
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
