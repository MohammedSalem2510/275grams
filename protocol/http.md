# HTTP API (station → laptop backend → dashboard)

The backend is `dashboard/server.py` (FastAPI + SQLite), running on a laptop on the same LAN as the stations.
Times are ISO 8601. The server stores them in UTC. Date ranges are **inclusive start, exclusive end**.

To change this contract, edit this file in its own `protocol:` commit **before** touching any code.

## Station → backend

`POST /api/windows`: a JSON array of analysed windows (1–500 per request). The board sends **every** analysed window, including ones with no detection, because the windows are the listening effort.

```json
[{
  "window_id": "9f1c…",                 // unique per window, made on the board; a retry reuses it
  "station_id": "chirp-1",              // must be a live station in dashboard/stations.json
  "start": "2026-11-14T00:12:03.120Z",
  "duration_s": 3.0,
  "model_version": "BirdNET_GLOBAL_6K_V2.4",
  "detections": [{"species": "Fringilla coelebs_Common Chaffinch", "score": 0.97}]  // [] if none accepted
}]
```
Response: `{"inserted": n, "duplicates": m}`. Re-sending a `window_id` is a no-op, so retries never double-count.

## Dashboard → backend (read-only)

| Endpoint | Returns |
|---|---|
| `GET /api/stations` | Registry plus `status`: `online` (a window received in the last 30 s), `offline`, `inactive` (never reported) or `simulated` |
| `GET /api/species?start=&end=` | `[{species, detections}]` for the search box |
| `GET /api/detections?species=&station_id=&start=&end=&limit=` | Newest first: `[{window_id, station_id, start, species, score}]` |
| `GET /api/rates?species=&start=&end=` | One row per station: `{station_id, detections, listening_s, rate_per_hour}`. `rate_per_hour` is **`null` when there's no data**, which is never shown as zero. |

Species values are full BirdNET labels (`Scientific name_Common Name`). Split on the first `_` for display.
