"""Chirp laptop backend: ingest analysed windows from stations, answer dashboard queries.

Run from the repo root:  python -m uvicorn dashboard.server:app --host 0.0.0.0 --port 8000
Contract: protocol/http.md
"""
import csv
import io
import json
import math
import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from zoneinfo import ZoneInfo

import re

from fastapi import FastAPI, HTTPException, Request, Response
from fastapi.responses import FileResponse
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel, Field

from dashboard import photos

HERE = Path(__file__).resolve().parent
DB_PATH = HERE / "chirp.db"  # gitignored
STATIONS = json.loads((HERE / "stations.json").read_text(encoding="utf-8"))
LIVE_IDS = {s["station_id"] for s in STATIONS if not s["simulated"]}
ONLINE_WITHIN_S = 30
MIN_LISTENING_S = 60  # less than this in a range = "no data", not a rate
LOW_EFFORT_S = 15 * 60  # a rate exists, but on too little listening to trust: flag it
EVIDENCE_DIR = HERE / "evidence"  # gitignored: detection audio stays on the laptop
EVIDENCE_DIR.mkdir(exist_ok=True)
EVIDENCE_MAX_BYTES = 1_000_000  # a 3 s 48 kHz mono window is ~288 kB
SAFE_ID = re.compile(r"^[A-Za-z0-9_-]{8,64}$")  # window_id becomes a file name

