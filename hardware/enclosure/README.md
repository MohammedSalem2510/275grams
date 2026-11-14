# Chirp station enclosure

Parametric OpenSCAD model (`chirp_enclosure.scad`) with ready-to-print STLs. Outer size **132 × 175 × 47 mm** (base + lid), so it fits any 220 × 220 mm bed.

| File | Part | Print orientation |
|---|---|---|
| `base.stl` | Tray: UNO Q standoffs, power-bank bay, hub rail, side vents, strap slots, charging notch | As exported, floor on the bed |
| `lid.stl` | Camera clamp mast, Knob + Buzzer mounts with Qwiic slots, camera cable slot, locating lip | As exported, already flipped (top face on the bed) |
| `shield.stl` | Louvred radiation shield for Modulino Thermo | As exported, roof on the bed |
| `fit_test.stl` | **Print this first:** just the floor, UNO Q posts and rails, a few mm tall | As exported |

**Suggested settings:** PLA or PETG (PETG for outdoor use), 0.2 mm layers, 3 walls, 20 % infill, **no supports**.

## Before printing
- **Print `fit_test.stl` first.** It's the base's floor, posts and rails only. Lay the UNO Q on its posts, and the power bank and hub in their places. The model uses the standard UNO R3 hole pattern; if the holes don't line up, adjust `uno_holes` and export again.
- UNO Q posts are 6 mm tall because the board has connectors on its underside.
- If a test print is tight, raise `clr` (default 1.0 mm) and export again. Nothing else needs changing.

## Assembly
1. **Power bank** (Anker A1259) goes flat in the left bay; its cable leaves through the front-left notch for charging.
2. **UNO Q** screws onto the four standoffs (M3 or M2.5 self-tapping), USB-C edge facing the back.
3. **Hub** lies along the back rail **with the ports you use facing forward**, into the 32 mm plug gap. Ports facing the back wall have no room for a plug. Its cable loops to the UNO Q's USB-C.
4. **Lid:** Knob and Buzzer screw onto their bosses; their Qwiic cables drop through the slots underneath. Four M3 screws hold the lid to the corner bosses.
5. **Camera** clamps onto the lid's mast; its USB cable goes through the slot beside it to the hub. Pull a sock or foam over the camera as a windshield.
6. **Thermo** screws into the shield. The shield bolts to the base's right wall (two M3), with its Qwiic cable through the wall slot. Keeping it shaded and ventilated means it reads the air, not the sun or the electronics.
7. **Mount:** thread a velcro strap or zip ties through the back slots and round a tree trunk.

To export after editing (Bash quoting shown; in PowerShell use `--%`):
```
openscad -D 'part="base"' -o base.stl chirp_enclosure.scad
openscad -D 'part="lid"' -o lid.stl chirp_enclosure.scad
openscad -D 'part="shield"' -o shield.stl chirp_enclosure.scad
```

## Checks done
- Every part renders as a single solid (no loose posts).
- Interference checks in OpenSCAD: the seated lid doesn't overlap the base (its lip is notched round the corner screw posts), and the shield's bolt heads clear the Thermo posts. A control check confirmed the un-notched lid does clash, so the test detects real problems.
- UNO Q holes: the team measured about 5 cm (far pair) and just under 3 cm (near pair) with a ruler, which matches the model's 48.3 mm and 27.9 mm. Confirm on the fit test.
- A 32 mm plug gap (`plug_room`) sits between the power bank / UNO Q and the hub for USB plugs and cable bends.
- Not checked: real-world cable routing.
