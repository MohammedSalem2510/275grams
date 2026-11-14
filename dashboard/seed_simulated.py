"""Fill the simulated stations (sim-*) with 12 weeks of clearly labelled synthetic data.

Run from the repo root (re-running replaces the old synthetic rows):
    python -m dashboard.seed_simulated

Never touches live stations. Every window carries model_version "SIMULATED".
Synthetic windows are 60 s each (the contract allows up to 60 s), so one window is
one possible detection-minute per species.

Planted scenario for the early-warning demo: reed bunting at sim-3 (Laajalahti reeds)
falls to ~45 % of its usual activity over the last 2 weeks. Nothing else changes
beyond week-to-week noise, so it should be the only alert.
"""
import random
import sqlite3
from datetime import datetime, timedelta, timezone

from dashboard.server import DB_PATH, SCHEMA, STATIONS, utc

MODEL = "SIMULATED"
DAYS = 84
WINDOW_S = 60.0

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
        "decline": ("Emberiza schoeniclus_Reed Bunting", 14, 0.45),  # (species, last N days, factor)
    },
}


def bout_chance(base: float, peak: int, hour: float) -> float:
    """Song is likeliest near the peak hour and fades over ~2.5 h either side."""
    return base * max(0.15, 1 - abs(hour - peak) / 2.5)


def generate(station_id: str, site: dict, rng: random.Random, now: datetime):
    windows, detections = [], []
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    decline_sp, decline_days, decline_factor = site.get("decline", (None, 0, 1.0))
    weekly_mood: dict = {}  # natural week-to-week variation per species
    for day in range(DAYS, 0, -1):
        if day in site["offline_days"]:
            continue  # no listening at all: must show as missing effort, not as zero birds
        date = today - timedelta(days=day)
        for start_h, end_h in site["sessions"]:
            t, end = date + timedelta(hours=start_h), date + timedelta(hours=end_h)
            singing: dict[str, int] = {}  # species -> minutes left in the current song bout
            while t < end:
                wid = f"sim-{station_id}-{int(t.timestamp())}"
                windows.append((wid, station_id, utc(t), WINDOW_S, MODEL, utc(now)))
                hour = t.hour + t.minute / 60
                for sp, (base, peak) in site["species"].items():
                    mood = weekly_mood.setdefault((sp, day // 7), rng.uniform(0.85, 1.15))
                    factor = decline_factor if sp == decline_sp and day <= decline_days else 1.0
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
    rng = random.Random(275)  # same demo data on every laptop
    now = datetime.now(timezone.utc)
    with sqlite3.connect(DB_PATH) as c:
        c.executescript(SCHEMA)
        c.execute("DELETE FROM detections WHERE window_id IN (SELECT window_id FROM windows WHERE model_version = ?)", (MODEL,))
        c.execute("DELETE FROM windows WHERE model_version = ?", (MODEL,))
        for sid, site in SITES.items():
            windows, detections = generate(sid, site, rng, now)
            c.executemany("INSERT INTO windows VALUES (?,?,?,?,?,?)", windows)
            c.executemany("INSERT INTO detections VALUES (?,?,?)", detections)
            print(f"{sid}: {len(windows) * WINDOW_S / 3600:.0f} h listening, {len(detections)} detection-minutes")


if __name__ == "__main__":
    main()