SCHEMA = """
CREATE TABLE IF NOT EXISTS windows (          -- listening effort: one row per analysed window
  window_id TEXT PRIMARY KEY,
  station_id TEXT NOT NULL,
  start_utc TEXT NOT NULL,
  duration_s REAL NOT NULL,
  model_version TEXT NOT NULL,
  received_utc TEXT NOT NULL,
  temperature_c REAL,                         -- optional context, see protocol/http.md
  duty REAL,
  clip TEXT,
  clip_offset_s REAL
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


# Columns added after the first schema; older chirp.db files get them on start.
NEW_COLUMNS = {"temperature_c": "REAL", "duty": "REAL", "clip": "TEXT", "clip_offset_s": "REAL"}

with db() as c:
    c.executescript(SCHEMA)
    have = {row[1] for row in c.execute("PRAGMA table_info(windows)")}
    for name, kind in NEW_COLUMNS.items():
        if name not in have:
            c.execute(f"ALTER TABLE windows ADD COLUMN {name} {kind}")

WINDOW_COLUMNS = ("window_id, station_id, start_utc, duration_s, model_version, received_utc, "
                  "temperature_c, duty, clip, clip_offset_s")
INSERT_WINDOW = f"INSERT OR IGNORE INTO windows ({WINDOW_COLUMNS}) VALUES (?,?,?,?,?,?,?,?,?,?)"


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
    temperature_c: float | None = Field(default=None, ge=-60, le=60)
    duty: float | None = Field(default=None, gt=0, le=1)
    clip: str | None = Field(default=None, max_length=120, pattern=r"^[A-Za-z0-9_.-]+$")
    clip_offset_s: float | None = Field(default=None, ge=0)


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
            cur = c.execute(INSERT_WINDOW, (w.window_id, w.station_id, utc(w.start), w.duration_s,
                                            w.model_version, now, w.temperature_c, w.duty, w.clip,
                                            w.clip_offset_s))
            if cur.rowcount:  # new window; a retried one is ignored with its detections
                inserted += 1
                c.executemany("INSERT OR IGNORE INTO detections VALUES (?,?,?)",
                              [(w.window_id, d.species, d.score) for d in w.detections])
    return {"inserted": inserted, "duplicates": len(windows) - inserted}


@app.get("/api/stations")
def stations():
    with db() as c:
        last = dict(c.execute("SELECT station_id, MAX(received_utc) FROM windows GROUP BY station_id").fetchall())
        # Latest Modulino Thermo reading per station (protocol/http.md)
        temps = {r[0]: (r[1], r[2]) for r in c.execute(
            "SELECT w.station_id, w.temperature_c, w.start_utc FROM windows w JOIN "
            "(SELECT station_id, MAX(start_utc) AS m FROM windows WHERE temperature_c IS NOT NULL GROUP BY station_id) t "
            "ON w.station_id = t.station_id AND w.start_utc = t.m WHERE w.temperature_c IS NOT NULL")}
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
        temp, temp_at = temps.get(s["station_id"], (None, None))
        out.append({**s, "status": status, "last_seen_utc": seen, "temperature_c": temp, "temperature_at": temp_at})
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
    return [{**dict(r), "evidence": evidence_path(r["window_id"]).exists()} for r in rows]


def evidence_path(window_id: str) -> Path:
    if not SAFE_ID.match(window_id):
        raise HTTPException(404, "no such window")
    return EVIDENCE_DIR / f"{window_id}.wav"


@app.put("/api/evidence/{window_id}")
async def put_evidence(window_id: str, request: Request):
    """Audio for one accepted detection; only after its window is stored (protocol/http.md)."""
    path = evidence_path(window_id)
    body = await request.body()
    if len(body) > EVIDENCE_MAX_BYTES:
        raise HTTPException(413, "evidence larger than 1 MB")
    if body[:4] != b"RIFF" or body[8:12] != b"WAVE":
        raise HTTPException(422, "evidence must be a WAV file")
    with db() as c:
        known = c.execute("SELECT 1 FROM detections d JOIN windows w USING (window_id) "
                          "WHERE d.window_id = ? LIMIT 1", (window_id,)).fetchone()
    if not known:
        raise HTTPException(404, "unknown window or no detection in it")
    tmp = path.with_suffix(".part")
    tmp.write_bytes(body)
    tmp.replace(path)  # atomic: a reader never sees half a file
    return {"stored": True}


@app.get("/api/evidence/{window_id}")
def get_evidence(window_id: str):
    path = evidence_path(window_id)
    if not path.exists():
        raise HTTPException(404, "no evidence for this window")
    return FileResponse(path, media_type="audio/wav")


@app.get("/api/hourly-activity")
def hourly_activity(station_id: str, species: str, start: datetime | None = None, end: datetime | None = None):
    where, args = window_filter(start, end)
    hours = [dict(hour=h, listening_s=0.0, detection_minutes=0) for h in range(24)]
    helsinki = ZoneInfo("Europe/Helsinki")
    # The species predicate belongs in the join so quiet windows still contribute effort.
    with db() as c:
        rows = c.execute(f"""
            SELECT substr(w.start_utc, 1, 13) AS utc_hour, SUM(w.duration_s) AS seconds,
                   COUNT(DISTINCT CASE WHEN d.species IS NOT NULL THEN substr(w.start_utc, 1, 16) END) AS minutes
            FROM windows w LEFT JOIN detections d ON d.window_id=w.window_id AND d.species=?
            WHERE w.station_id=? {where}
            GROUP BY utc_hour
        """, [species, station_id, *args])
        for row in rows:
            timestamp = datetime.fromisoformat(row["utc_hour"]).replace(tzinfo=timezone.utc)
            bucket = hours[timestamp.astimezone(helsinki).hour]
            bucket["listening_s"] += row["seconds"]
            bucket["detection_minutes"] += row["minutes"]
    for bucket in hours:
        bucket["rate_per_hour"] = rate_per_hour(bucket["detection_minutes"], bucket["listening_s"])
    return hours


@app.get("/api/station-species")
def station_species(station_id: str, start: datetime | None = None, end: datetime | None = None):
    """Species heard at one station, most active first, in detection-minutes (protocol/http.md)."""
    where, args = window_filter(start, end)
    with db() as c:
        rows = c.execute("SELECT d.species, COUNT(DISTINCT substr(w.start_utc, 1, 16)) AS detection_minutes, "
                         "MAX(w.start_utc) AS last_heard, MAX(d.score) AS best_score "
                         f"FROM detections d JOIN windows w USING (window_id) WHERE w.station_id = ?{where} "
                         "GROUP BY d.species ORDER BY detection_minutes DESC, last_heard DESC",
                         [station_id, *args]).fetchall()
        out = []
        for r in rows:
            recent = c.execute("SELECT w.window_id FROM detections d JOIN windows w USING (window_id) "
                               f"WHERE w.station_id = ? AND d.species = ?{where} ORDER BY w.start_utc DESC LIMIT 50",
                               [station_id, r["species"], *args]).fetchall()
            clip = next((x["window_id"] for x in recent if evidence_path(x["window_id"]).exists()), None)
            out.append({**dict(r), "evidence_window_id": clip})
    return out


@app.get("/api/species-photo")
def species_photo(species: str):
    try:
        return photos.photo(species)
    except photos.Unreachable:
        raise HTTPException(503, "photo source unreachable and nothing cached yet")


@app.get("/api/species-photo/file/{name}")
def species_photo_file(name: str):
    path = photos.image_path(name)
    if not path or not path.exists():
        raise HTTPException(404, "no such photo")
    return FileResponse(path, media_type="image/jpeg")


# Detection-minutes: one bird singing for a minute counts once, not once per 3 s window.
DET_MINUTES = "COUNT(DISTINCT d.species || '|' || substr(w.start_utc, 1, 16))"


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
        counts = dict(c.execute(f"SELECT w.station_id, {DET_MINUTES} FROM detections d JOIN windows w USING (window_id) "
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


# ---------- Trends and early warning (rule documented in protocol/http.md) ----------
WEEK = timedelta(days=7)
RECENT_WEEKS, BASELINE_WEEKS = 2, 6
MIN_DROP = 0.30
MIN_RECENT_S, MIN_BASELINE_S = 5 * 3600, 15 * 3600
MIN_BASELINE_DETECTIONS = 30
MAX_P = 0.01


def weekly(c: sqlite3.Connection, weeks: int, now: datetime, station_id: str | None = None,
           species: str | None = None):
    """Per (station) listening seconds and per (station, species) detection-minutes, in 7-day bins
    counted back from now: bin 0 is the most recent week."""
    lo = utc(now - weeks * WEEK)
    st_sql, st_args = (" AND w.station_id = ?", [station_id]) if station_id else ("", [])
    sp_sql, sp_args = (" AND d.species = ?", [species]) if species else ("", [])
    def bin_of(ts):
        timestamp = datetime.fromisoformat(ts.replace("Z", "+00:00"))
        return (now - timestamp) // WEEK
    listening: dict = {}
    temps: dict = {}  # (station, bin) -> [sum of temp x seconds, seconds with a temperature]
    for sid, ts, dur, temp in c.execute("SELECT w.station_id, w.start_utc, w.duration_s, w.temperature_c "
                                        f"FROM windows w WHERE w.start_utc >= ?{st_sql}", [lo, *st_args]):
        b = bin_of(ts)
        if 0 <= b < weeks:
            listening[(sid, b)] = listening.get((sid, b), 0.0) + dur
            if temp is not None:
                acc = temps.setdefault((sid, b), [0.0, 0.0])
                acc[0] += temp * dur
                acc[1] += dur
    minutes: dict = {}
    for sid, sp, minute in c.execute("SELECT DISTINCT w.station_id, d.species, substr(w.start_utc, 1, 16) "
                                     "FROM detections d JOIN windows w USING (window_id) "
                                     f"WHERE w.start_utc >= ?{st_sql}{sp_sql}", [lo, *st_args, *sp_args]):
        b = bin_of(minute + ":59.999999+00:00")  # bin by the minute's end, matching its windows
        if 0 <= b < weeks:
            minutes[(sid, sp, b)] = minutes.get((sid, sp, b), 0) + 1
    return listening, minutes, temps


def mean_temp(temps: dict, station_id: str, bins) -> float | None:
    total = sum(temps.get((station_id, b), (0.0, 0.0))[0] for b in bins)
    secs = sum(temps.get((station_id, b), (0.0, 0.0))[1] for b in bins)
    return round(total / secs, 1) if secs else None


@app.get("/api/trends")
def trends(station_id: str, species: str | None = None, weeks: int = 12):
    weeks = max(1, min(weeks, 52))
    now = datetime.now(timezone.utc)
    with db() as c:
        listening, minutes, temps = weekly(c, weeks, now, station_id, species)
    out = []
    for b in range(weeks - 1, -1, -1):  # oldest first
        secs = listening.get((station_id, b), 0.0)
        n = sum(v for (sid, _sp, bb), v in minutes.items() if bb == b)
        rate = rate_per_hour(n, secs)
        out.append({"week_start": utc(now - (b + 1) * WEEK), "week_end": utc(now - b * WEEK),
                    "detections": n, "listening_s": secs, "rate_per_hour": rate,
                    "low_effort": rate is not None and secs < LOW_EFFORT_S,
                    "temp_c": mean_temp(temps, station_id, [b])})
    return out


def poisson_cdf(k: int, mu: float) -> float:
    """P(X <= k) for X ~ Poisson(mu), summed in log space so large mu doesn't overflow."""
    if mu <= 0:
        return 1.0
    logs = [i * math.log(mu) - mu - math.lgamma(i + 1) for i in range(k + 1)]
    top = max(logs)
    return min(1.0, math.exp(top) * sum(math.exp(x - top) for x in logs))


