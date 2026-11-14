// Chirp field station enclosure: base, lid and Thermo radiation shield.
// Parametric OpenSCAD. Export each part with:  openscad -D 'part="base"' -o base.stl chirp_enclosure.scad
//
// Sources for part sizes (mm):
//   UNO Q 68.85 x 53.34 (UNO footprint), height 15 measured by the team
//   Arduino USB-C Hub (8-in-1) TPX00241: 119 x 27.8 x 16, 175 mm cable
//   Anker A1259 power bank: 100 x 60 x 25 (measured)
//   Modulino: 41 x 25.36, holes 3.2 mm on a 32 x 16 grid
//   Arduino USB Camera: clamp-style, clips onto the lid mast
// CHECK the UNO hole positions against the real board before printing the base.

part = "all";          // "base" | "lid" | "shield" | "fit_test" | "all" (preview layout)

/* [Print] */
wall = 2.4;            // 6 perimeters at 0.4 mm nozzle
floor_t = 2.4;
clr = 1.0;             // clearance around every part; raise if the first print is tight
lid_t = 3.0;
lip = 4.0;             // depth of the lid's locating lip
fit = 0.4;             // lid-lip to wall gap
$fn = 40;

/* [Parts] */
uno = [68.85, 53.34, 15];   // L (USB-C edge at x=0), W, H with components
uno_holes = [[14.0, 2.54], [15.24, 50.8], [66.04, 7.62], [66.04, 35.56]];  // UNO R3 pattern
standoff_h = 6;             // the UNO Q has connectors on its underside
hub = [119, 27.8, 16];
bank = [60, 100, 25];       // lying flat: 60 wide (x), 100 deep (y)
modulino = [41, 25.36];
mod_hole = [32, 16];
pilot = 2.6;                // self-tapping M3 / M2.5 pilot

/* [Thermo shield joint, heights from the bottom edge of base and shield] */
shield_bolt_z = 40;         // above the Thermo board, below the shield roof
shield_qwiic_z = 22;

/* [Branding] */
product_name = "chirp";
team_name = "275grams";
label_size = 10;            // cap height, mm
label_depth = 0.8;          // engraved: prints cleanly face-down, no supports
label_font = "Liberation Sans:style=Bold";  // bundled with OpenSCAD

/* [Interior layout] */
gap = 8;
plug_room = 32;             // USB plug + moulding + cable bend, between the front parts and the hub
hub_back_room = 0;          // set to 32 if a port you use is on the hub's BACK side (base grows ~32 mm deeper)
bank_pos = [0, 0];
uno_pos = [bank[0] + gap, 0];                                   // rotated: USB-C faces the back
hub_pos = [0, max(bank[1], uno[0]) + plug_room + gap];          // room for the power-bank and UNO Q plugs
inner = [max(uno_pos[0] + uno[1], hub[0]) + 2 * clr + 4,
         hub_pos[1] + hub[1] + hub_back_room + 2 * clr,
         42];                                                   // height leaves room for cables
outer = [inner[0] + 2 * wall, inner[1] + 2 * wall, inner[2] + floor_t];

module rounded_box(size, r = 3) {
  hull() for (x = [r, size[0] - r], y = [r, size[1] - r])
    translate([x, y, 0]) cylinder(r = r, h = size[2]);
}

module boss(h, d = 7, hole = pilot) {
  // starts 0.2 mm below its base so it fuses with the surface instead of just touching it
  difference() { translate([0, 0, -0.2]) cylinder(d = d, h = h + 0.2); translate([0, 0, 1]) cylinder(d = hole, h = h); }
}

// ---------------- BASE ----------------
corner_boss = [[6, 6], [outer[0] - 6, 6], [6, outer[1] - 6], [outer[0] - 6, outer[1] - 6]];

module base() {
  o = [wall + clr, wall + clr, floor_t];  // interior origin
  difference() {
    rounded_box(outer);
    translate([wall, wall, floor_t]) cube([inner[0], inner[1], inner[2] + 1]);
    // side vents (upper half, both sides), keep electronics cool
    for (side = [0, 1], i = [0 : 5])
      translate([side ? outer[0] - wall - 1 : -1, 25 + i * 14, outer[2] - 18])
        cube([wall + 2, 7, 12]);
    // charging / power-bank cable notch, front-left
    translate([wall + 8, -1, floor_t + 4]) cube([16, wall + 2, 10]);
    // strap slots on the back wall: thread velcro or zip ties round a trunk
    for (x = [outer[0] * 0.25, outer[0] * 0.75], z = [10, outer[2] - 12])
      translate([x - 13, outer[1] - wall - 1, z]) cube([26, wall + 2, 5]);
    // Qwiic + bolt holes for the Thermo shield on the right wall
    translate([outer[0] - wall - 1, outer[1] / 2 - 6, shield_qwiic_z]) cube([wall + 2, 12, 6]);
    for (dy = [-15, 15])
      translate([outer[0] - wall - 1, outer[1] / 2 + dy, shield_bolt_z]) rotate([0, 90, 0]) cylinder(d = 3.4, h = wall + 2);
  }
  // corner bosses for the lid screws
  for (p = corner_boss) translate([p[0], p[1], floor_t]) boss(inner[2] - 0.2, 8);
  // UNO Q standoffs (board rotated 90 deg: USB-C edge faces the hub at the back)
  for (h = uno_holes)
    translate([o[0] + uno_pos[0] + h[1], o[1] + uno_pos[1] + (uno[0] - h[0]), floor_t]) boss(standoff_h, 6);
  // low locating rails for the power bank and hub
  translate([o[0] + bank[0] + 1, o[1], floor_t - 0.2]) cube([2, bank[1], 5.2]);
  translate([o[0], o[1] + hub_pos[1] - 3, floor_t - 0.2]) cube([hub[0], 2, 5.2]);
}

