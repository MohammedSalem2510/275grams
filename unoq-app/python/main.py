"""UNO Q Linux side: camera mic -> BirdNET -> MCU over Bridge, and every window -> laptop backend."""
import json
import os
import queue
import subprocess
import threading
import time
import urllib.error
import urllib.request
import uuid
from datetime import datetime, timezone
from pathlib import Path

from arduino.app_utils import App, Bridge

# App Lab runs python/ in a container that only sees the app folder, so the model
# lives in unoq-app/models/birdnet/ on the board (gitignored, ~50 MB, CC BY-NC-SA).
MODEL_DIR = Path(os.environ.get("CHIRP_MODEL_DIR", Path(__file__).resolve().parent.parent / "models" / "birdnet"))

from bird_audio import WINDOW_BYTES, predict

MIC = os.environ.get("CHIRP_MIC", "plughw:CARD=Camera,DEV=0")
THRESHOLD = 0.5
MODEL_VERSION = "BirdNET_GLOBAL_6K_V2.4"
STATION_ID = os.environ.get("CHIRP_STATION", "chirp-1")
# Laptop running dashboard/server.py. Set it per board, never in git (venue DHCP changes it):
#   echo http://<laptop-ip>:8000 > ~/repo/unoq-app/python/server_url.txt   then restart the app
_SERVER_FILE = Path(__file__).with_name("server_url.txt")  # gitignored
SERVER = (os.environ.get("CHIRP_SERVER")
          or (_SERVER_FILE.read_text().strip() if _SERVER_FILE.exists() else "")
          or "http://10.0.39.120:8000")

outbox: queue.Queue = queue.Queue(maxsize=20000)  # ~16 h of windows if the laptop is away


# Common Finnish species, by BirdNET scientific name (label = "Scientific_Common").
# All checked against BirdNET_GLOBAL_6K_V2.4_Labels.txt on the board (14 Nov).
FINNISH_SPECIES = {
    "Fringilla coelebs", "Parus major", "Cyanistes caeruleus", "Periparus ater",
    "Turdus merula", "Turdus philomelos", "Turdus pilaris", "Turdus iliacus",
    "Erithacus rubecula", "Cuculus canorus", "Phylloscopus trochilus", "Phylloscopus collybita",
    "Sylvia atricapilla", "Ficedula hypoleuca", "Regulus regulus", "Sitta europaea",
    "Emberiza citrinella", "Pyrrhula pyrrhula", "Spinus spinus", "Chloris chloris",
    "Passer domesticus", "Dendrocopos major", "Garrulus glandarius", "Pica pica",
    "Corvus cornix", "Columba palumbus", "Larus canus", "Grus grus",
    "Emberiza schoeniclus", "Acrocephalus schoenobaenus",
    # Winter residents (Nov field test): mostly calls, not song. NOT YET checked against Labels.txt.
    "Poecile montanus", "Lophophanes cristatus", "Aegithalos caudatus", "Certhia familiaris",
    "Corvus corax", "Coloeus monedula", "Corvus monedula", "Dryocopus martius", "Dryobates minor",
    "Picoides tridactylus", "Acanthis flammea", "Loxia curvirostra", "Bombycilla garrulus",
    "Bonasa bonasia", "Glaucidium passerinum", "Strix aluco", "Passer montanus",
    "Anas platyrhynchos", "Cygnus cygnus", "Larus argentatus", "Larus marinus",
}


def accept(p: dict) -> bool:
    """Decide whether one window's prediction counts as a detection."""
    label = p["species"]
    if label is None or "Human" in label:  # privacy: speech never becomes evidence
        return False
    if label.split("_", 1)[0] in FINNISH_SPECIES:
        return True
    print(f"[chirp] unlisted, not counted: {label} {p['score']}", flush=True)  # kept reviewable
    return False


MIC_GAIN = os.environ.get("CHIRP_MIC_GAIN", "20%")  # camera default 100% (+16 dB) clips on room noise alone


def listen():
    # Boot default overloads the camera mic; set gain every start (no sudo needed).
    subprocess.run(["amixer", "-q", "-c", "Camera", "sset", "Mic", MIC_GAIN], check=False)
    cmd =["arecord", "-q", "-D", MIC, "-t", "raw", "-f", "S16_LE", "-c", "1", "-r", "48000"]
    with subprocess.Popen(cmd, stdout=subprocess.PIPE) as mic:
        analysed = 0
        for p in predict(lambda: mic.stdout.read(WINDOW_BYTES), MODEL_DIR, None, THRESHOLD):
            analysed += 1  # every analysed window counts as 3 s of listening, detection or not
            ok = accept(p)
            if ok:
                print(json.dumps(p), flush=True)
                Bridge.call("bird_detected")
            elif analysed % 20 == 0:
                print(f"[chirp] {analysed * 3} s analysed, last inference {p['inference_s']} s, "
                      f"{outbox.qsize()} awaiting upload", flush=True)
            # Window ended just before inference started; approximate its start from that.
            start = datetime.fromtimestamp(time.time() - p["inference_s"] - 3, timezone.utc)
            window = {"window_id": uuid.uuid4().hex, "station_id": STATION_ID,
                      "start": start.isoformat(), "duration_s": 3.0, "model_version": MODEL_VERSION,
                      "detections": [{"species": p["species"], "score": p["score"]}] if ok else []}
            try:
                outbox.put_nowait(window)
            except queue.Full:
                print("[chirp] outbox full, window not uploaded", flush=True)
        print(f"[chirp] mic stopped (arecord exit {mic.poll()})", flush=True)


def upload():
    """Send windows in batches; on failure keep the batch and retry with the same window_ids."""
    batch: list = []
    while True:
        if not batch:
            batch.append(outbox.get())
        while len(batch) < 100:
            try:
                batch.append(outbox.get_nowait())
            except queue.Empty:
                break
        req = urllib.request.Request(f"{SERVER}/api/windows", json.dumps(batch).encode(),
                                     {"Content-Type": "application/json"})
        try:
            urllib.request.urlopen(req, timeout=5).read()
            batch = []
        except urllib.error.HTTPError as e:
            if 400 <= e.code < 500:  # the server rejected the data itself; retrying won't help
                print(f"[chirp] upload rejected ({e.code}: {e.read()[:200]!r}); dropping {len(batch)}", flush=True)
                batch = []
            else:
                time.sleep(5)
        except OSError as e:  # laptop unreachable: keep the batch, try again
            print(f"[chirp] upload failed ({e}); retrying {len(batch)} windows", flush=True)
            time.sleep(5)


# App.run() owns the main thread; inference and upload run alongside it.
threading.Thread(target=listen, daemon=True).start()
threading.Thread(target=upload, daemon=True).start()
App.run()
