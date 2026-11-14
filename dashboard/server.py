"""Chirp laptop backend: ingest analysed windows from stations, answer dashboard queries.

Run from the repo root:  python -m uvicorn dashboard.server:app --host 0.0.0.0 --port 8000
Contract: protocol/http.md
"""
import json
import sqlite3
from datetime import datetime, timezone
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

HERE = Path(__file__).resolve().parent
DB_PATH = HERE / "chirp.db"  # gitignored
STATIONS = json.loads((HERE / "stations.json").read_text(encoding="utf-8"))
LIVE_IDS = {s["station_id"] for s in STATIONS if not s["simulated"]}
ONLINE_WITHIN_S = 30
MIN_LISTENING_S = 60  # less than this in a range = "no data", not a rate
LOW_EFFORT_S = 15 * 60  # a rate exists, but on too little listening to trust: flag it

SCHEMA = """
CREATE TABLE IF NOT EXISTS windows (          -- listening effort: one row per analysed window
  window_id TEXT PRIMARY KEY,
  station_id TEXT NOT NULL,
  start_utc TEXT NOT NULL,
  duration_s REAL NOT NULL,
  model_version TEXT NOT NULL,
  received_utc TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS detections (       -- accepted predictions within a window
  window_id TEXT NOT NULL REFERENCES windows(window_id),
  species TEXT NOT NULL,
  score REAL NOT NULL,
  PRIMARY KEY (window_id, species)
);
CREATE INDEX IF NOT EXISTS idx_windows_station_start ON windows(station_id, start_utc);
CREATE INDEX IF NOT EXISTS idx_detections_species ON detections(species);
"""


def db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn


with db() as c:
    c.executescript(SCHEMA)


def utc(dt: datetime) -> str:
    """One fixed format so string comparison in SQL is time comparison."""
    if dt.tzinfo is None:
        dt = dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%S.%fZ")


def window_filter(start: datetime | None, end: datetime | None) -> tuple[str, list]:
    sql, args = "", []
    if start:
        sql += " AND w.start_utc >= ?"
        args.append(utc(start))
    if end:
        sql += " AND w.start_utc < ?"
        args.append(utc(end))
    return sql, args


def rate_per_hour(detections: int, listening_s: float) -> float | None:
    """Detections per valid listening hour; None means "no data", never zero activity."""
    if listening_s < MIN_LISTENING_S:
        return None
    return detections / (listening_s / 3600)


class Detection(BaseModel):
    species: str = Field(min_length=1, max_length=200)
    score: float = Field(ge=0, le=1)


class Window(BaseModel):
    window_id: str = Field(min_length=8, max_length=64)
    station_id: str
    start: datetime
    duration_s: float = Field(gt=0, le=60)
    model_version: str = Field(max_length=100)
    detections: list[Detection] = []


app = FastAPI(title="Chirp")


@app.post("/api/windows")
def ingest(windows: list[Window]):
    if not 1 <= len(windows) <= 500:
        raise HTTPException(422, "send 1-500 windows per request")
    unknown = {w.station_id for w in windows} - LIVE_IDS
    if unknown:
        raise HTTPException(422, f"unknown or simulated station: {sorted(unknown)}")
    now = utc(datetime.now(timezone.utc))
    inserted = 0
    with db() as c:
        for w in windows:
            cur = c.execute("INSERT OR IGNORE INTO windows VALUES (?,?,?,?,?,?)",
                            (w.window_id, w.station_id, utc(w.start), w.duration_s, w.model_version, now))
            if cur.rowcount:  # new window; a retried one is ignored with its detections
                inserted += 1
                c.executemany("INSERT OR IGNORE INTO detections VALUES (?,?,?)",
                              [(w.window_id, d.species, d.score) for d in w.detections])
    return {"inserted": inserted, "duplicates": len(windows) - inserted}


@app.get("/api/stations")
def stations():
    with db() as c:
        last = dict(c.execute("SELECT station_id, MAX(received_utc) FROM windows GROUP BY station_id").fetchall())
    now = datetime.now(timezone.utc)
    out = []
    for s in STATIONS:
        seen = last.get(s["station_id"])
        if s["simulated"]:
            status = "simulated"
        elif seen is None:
            status = "inactive"
        else:
            age = (now - datetime.strptime(seen, "%Y-%m-%dT%H:%M:%S.%fZ").replace(tzinfo=timezone.utc)).total_seconds()
            status = "online" if age <= ONLINE_WITHIN_S else "offline"
        out.append({**s, "status": status, "last_seen_utc": seen})
    return out


@app.get("/api/species")
def species(start: datetime | None = None, end: datetime | None = None):
    where, args = window_filter(start, end)
    with db() as c:
        rows = c.execute("SELECT d.species, COUNT(*) AS detections FROM detections d "
                         f"JOIN windows w USING (window_id) WHERE 1=1{where} "
                         "GROUP BY d.species ORDER BY detections DESC", args).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/detections")
def detections(species: str | None = None, station_id: str | None = None,
               start: datetime | None = None, end: datetime | None = None, limit: int = 200):
    where, args = window_filter(start, end)
    if species:
        where += " AND d.species = ?"
        args.append(species)
    if station_id:
        where += " AND w.station_id = ?"
        args.append(station_id)
    args.append(max(1, min(limit, 1000)))
    with db() as c:
        rows = c.execute("SELECT w.window_id, w.station_id, w.start_utc AS start, d.species, d.score "
                         f"FROM detections d JOIN windows w USING (window_id) WHERE 1=1{where} "
                         "ORDER BY w.start_utc DESC LIMIT ?", args).fetchall()
    return [dict(r) for r in rows]


@app.get("/api/rates")
def rates(species: str | None = None, start: datetime | None = None, end: datetime | None = None):
    where, args = window_filter(start, end)
    det_where, det_args = where, list(args)
    if species:
        det_where += " AND d.species = ?"
        det_args.append(species)
    with db() as c:
        listening = dict(c.execute(f"SELECT station_id, SUM(duration_s) FROM windows w WHERE 1=1{where} "
                                   "GROUP BY station_id", args).fetchall())
        counts = dict(c.execute("SELECT w.station_id, COUNT(*) FROM detections d JOIN windows w USING (window_id) "
                                f"WHERE 1=1{det_where} GROUP BY w.station_id", det_args).fetchall())
    out = []
    for s in STATIONS:
        sid = s["station_id"]
        n, secs = counts.get(sid, 0), listening.get(sid) or 0.0
        rate = rate_per_hour(n, secs)
        out.append({"station_id": sid, "simulated": s["simulated"], "detections": n,
                    "listening_s": secs, "rate_per_hour": rate,
                    "low_effort": rate is not None and secs < LOW_EFFORT_S})
    return out


# The dashboard (Seun's map) lives in dashboard/static/ and is served at /.
app.mount("/", StaticFiles(directory=HERE / "static", html=True), name="static")
