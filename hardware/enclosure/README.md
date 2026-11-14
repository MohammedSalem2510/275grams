# Chirp station enclosure

Parametric OpenSCAD model (`chirp_enclosure.scad`) with ready-to-print STLs. Outer size **132 × 143 × 47 mm**, so it fits any 220 × 220 mm bed.

| File | Part | Print orientation |
|---|---|---|
| `base.stl` | Tray: UNO Q standoffs, power-bank bay, hub rail, side vents, strap slots, charging notch | As exported, floor on the bed |
| `lid.stl` | Camera clamp mast, Knob + Buzzer mounts with Qwiic slots, camera cable slot, locating lip | As exported, already flipped (top face on the bed) |
| `shield.stl` | Louvred radiation shield for Modulino Thermo | As exported, roof on the bed |

**Suggested settings:** PLA or PETG (PETG for outdoor use), 0.2 mm layers, 3 walls, 20 % infill, **no supports**.

## Before printing
- **Check the UNO Q hole positions.** The model uses the standard UNO R3 pattern. Lay the board on a printed base or a paper template and adjust `uno_holes` if it doesn't line up.
- If a test print is tight, raise `clr` (default 1.0 mm) and export again. Nothing else needs changing.

## Assembly
1. **Power bank** (Anker A1259) goes flat in the left bay; its cable leaves through the front-left notch for charging.
2. **UNO Q** screws onto the four standoffs (M3 or M2.5 self-tapping), USB-C edge facing the back.
3. **Hub** lies along the back rail; its cable loops to the UNO Q's USB-C.
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
