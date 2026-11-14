"""Fill the simulated stations (sim-*) with 12 weeks of clearly labelled synthetic data.

Run from the repo root (re-running replaces the old synthetic rows):
    python -m dashboard.seed_simulated

Never touches live stations. Every window carries model_version "SIMULATED".
Synthetic windows are 60 s each (the contract allows up to 60 s), so one window is
one possible detection-minute per species.

Planted scenario for the early-warning demo: Willow Tit at sim-5 (Espoo Central Park), a
year-round resident that really is declining in Finland, falls to ~45 % of its usual activity
over the last 2 weeks. Nothing else changes beyond week-to-week noise, so it should be the
only alert.

The 12 weeks run from late August to today (mid-November), so summer migrants fade out
(MIGRANTS). They're gone, or down to a steady overwintering remnant, before the 8-week alert
window starts, so migration never shows up as a decline. A real deployment needs same-season
baselines from earlier years for that (protocol/http.md).
"""
import math
import random
import sqlite3
from datetime import datetime, timedelta, timezone

from dashboard.server import DB_PATH, INSERT_WINDOW, NEW_COLUMNS, SCHEMA, STATIONS, utc

MODEL = "SIMULATED"
DAYS = 84
WINDOW_S = 60.0

# Species that leave Finland in autumn: (fade starts, gone by) in days ago, and the share that
# overwinters. Every fade ends before day 56, outside the 2 + 6 week alert comparison.
MIGRANTS = {
    "Acrocephalus schoenobaenus_Sedge Warbler": (80, 62, 0.0),
    "Phylloscopus trochilus_Willow Warbler": (76, 60, 0.0),
    "Grus grus_Common Crane": (72, 58, 0.0),
    "Emberiza schoeniclus_Reed Bunting": (74, 58, 0.0),
    "Fringilla coelebs_Common Chaffinch": (76, 58, 0.0),
    "Erithacus rubecula_European Robin": (74, 58, 0.0),
    "Larus canus_Common Gull": (70, 58, 0.35),
}


def presence(species: str, days_ago: int) -> float:
    """1 while a migrant is here, then a linear fade to its overwintering share."""
    if species not in MIGRANTS:
        return 1.0
    start, gone, stays = MIGRANTS[species]
    if days_ago >= start:
        return 1.0
    if days_ago <= gone:
        return stays
    return stays + (1 - stays) * (days_ago - gone) / (start - gone)

# Per station: listening sessions in UTC hours (Finland is UTC+2 in November), days ago the
# station was "offline", and species -> (song-bout start chance per minute, peak UTC hour).
SITES = {
    "sim-2": {  # woods: dawn chorus of woodland songbirds
        "sessions": [(2, 8)],
        "offline_days": {4, 23, 51},
        "species": {
            "Fringilla coelebs_Common Chaffinch": (0.08, 3),
            "Parus major_Great Tit": (0.06, 3),
            "Erithacus rubecula_European Robin": (0.05, 2),
            "Phylloscopus trochilus_Willow Warbler": (0.04, 4),
            "Turdus merula_Eurasian Blackbird": (0.03, 2),
            "Cyanistes caeruleus_Eurasian Blue Tit": (0.03, 5),
        },
    },
    "sim-3": {  # reeds: wetland birds, morning and evening sessions
        "sessions": [(3, 7), (15, 17)],
        "offline_days": {2, 30, 66},
        "species": {
            "Emberiza schoeniclus_Reed Bunting": (0.07, 4),
            "Acrocephalus schoenobaenus_Sedge Warbler": (0.06, 4),
            "Larus canus_Common Gull": (0.04, 16),
            "Grus grus_Common Crane": (0.015, 5),
            "Fringilla coelebs_Common Chaffinch": (0.015, 4),
        },
    },
    "sim-4": {
        "sessions": [(6, 9), (14, 17)],
        "offline_days": {7, 36},
        "species": {
            "Larus canus_Common Gull": (0.15, 15),
            "Anas platyrhynchos_Mallard": (0.07, 7),
        },
    },
    "sim-5": {
        "sessions": [(4, 9)],
        "offline_days": {8, 40},
        "species": {
            "Dendrocopos major_Great Spotted Woodpecker": (0.025, 7),
            "Parus major_Great Tit": (0.035, 6),
            "Poecile montanus_Willow Tit": (0.06, 6),
            "Erithacus rubecula_European Robin": (0.02, 5),
        },
        "decline": ("Poecile montanus_Willow Tit", 14, 0.45),  # (species, last N days, factor)
    },
    "sim-6": {
        "sessions": [(6, 10), (12, 15)],
        "offline_days": {3, 27},
        "species": {
            "Passer montanus_Eurasian Tree Sparrow": (0.18, 8),
            "Cyanistes caeruleus_Eurasian Blue Tit": (0.12, 13),
            "Turdus merula_Eurasian Blackbird": (0.07, 7),
        },
    },
    "sim-7": {
        "sessions": [(5, 9), (13, 16)],
        "offline_days": {5, 61},
        "species": {
            "Turdus merula_Eurasian Blackbird": (0.08, 6),
            "Parus major_Great Tit": (0.07, 14),
            "Pica pica_Eurasian Magpie": (0.04, 8),
        },
    },
}