def is_decline(recent_n: int, recent_s: float, base_n: int, base_s: float) -> dict | None:
    """Return the alert numbers if this is a decline worth investigating, else None."""
    # TODO(human): refine the early-warning rule (see protocol/http.md before changing it).
    if recent_s < MIN_RECENT_S or base_s < MIN_BASELINE_S or base_n < MIN_BASELINE_DETECTIONS:
        return None  # not enough evidence either side: missing data is never a decline
    base_rate, recent_rate = base_n / (base_s / 3600), recent_n / (recent_s / 3600)
    drop = 1 - recent_rate / base_rate
    p = poisson_cdf(recent_n, base_rate * recent_s / 3600)  # chance of this few if nothing changed
    if drop < MIN_DROP or p >= MAX_P:
        return None
    return {"drop": round(drop, 3), "recent_rate": round(recent_rate, 2), "baseline_rate": round(base_rate, 2),
            "recent_listening_s": recent_s, "baseline_listening_s": base_s, "p_value": p}


@app.get("/api/alerts")
def alerts(species: str | None = None):
    weeks = RECENT_WEEKS + BASELINE_WEEKS
    with db() as c:
        listening, minutes, temps = weekly(c, weeks, datetime.now(timezone.utc), species=species)
    out = []
    for sid, sp in sorted({(sid, sp) for sid, sp, _b in minutes}):
        recent = range(RECENT_WEEKS)
        base = range(RECENT_WEEKS, weeks)
        flag = is_decline(sum(minutes.get((sid, sp, b), 0) for b in recent),
                          sum(listening.get((sid, b), 0.0) for b in recent),
                          sum(minutes.get((sid, sp, b), 0) for b in base),
                          sum(listening.get((sid, b), 0.0) for b in base))
        if flag:
            out.append({"station_id": sid, "species": sp, **flag,
                        "recent_temp_c": mean_temp(temps, sid, recent),
                        "baseline_temp_c": mean_temp(temps, sid, base)})
    return sorted(out, key=lambda a: -a["drop"])


