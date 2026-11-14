"""Fill the simulated stations (sim-*) with a week of clearly labelled synthetic data.

Run from the repo root (re-running replaces the old synthetic rows):
    python -m dashboard.seed_simulated

Never touches live stations. Every window carries model_version "SIMULATED".
"""
import random
import sqlite3
from datetime import datetime, timedelta, timezone

from dashboard.server import DB_PATH, SCHEMA, STATIONS, utc

MODEL = "SIMULATED"
DAYS = 7
WINDOW_S = 3.0

# Per station: listening sessions in UTC hours (Finland is UTC+2 in November),
# days the station was "offline", and species -> (song-bout start chance per window, peak UTC hour).
SITES = {
    "sim-2": {  # woods: dawn chorus of woodland songbirds
        "sessions": [(2, 8)],
        "offline_days": {4},
        "species": {
            "Fringilla coelebs_Common Chaffinch": (0.010, 3),
            "Parus major_Great Tit": (0.008, 3),
            "Erithacus rubecula_European Robin": (0.006, 2),
            "Phylloscopus trochilus_Willow Warbler": (0.005, 4),
            "Turdus merula_Eurasian Blackbird": (0.004, 2),
            "Cyanistes caeruleus_Eurasian Blue Tit": (0.003, 5),
        },
    },
    "sim-3": {  # reeds: wetland birds, morning and evening sessions
        "sessions": [(3, 7), (15, 17)],
        "offline_days": {2},
        "species": {
            "Emberiza schoeniclus_Reed Bunting": (0.008, 4),
            "Acrocephalus schoenobaenus_Sedge Warbler": (0.007, 4),
            "Larus canus_Common Gull": (0.005, 16),
            "Grus grus_Common Crane": (0.002, 5),
            "Fringilla coelebs_Common Chaffinch": (0.002, 4),
        },
    },
}


def bout_chance(base: float, peak: int, hour: float) -> float:
    """Song is likeliest near the peak hour and fades over ~2 h either side."""
    return base * max(0.15, 1 - abs(hour - peak) / 2.5)


def generate(station_id: str, site: dict, rng: random.Random, now: datetime):
    windows, detections = [], []
    today = now.replace(hour=0, minute=0, second=0, microsecond=0)
    for day in range(DAYS, 0, -1):
        if day in site["offline_days"]:
            continue  # no listening at all: must show as missing effort, not as zero birds
        date = today - timedelta(days=day)
        for start_h, end_h in site["sessions"]:
            t, end = date + timedelta(hours=start_h), date + timedelta(hours=end_h)
            singing: dict[str, int] = {}  # species -> windows left in the current song bout
            while t < end:
                wid = f"sim-{station_id}-{int(t.timestamp() * 10)}"
                windows.append((wid, station_id, utc(t), WINDOW_S, MODEL, utc(now)))
                hour = t.hour + t.minute / 60
                for sp, (base, peak) in site["species"].items():
                    if sp not in singing and rng.random() < bout_chance(base, peak, hour):
                        singing[sp] = rng.randint(2, 12)  # one bird repeats: several detections
                if singing:
                    # BirdNET keeps one top label per window; pick among birds singing now.
                    sp = rng.choice(sorted(singing))
                    if rng.random() < 0.75:  # not every window of a bout is detected
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
            print(f"{sid}: {len(windows) * WINDOW_S / 3600:.1f} h listening, {len(detections)} detections")


if __name__ == "__main__":
    main()
