# Hosting the dashboard on Railway

The public site is the same dashboard in hosted mode (`CHIRP_HOSTED=1`, set by the `Dockerfile`). It needs a station token for uploads, and it stores and plays evidence clips (`protocol/http.md`). Ryan designed it; this guide builds from `main`.

## 1. Create the service (a Railway account holder does this)

1. In Railway, create a project from the GitHub repository `MohammedSalem2510/275grams`, branch `main`. Railway finds the root `Dockerfile`.
2. Add a **volume** mounted at `/data`. It holds the SQLite database, evidence clips and cached bird photos, and it survives redeploys. Keep one replica.
3. Under the service's variables, set `CHIRP_STATION_TOKEN` to a long random secret. To generate one: `python -c "import secrets; print(secrets.token_urlsafe(32))"`. Don't commit it anywhere.
4. Under networking, **generate a public domain**. Each start re-seeds the labelled simulated stations, so the site has demo data from the first visit.

## 2. Copy today's real station history (from the laptop that has it)

From the repo root, in PowerShell:

```
$env:CHIRP_STATION_TOKEN = "<the token>"
python -m dashboard.backfill_hosted https://<your-app>.up.railway.app
```

This copies every real window, detection and clip. It's safe to re-run.

## 3. Point the station at the public site (live updates)

On the board, over SSH. The board needs internet, which Junction Wi-Fi provides.

```
cd ~/repo; git pull
cp unoq-app/python/server_url.txt unoq-app/python/server_url.laptop.txt   # keep the laptop address
echo https://<your-app>.up.railway.app > unoq-app/python/server_url.txt
echo '<the token>' > unoq-app/python/station_token.txt; chmod 600 unoq-app/python/station_token.txt
arduino-app-cli app stop user:chirp-station; arduino-app-cli app start user:chirp-station
```

Check: chirp-1 shows **online** on the public site, and new detections appear with a play button. A log line `upload refused (401)` means the token on the board doesn't match Railway's.

The station sends to one destination. To go back to the laptop, restore `server_url.laptop.txt` as `server_url.txt`, delete `station_token.txt`, and restart Chirp Station. Uploads to an `http://` address never include the token.