# ---------- Darwin Core export (GBIF / Laji.fi-ready occurrence CSV) ----------
DWC_FIELDS = [
    "occurrenceID", "basisOfRecord", "occurrenceStatus", "eventDate", "samplingProtocol",
    "samplingEffort", "scientificName", "vernacularName", "taxonRank", "kingdom",
    "identifiedBy", "identificationVerificationStatus", "identificationRemarks",
    "decimalLatitude", "decimalLongitude", "geodeticDatum", "coordinateUncertaintyInMeters",
    "countryCode", "locality", "datasetName", "dynamicProperties",
]
DETECTION_RADIUS_M = 100  # a microphone hears birds around it, not at its exact point


@app.get("/api/export/darwin-core.csv")
def export_darwin_core(species: str | None = None, start: datetime | None = None,
                       end: datetime | None = None, include_simulated: bool = False):
    where, args = window_filter(start, end)
    if species:
        where += " AND d.species = ?"
        args.append(species)
    by_id = {s["station_id"]: s for s in STATIONS}
    with db() as c:
        rows = c.execute("SELECT w.window_id, w.station_id, w.start_utc, w.duration_s, w.model_version, "
                         "w.temperature_c, d.species, d.score FROM detections d JOIN windows w USING (window_id) "
                         f"WHERE 1=1{where} ORDER BY w.start_utc", args).fetchall()
    buf = io.StringIO()
    out = csv.DictWriter(buf, DWC_FIELDS, lineterminator="\n")
    out.writeheader()
    for r in rows:
        st = by_id.get(r["station_id"])
        if st is None or (st["simulated"] and not include_simulated):
            continue
        sci, _, common = r["species"].partition("_")
        begin = datetime.fromisoformat(r["start_utc"])
        out.writerow({
            "occurrenceID": f"chirp:{r['window_id']}:{sci.replace(' ', '_')}",
            "basisOfRecord": "MachineObservation",
            "occurrenceStatus": "present",
            "eventDate": f"{begin.strftime('%Y-%m-%dT%H:%M:%SZ')}/"
                         f"{(begin + timedelta(seconds=r['duration_s'])).strftime('%Y-%m-%dT%H:%M:%SZ')}",
            "samplingProtocol": f"passive acoustic monitoring; {r['model_version']} on-device, score >= 0.5",
            "samplingEffort": f"{r['duration_s']:g} s acoustic window",
            "scientificName": sci,
            "vernacularName": common,
            "taxonRank": "species",
            "kingdom": "Animalia",
            "identifiedBy": f"{r['model_version']} (automated)",
            "identificationVerificationStatus": "unverified",
            "identificationRemarks": f"model score {r['score']:.3f} (not a probability of correctness)",
            "decimalLatitude": st["lat"],
            "decimalLongitude": st["lon"],
            "geodeticDatum": "WGS84",
            "coordinateUncertaintyInMeters": DETECTION_RADIUS_M,
            "countryCode": "FI",
            "locality": st["name"],
            "datasetName": "Chirp acoustic monitoring" + (" (SIMULATED)" if st["simulated"] else ""),
            "dynamicProperties": json.dumps({"station_id": r["station_id"], "score": r["score"],
                                             "temperature_c": r["temperature_c"],
                                             "simulated": st["simulated"]}),
        })
    return Response(buf.getvalue(), media_type="text/csv; charset=utf-8",
                    headers={"Content-Disposition": 'attachment; filename="chirp-darwin-core.csv"'})


# The dashboard (Seun's map) lives in dashboard/static/ and is served at /.
app.mount("/", StaticFiles(directory=HERE / "static", html=True), name="static")