def temperature(days_ago: int, hour: float, day_noise: float) -> float:
    """Espoo autumn: daily mean falls from ~15 C (late Aug) to ~2 C (mid Nov), +-2 C daily cycle."""
    mean = 2 + 13 * days_ago / DAYS
    return round(mean + 2 * math.sin((hour - 7) / 24 * 2 * math.pi) + day_noise, 1)


def bout_chance(base: float, peak: int, hour: float) -> float:
    """Song is likeliest near the peak hour and fades over ~2.5 h either side."""
    return base * max(0.15, 1 - abs(hour - peak) / 2.5)


def generate(station_id: str, site: dict, rng: random.Random, now: datetime):
    windows, detections = [], []
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    decline_sp, decline_days, decline_factor = site.get("decline", (None, 0, 1.0))
    weekly_mood: dict = {}  # natural week-to-week variation per species
    for day in range(DAYS, -1, -1):
        if day in site["offline_days"]:
            continue  # no listening at all: must show as missing effort, not as zero birds
        date = today - timedelta(days=day)
        day_noise = rng.uniform(-2.5, 2.5)
        for start_h, end_h in site["sessions"]:
            t, end = date + timedelta(hours=start_h), date + timedelta(hours=end_h)
            singing: dict[str, int] = {}  # species -> minutes left in the current song bout
            end = min(end, now)
            while t + timedelta(seconds=WINDOW_S) <= end:
                wid = f"sim-{station_id}-{int(t.timestamp())}"
                hour = t.hour + t.minute / 60
                windows.append((wid, station_id, utc(t), WINDOW_S, MODEL, utc(now),
                                temperature(day, hour, day_noise), 1.0, None, None))
                for sp, (base, peak) in site["species"].items():
                    mood = weekly_mood.setdefault((sp, day // 7), rng.uniform(0.95, 1.05))
                    factor = decline_factor if sp == decline_sp and day <= decline_days else 1.0
                    factor *= presence(sp, day)
                    if sp not in singing and rng.random() < bout_chance(base, peak, hour) * mood * factor:
                        singing[sp] = rng.randint(1, 4)  # one bird repeating: several minutes
                for sp in singing:
                    if rng.random() < 0.8:  # not every minute of a bout is detected
                        detections.append((wid, sp, round(rng.uniform(0.5, 0.95), 3)))
                singing = {k: v - 1 for k, v in singing.items() if v > 1}
                t += timedelta(seconds=WINDOW_S)
    return windows, detections


def main():
    sim_ids = {s["station_id"] for s in STATIONS if s["simulated"]}
    unknown = set(SITES) - sim_ids
    if unknown:
        raise SystemExit(f"refusing: {sorted(unknown)} not marked simulated in stations.json")
    now = datetime.now(timezone.utc)
    with sqlite3.connect(DB_PATH) as c:
        c.executescript(SCHEMA)
        have = {row[1] for row in c.execute("PRAGMA table_info(windows)")}
        for name, kind in NEW_COLUMNS.items():
            if name not in have:
                c.execute(f"ALTER TABLE windows ADD COLUMN {name} {kind}")
        c.execute("DELETE FROM detections WHERE window_id IN (SELECT window_id FROM windows WHERE model_version = ?)", (MODEL,))
        c.execute("DELETE FROM windows WHERE model_version = ?", (MODEL,))
        for sid, site in SITES.items():
            # One fixed stream per station: the same demo data on every machine and at any time of
            # day (only today's unfinished session varies, and it comes last in each stream).
            windows, detections = generate(sid, site, random.Random(f"275-{sid}"), now)
            c.executemany(INSERT_WINDOW, windows)
            c.executemany("INSERT INTO detections VALUES (?,?,?)", detections)
            print(f"{sid}: {len(windows) * WINDOW_S / 3600:.0f} h listening, {len(detections)} detection-minutes")


if __name__ == "__main__":
    main()
