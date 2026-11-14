# Hardware

One Chirp station, as built and tested at Junction 2026.

## Bill of materials

| Item | Qty | Role |
|---|---|---|
| Arduino UNO Q (2 GB) | 1 | Linux side runs BirdNET; MCU side drives the LED matrix and Modulinos |
| Arduino USB Camera | 1 | Its built-in microphone is the station's mic (ALSA card `Camera`) |
| Arduino USB-C hub (8-in-1, TPX00241) | 1 | Powers the camera; needed for USB audio on the UNO Q |
| Anker A1259 power bank (or any USB-C PD bank) | 1 | Field power |
| Modulino Thermo | 1 | Air temperature logged with every listening window |
| Modulino Knob | 1 | Duty cycle: 100 / 50 / 25 / 10 % of each minute analysed (press = 100 %) |
| Modulino Buzzer | 1 | One short chirp per detection |
| 3D-printed enclosure | 1 | Base, lid with camera mast, Thermo radiation shield: see [`enclosure/`](enclosure/) |
| M3 self-tapping screws, velcro strap | some | Assembly and tree mounting |

## Wiring

| UNO Q | Connected to |
|---|---|
| USB-C | Hub (upstream); the hub's PD input goes to the power bank |
| Hub USB-A | Arduino USB Camera |
| Qwiic | Modulino chain: Thermo → Knob → Buzzer (any order; each is optional) |
| LED matrix | On-board (13 × 8) |

Each Modulino is detected once, when the sketch starts. After plugging one in, restart the app (`arduino-app-cli app stop user:chirp-station` then `start`).

## Enclosure

Parametric OpenSCAD model and ready-to-print STLs in [`enclosure/`](enclosure/): about 131 × 205 × 46 mm, three parts, no supports. Print settings and assembly steps are in its README.
