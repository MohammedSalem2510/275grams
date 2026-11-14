# Railway preview

1. In Railway, create a service from the `MohammedSalem2510/275grams` GitHub repository and select the `codex/railway-hosting` source branch. Use the repository root so Railway builds the included Dockerfile.
2. Attach a persistent volume at `/data` for SQLite and cached bird photos. Use one service replica. The initial database is empty and includes the station registry.
3. Generate a public domain under the service's networking settings. Open the domain on a phone using mobile data and check the map and statistics. The preview can be viewed before a station is connected.
4. When ready to connect the station, generate a random secret (for example with `python -c "import secrets; print(secrets.token_urlsafe(32))"`) and set it as the service variable `CHIRP_STATION_TOKEN`. Apply the change. The public service accepts observation uploads with that token and serves no evidence audio.
5. For a live test, run the station code from this branch on the UNO Q. Save the same secret in `~/repo/unoq-app/python/station_token.txt` (file mode 600) and the public HTTPS URL without a trailing slash in `~/repo/unoq-app/python/server_url.txt`. Save the previous URL first. Restart Chirp Station with internet access and check that the live station's last reading advances on the public site.

The station sends new observations to one destination. To resume updating the local dashboard, restore its URL, remove the station token file and restart Chirp Station. The hosted preview displays the history already uploaded.
