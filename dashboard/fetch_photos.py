"""Pre-fetch bird photos so the dashboard works offline at the demo.

Run from the repo root:  python -m dashboard.fetch_photos [extra BirdNET labels or scientific names...]
Fetches a photo for every species already in chirp.db, plus any given on the command line.
"""
import sqlite3
import sys

from dashboard import photos
from dashboard.server import DB_PATH

DEMO = ["Parus major_Great Tit", "Poecile montanus_Willow Tit", "Regulus regulus_Goldcrest",
        "Dendrocopos major_Great Spotted Woodpecker", "Fringilla coelebs_Common Chaffinch"]


def main():
    with sqlite3.connect(DB_PATH) as c:
        labels = [r[0] for r in c.execute("SELECT DISTINCT species FROM detections")]
    labels = sorted(set(labels) | set(DEMO) | set(sys.argv[1:]))
    ok = missing = failed = 0
    for label in labels:
        try:
            meta = photos.photo(label)
        except photos.Unreachable as e:
            failed += 1
            print(f"  unreachable  {label}: {e}")
            continue
        if meta["available"]:
            ok += 1
        else:
            missing += 1
            print(f"  no photo     {label}")
    print(f"{ok} photos cached, {missing} without a usable photo, {failed} failed (re-run to retry)")


if __name__ == "__main__":
    main()
