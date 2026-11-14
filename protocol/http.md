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
  "detections": [{"species": "Fringilla coelebs_Common Chaffinch", "score": 0.97}],  // [] if none accepted
  // optional context (omit or null when unavailable)
  "temperature_c": 1.4,                  // Modulino Thermo reading at the station
  "duty": 0.25,                          // fraction of each minute the station analyses (knob)
  "clip": "chirp-1_20261114T101200Z.wav",// field recording holding this window, if recording is on
  "clip_offset_s": 27.0                  // where this window starts inside that clip
}]
```
Duty cycling only reduces how many windows are sent; listening time stays the sum of the windows that were actually analysed, so rates remain correct.
Response: `{"inserted": n, "duplicates": m}`. Re-sending a `window_id` is a no-op, so retries never double-count.

`PUT /api/evidence/{window_id}`: the audio evidence for one **accepted detection**. The body is the analysed 3 s window as a WAV file (`Content-Type: audio/wav`, 48 kHz mono 16-bit, at most 1 MB). The station sends it only after the window itself was accepted by `POST /api/windows`. It never sends evidence for a window without a detection, and windows whose top label is human speech are never accepted, so speech is never uploaded.
- `200 {"stored": true}`: stored. Re-sending overwrites the same file, so retries are safe.
- `404`: the window is unknown or has no detection (yet). The station keeps the clip and tries again after its next successful window upload.
- `413` or `422`: too large, or not a WAV file. The station drops the clip.

Evidence is kept on the laptop in `dashboard/evidence/` (gitignored), never in git.

## Dashboard → backend (read-only)

| Endpoint | Returns |
|---|---|
| `GET /api/stations` | Registry plus `status`: `online` (a window received in the last 30 s), `offline`, `inactive` (never reported) or `simulated`. Also `temperature_c` and `temperature_at`: the station's most recent Modulino Thermo reading and the start time of that window (both `null` if it never reported one). |
| `GET /api/species?start=&end=` | `[{species, detections}]` for the search box |
| `GET /api/detections?species=&station_id=&start=&end=&limit=` | Newest first: `[{window_id, station_id, start, species, score, evidence}]`. `evidence` is `true` when an audio clip is stored for that window. |
| `GET /api/evidence/{window_id}` | The window's WAV evidence (`audio/wav`), or `404` if none was uploaded |
| `GET /api/station-species?station_id=&start=&end=` | Species detected at one station, most active first: `[{species, detection_minutes, last_heard, best_score, evidence_window_id}]`. `evidence_window_id` is the newest window of that species with a stored clip, or `null`. |
| `GET /api/species-photo?species=` | Photo metadata for a full BirdNET label: `{available: true, image, credit, licence, source}` or `{available: false}`. `image` is a laptop-local URL. Photos come from iNaturalist (birds only, exact scientific-name match) and are fetched **once** by the laptop, then cached in `dashboard/photos/` (gitignored). Only CC0, CC BY, CC BY-SA and CC BY-NC photos are used, and `credit` must be shown with the photo. `503` when iNaturalist is unreachable and nothing is cached yet. Run `python -m dashboard.fetch_photos` before a demo so photos work offline. Only species names are ever sent to iNaturalist. |
| `GET /api/species-photo/file/{name}` | The cached image itself (`image/jpeg`) |
| `GET /api/rates?species=&start=&end=` | One row per station: `{station_id, simulated, detections, listening_s, rate_per_hour, low_effort}`. `rate_per_hour` is **`null` under 60 s of listening (no data)**, which is never shown as zero. `low_effort` is `true` when there's a rate but under 15 min of listening behind it. The map must flag those pins (e.g. hollow or dashed) and show the listening time. |
| `GET /api/trends?station_id=&species=&weeks=12` | Oldest first, one row per 7-day bin ending now: `{week_start, week_end, detections, listening_s, rate_per_hour, low_effort, temp_c}` |
| `GET /api/alerts?species=` | Early warnings, worst first: `{station_id, species, drop, recent_rate, baseline_rate, recent_listening_s, baseline_listening_s, p_value, recent_temp_c, baseline_temp_c}`. The temperatures are listening-weighted means, or `null` when unknown. They're context for the reviewer, not a correction. |
| `GET /api/export/darwin-core.csv?species=&start=&end=&include_simulated=false` | Detections as a [Darwin Core](https://dwc.tdwg.org/) occurrence CSV (one row per detected species per window, `basisOfRecord=MachineObservation`, unverified), ready for GBIF / Laji.fi (FinBIF). Simulated stations are excluded unless asked for. |

**Detections are counted as detection-minutes:** the number of distinct minutes in which a species was detected (all species: distinct species × minute pairs). One bird singing for a minute counts once, not once per 3 s window. `/api/detections` still lists the individual windows.

**Early-warning rule** (`/api/alerts`): compare the last 2 weeks with the 6 weeks before them at the same station. Flag a decline only if all of these hold:
- the rate dropped by **≥ 30 %**
- there's **≥ 5 h** of listening in the recent period and **≥ 15 h** in the baseline
- the baseline has **≥ 30** detection-minutes
- a Poisson test gives **p < 0.01**

Missing listening never counts as a decline. These are *changes in detected activity worth investigating*, not confirmed population loss. A real deployment should compare against the same season in earlier years, so migration isn't mistaken for decline.

Species values are full BirdNET labels (`Scientific name_Common Name`). Split on the first `_` for display.

`GET /api/hourly-activity` accepts a required `station_id` and `species` and optional `start` (inclusive) and `end` (exclusive) window-start filters. It returns 24 Europe/Helsinki clock-hour bins with `hour`, `listening_s`, `detection_minutes`, and `rate_per_hour`. Assign each window to its starting hour and count distinct UTC minutes containing the species. Pool effort across dates before calculating the rate. Below 60 seconds of effort the rate is null.