// ---------------- LID ----------------
mast = [40, 8, 35];          // the camera clamp grips this fin
knob_at = [outer[0] * 0.30, outer[1] * 0.40];
buzz_at = [outer[0] * 0.70, outer[1] * 0.40];

module modulino_mount(at) {
  translate([at[0], at[1], lid_t]) {
    for (sx = [-1, 1], sy = [-1, 1]) translate([sx * mod_hole[0] / 2, sy * mod_hole[1] / 2, 0]) boss(5, 6);
  }
}

module lid() {
  difference() {
    union() {
      rounded_box([outer[0], outer[1], lid_t]);
      // locating lip that drops inside the walls
      difference() {
        translate([wall + fit, wall + fit, -lip]) difference() {
          cube([inner[0] - 2 * fit, inner[1] - 2 * fit, lip]);
          translate([2, 2, -1]) cube([inner[0] - 2 * fit - 4, inner[1] - 2 * fit - 4, lip + 2]);
        }
        // notches so the lip clears the corner screw posts and the lid seats fully
        for (p = corner_boss) translate([p[0], p[1], -lip - 1]) cylinder(d = 8 + 2 * fit + 1, h = lip + 1);
      }
      // camera mast at the back
      translate([(outer[0] - mast[0]) / 2, outer[1] - 22, lid_t - 0.2]) cube(mast + [0, 0, 0.2]);
    }
    for (p = corner_boss) translate([p[0], p[1], -lip - 1]) cylinder(d = 3.4, h = lid_t + lip + 2);
    // camera USB cable slot beside the mast
    translate([(outer[0] + mast[0]) / 2 + 6, outer[1] - 24, -lip - 1]) cube([14, 9, lid_t + lip + 2]);
    // Qwiic pass-throughs under each Modulino
    for (at = [knob_at, buzz_at]) translate([at[0] - 6, at[1] - 3, -lip - 1]) cube([12, 6, lid_t + lip + 2]);
    // team name engraved into the top face, front edge, clear of the Modulinos
    translate([outer[0] / 2, 22, lid_t - label_depth])
      linear_extrude(label_depth + 1)
        text(str(product_name, "  ·  ", team_name), size = label_size, font = label_font,
             halign = "center", valign = "center");
  }
  modulino_mount(knob_at);
  modulino_mount(buzz_at);
}

// ---------------- THERMO RADIATION SHIELD ----------------
// Shaded but ventilated, like a weather-station screen: solid roof, slotted walls,
// open bottom. Bolts to the base's right wall; Thermo sits on four bosses inside.
shield = [50, 34, 46];
module shield() {
  difference() {
    union() {
      difference() {
        cube(shield);
        translate([wall, wall, -1]) cube([shield[0] - 2 * wall, shield[1] - 2 * wall, shield[2] - wall + 1]);  // keeps the back wall
        // vertical gill slots on the three exposed sides
        for (i = [0 : 4]) translate([7 + i * 8, -1, 8]) cube([4, wall + 2, shield[2] - 18]);
        for (side = [0, 1], i = [0 : 2])
          translate([side ? shield[0] - wall - 1 : -1, 6 + i * 8, 8]) cube([wall + 2, 4, shield[2] - 18]);
      }
      // overhanging roof keeps sun and rain off
      translate([-4, -4, shield[2] - wall]) cube([shield[0] + 8, shield[1] + 4, wall]);
    }
    // back face bolts + Qwiic slot (match the base's right wall)
    for (dx = [-15, 15]) translate([shield[0] / 2 + dx, shield[1] + 1, shield_bolt_z]) rotate([90, 0, 0]) cylinder(d = 3.4, h = wall + 2);
    translate([shield[0] / 2 - 6, shield[1] - wall - 1, shield_qwiic_z]) cube([12, wall + 2, 6]);
  }
  // Thermo bosses on the back face, board vertical
  translate([shield[0] / 2, shield[1] - wall, 22]) rotate([90, 0, 0])
    for (sx = [-1, 1], sy = [-1, 1]) translate([sx * mod_hole[0] / 2, sy * mod_hole[1] / 2, 0]) boss(5, 6);
}

// ---------------- LAYOUT ----------------
if (part == "base") base();
else if (part == "fit_test") intersection() { base(); cube([outer[0], outer[1], floor_t + standoff_h]); }  // quick check of UNO holes + layout
else if (part == "lid") translate([0, 0, lid_t]) rotate([180, 0, 0]) translate([0, -outer[1], 0]) lid();  // print upside down
else if (part == "shield") translate([0, 0, shield[2]]) rotate([180, 0, 0]) translate([0, -shield[1], 0]) shield();  // roof on the bed
else if (part == "all") {
  base();
  translate([0, 0, outer[2] + 25]) lid();
  translate([outer[0] + 25, outer[1] / 2 - shield[1] / 2, 0]) shield();
}

echo(str("Outer size (mm): ", outer[0], " x ", outer[1], " x ", outer[2] + lid_t));
