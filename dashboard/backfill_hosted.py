"""Copy this laptop's real station history (windows, detections, evidence clips) to the hosted dashboard.

Run from the repo root, with the hosted URL and the station token from Railway:
    $env:CHIRP_STATION_TOKEN = "<token>"        (PowerShell; never put the token in git)
    python -m dashboard.backfill_hosted https://<your-app>.up.railway.app

Safe to re-run: the server ignores window_ids it already has, and re-sending a clip overwrites it.
Simulated stations are never copied; the hosted site seeds its own labelled demo data.
"""
import json
import os
import sqlite3
import sys
import urllib.error
import urllib.request

from dashboard.server import DB_PATH, EVIDENCE_DIR, LIVE_IDS

BATCH = 500  # the contract allows 1-500 windows per request


def send(url: str, body: bytes, headers: dict, method: str = "POST") -> int:
    req = urllib.request.Request(url, body, headers, method=method)
    try:
        with urllib.request.urlopen(req, timeout=60) as r:
            return r.status
    except urllib.error.HTTPError as e:
        return e.code


def main():
    if len(sys.argv) != 2 or not sys.argv[1].startswith(("https://", "http://127.0.0.1")):  # local = testing
        raise SystemExit("usage: python -m dashboard.backfill_hosted https://<hosted-dashboard>")
    base, token = sys.argv[1].rstrip("/"), os.environ.get("CHIRP_STATION_TOKEN", "")
    if not token:
        raise SystemExit("set CHIRP_STATION_TOKEN to the Railway service's station token first")
    auth = {"Authorization": f"Bearer {token}"}
    c = sqlite3.connect(DB_PATH)
    c.row_factory = sqlite3.Row
    marks = ",".join("?" * len(LIVE_IDS))
    rows = c.execute(f"SELECT * FROM windows WHERE station_id IN ({marks}) ORDER BY start_utc", sorted(LIVE_IDS)).fetchall()
    found: dict[str, list] = {}
    for d in c.execute("SELECT window_id, species, score FROM detections"):
        found.setdefault(d["window_id"], []).append({"species": d["species"], "score": d["score"]})
    windows = [{"window_id": r["window_id"], "station_id": r["station_id"], "start": r["start_utc"],
                "duration_s": r["duration_s"], "model_version": r["model_version"],
                "detections": found.get(r["window_id"], []), "temperature_c": r["temperature_c"],
                "duty": r["duty"], "clip": r["clip"], "clip_offset_s": r["clip_offset_s"]} for r in rows]
    print(f"{len(windows)} real windows to copy from {DB_PATH}")
    for i in range(0, len(windows), BATCH):
        status = send(f"{base}/api/windows", json.dumps(windows[i:i + BATCH]).encode(),
                      {"Content-Type": "application/json", **auth})
        if status != 200:
            raise SystemExit(f"windows batch {i // BATCH + 1} refused with HTTP {status}; stopping")
    clips = [w["window_id"] for w in windows if w["detections"] and (EVIDENCE_DIR / f"{w['window_id']}.wav").exists()]
    ok = sum(send(f"{base}/api/evidence/{wid}", (EVIDENCE_DIR / f"{wid}.wav").read_bytes(),
                  {"Content-Type": "audio/wav", **auth}, "PUT") == 200 for wid in clips)
    print(f"windows copied; {ok}/{len(clips)} evidence clips uploaded")


if __name__ == "__main__":
    main()
