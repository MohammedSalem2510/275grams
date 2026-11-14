"""UNO Q Linux side: camera mic -> BirdNET -> MCU over Bridge, and every window -> laptop backend."""
import io
import json
import os
import queue
import shutil
import subprocess
import threading
import time
import urllib.error
import urllib.request
import uuid
import wave
from datetime import datetime, timezone
from pathlib import Path

from arduino.app_utils import App, Bridge

# App Lab runs python/ in a container that only sees the app folder, so the model
# lives in unoq-app/models/birdnet/ on the board (gitignored, ~50 MB, CC BY-NC-SA).
MODEL_DIR = Path(os.environ.get("CHIRP_MODEL_DIR", Path(__file__).resolve().parent.parent / "models" / "birdnet"))

from bird_audio import WINDOW_BYTES, predict

MIC = os.environ.get("CHIRP_MIC", "plughw:CARD=Camera,DEV=0")
# BirdNET confidence for a listed Finnish species (not accuracy). 0.5 missed quiet birds
# outdoors; the 269-species list acts as the location filter that makes a lower value usable.
THRESHOLD = float(os.environ.get("CHIRP_THRESHOLD", "0.25"))
MAX_SPECIES = 3  # per 3 s window
MODEL_VERSION = "BirdNET_GLOBAL_6K_V2.4"
STATION_ID = os.environ.get("CHIRP_STATION", "chirp-1")
# Laptop running dashboard/server.py. Set it per board, never in git (venue DHCP changes it):
#   echo http://<laptop-ip>:8000 > ~/repo/unoq-app/python/server_url.txt   then restart the app
_SERVER_FILE = Path(__file__).with_name("server_url.txt")  # gitignored
SERVER = (os.environ.get("CHIRP_SERVER")
          or (_SERVER_FILE.read_text().strip() if _SERVER_FILE.exists() else "")
          or "http://10.0.39.120:8000")

outbox: queue.Queue = queue.Queue(maxsize=20000)  # ~16 h of windows if the laptop is away

# Audio evidence: the 3 s WAV of each accepted detection, PUT after its window is uploaded.
# Only accepted windows (never speech) are kept, at most EVIDENCE_MAX (~29 MB), oldest dropped first.
EVIDENCE_MAX = 100
evidence: dict[str, bytes] = {}
evidence_lock = threading.Lock()


def wav_bytes(raw: bytes) -> bytes:
    buf = io.BytesIO()
    with wave.open(buf, "wb") as w:
        w.setnchannels(1)
        w.setsampwidth(2)
        w.setframerate(48000)
        w.writeframes(raw)
    return buf.getvalue()


def keep_evidence(window_id: str, raw: bytes):
    with evidence_lock:
        evidence[window_id] = wav_bytes(raw)
        while len(evidence) > EVIDENCE_MAX:
            evidence.pop(next(iter(evidence)))  # dicts keep insertion order: oldest first


def send_evidence():
    """Called after a successful window upload. 404 means its window isn't stored yet: keep it."""
    with evidence_lock:
        pending = list(evidence.items())
    for window_id, wav in pending:
        req = urllib.request.Request(f"{SERVER}/api/evidence/{window_id}", wav,
                                     {"Content-Type": "audio/wav"}, method="PUT")
        try:
            urllib.request.urlopen(req, timeout=10).read()
        except urllib.error.HTTPError as e:
            if e.code == 404:
                continue
            print(f"[chirp] evidence rejected ({e.code}); dropping {window_id}", flush=True)
        except OSError:
            return  # laptop unreachable: everything stays for the next round
        with evidence_lock:
            evidence.pop(window_id, None)


# Every regularly occurring Finnish bird BirdNET knows (269), as exact BirdNET labels.
FINNISH_SPECIES = {
    line.strip() for line in Path(__file__).with_name("finnish_species.txt").read_text(encoding="utf-8").splitlines()
    if line.strip() and not line.startswith("#")
}


def accept(p: dict) -> list[dict]:
    """The window's detections: every listed Finnish species at or above THRESHOLD, best first.
    Speech alone never becomes a detection (human labels aren't listed); a bird heard over
    people talking still counts, and its clip may contain that background speech."""
    found = [{"species": label, "score": score} for label, score in p["ranked"]
             if score >= THRESHOLD and label in FINNISH_SPECIES][:MAX_SPECIES]
    if not found and p["species"] and "Human" not in p["species"] and p["species"] not in FINNISH_SPECIES:
        print(f"[chirp] unlisted, not counted: {p['species']} {p['score']}", flush=True)  # kept reviewable
    return found


# Camera mic, no AGC: 100% = +16 dB. Outdoors needs it for distant birds; indoors it clips on
# room noise (use CHIRP_MIC_GAIN=20%). Clipping is logged so the level can be checked in the field.
MIC_GAIN = os.environ.get("CHIRP_MIC_GAIN", "100%")

# ---------- Field recording (off unless the flag file exists) ----------
# Turn on for a field session:   touch ~/repo/unoq-app/python/record_audio   then restart the app
APP_DIR = Path(__file__).resolve().parent.parent
RECORD_FLAG = Path(__file__).with_name("record_audio")  # gitignored
RECORDINGS = APP_DIR / "recordings"                     # gitignored; raw audio never goes in git
MIN_FREE_BYTES = 1_000_000_000                          # stop recording below 1 GB free
SPEECH_SCORE = 0.2  # privacy: purge a field-recording file if speech is even weakly the top label


class MinuteRecorder:
    """Writes the analysed audio into one-minute WAV files. A file in which speech was the top
    label in any window is deleted when it closes, so speech is never stored."""

    def __init__(self, folder: Path):
        self.folder, self.wav, self.name, self.opened, self.speech = folder, None, None, 0.0, False
        folder.mkdir(parents=True, exist_ok=True)

    def write(self, raw: bytes, start: datetime):
        if self.wav is None or time.monotonic() - self.opened >= 60:
            self._rotate(start)
        if self.wav is None:
            return None, None
        offset = self.wav.getnframes() / 48000
        self.wav.writeframes(raw)
        return self.name, offset

    def mark_speech(self):
        self.speech = True

    def _rotate(self, start: datetime):
        self.close()
        if shutil.disk_usage(self.folder).free < MIN_FREE_BYTES:
            print("[chirp] disk nearly full, recording paused", flush=True)
            return
        self.name = f"{STATION_ID}_{start.strftime('%Y%m%dT%H%M%SZ')}.wav"
        self.wav = wave.open(str(self.folder / self.name), "wb")
        self.wav.setnchannels(1)
        self.wav.setsampwidth(2)
        self.wav.setframerate(48000)
        self.opened = time.monotonic()

    def close(self):
        if self.wav is None:
            return
        self.wav.close()
        if self.speech:
            (self.folder / self.name).unlink(missing_ok=True)
            print(f"[chirp] speech heard, deleted {self.name}", flush=True)
        self.wav, self.speech = None, False


# ---------- Context from the MCU (Modulino Thermo + Knob), polled, never blocking ----------
NO_SENSOR = -999.0
mcu = {"temperature_c": None, "duty": 1.0, "polled": 0.0}


def poll_mcu():
    if time.monotonic() - mcu["polled"] < 10:
        return
    mcu["polled"] = time.monotonic()
    try:
        t = float(Bridge.call("get_temperature"))
        mcu["temperature_c"] = None if t <= NO_SENSOR + 1 else round(t, 1)
        mcu["duty"] = max(0.05, min(1.0, float(Bridge.call("get_duty")) / 100))
    except Exception as e:  # an older sketch or a missing Modulino must not stop listening
        print(f"[chirp] MCU context unavailable ({e})", flush=True)


# Overlapping windows: BirdNET always sees 3 s, but a new window starts every HOP_S, so a call
# on a boundary isn't split. Each window adds HOP_S of listening (protocol/http.md).
HOP_S = 1.5
HOP_BYTES = WINDOW_BYTES // 2
WINDOWS_PER_MIN = round(60 / HOP_S)


def skip_window(state={"slot": 0}) -> bool:
    """Duty cycle: analyse the first duty share of each minute's windows, skip the rest."""
    poll_mcu()
    slot = state["slot"]
    state["slot"] = (slot + 1) % WINDOWS_PER_MIN
    return slot >= round(mcu["duty"] * WINDOWS_PER_MIN)


def listen():
    # Boot default overloads the camera mic; set gain every start (no sudo needed).
    subprocess.run(["amixer", "-q", "-c", "Camera", "sset", "Mic", MIC_GAIN], check=False)
    cmd =["arecord", "-q", "-D", MIC, "-t", "raw", "-f", "S16_LE", "-c", "1", "-r", "48000"]
    recorder = MinuteRecorder(RECORDINGS) if RECORD_FLAG.exists() else None
    print(f"[chirp] field recording {'ON -> ' + str(RECORDINGS) if recorder else 'off'}", flush=True)
    last_raw, new_chunk = [b""], [b""]

    def read_window():
        """Slide the 3 s window on by one hop: keep the newer half, append HOP_S of fresh audio."""
        need = WINDOW_BYTES if not last_raw[0] else HOP_BYTES
        chunk = mic.stdout.read(need)
        if len(chunk) != need:
            return b""  # mic stopped
        new_chunk[0] = chunk  # all 3 s on the first read, one hop after that
        last_raw[0] = (last_raw[0] + chunk)[-WINDOW_BYTES:]
        return last_raw[0]

    with subprocess.Popen(cmd, stdout=subprocess.PIPE) as mic:
        analysed = 0
        for p in predict(read_window, MODEL_DIR, None, THRESHOLD, skip=skip_window):
            analysed += 1  # every analysed window adds HOP_S of listening, detection or not
            found = accept(p)
            ok = bool(found)
            if ok:
                print(json.dumps({"detections": found, "peak_dbfs": p["peak_dbfs"]}), flush=True)
                Bridge.call("bird_detected")
            elif analysed % WINDOWS_PER_MIN == 0:
                print(f"[chirp] {analysed * HOP_S:.0f} s listened, last inference {p['inference_s']} s, "
                      f"peak {p['peak_dbfs']} dBFS, duty {mcu['duty']:.0%}, temp {mcu['temperature_c']}, "
                      f"{outbox.qsize()} awaiting upload", flush=True)
            if p["clipped"] > 0.01:
                print(f"[chirp] clipping: {p['clipped']:.1%} of samples at gain {MIC_GAIN}", flush=True)
            # Window ended just before inference started; approximate its start from that.
            start = datetime.fromtimestamp(time.time() - p["inference_s"] - 3, timezone.utc)
            clip, offset = (None, None)
            if recorder:
                # Write only the fresh hop, so overlapping windows don't duplicate audio in the file.
                # The window's 3 s began one hop before that chunk (clamped at a file start).
                clip, offset = recorder.write(new_chunk[0], start)  # write first: may open a new file
                if offset is not None:
                    offset = max(0.0, offset - HOP_S)
                if "Human" in p["top"] and p["score"] >= SPEECH_SCORE:
                    recorder.mark_speech()  # ...so the file holding this window is the one purged
                    clip, offset = None, None
            window_id = uuid.uuid4().hex
            if ok:
                keep_evidence(window_id, last_raw[0])
            window = {"window_id": window_id, "station_id": STATION_ID,
                      "start": start.isoformat(), "duration_s": HOP_S, "model_version": MODEL_VERSION,
                      "detections": found,
                      "temperature_c": mcu["temperature_c"], "duty": mcu["duty"],
                      "clip": clip, "clip_offset_s": offset}
            try:
                outbox.put_nowait(window)
            except queue.Full:
                print("[chirp] outbox full, window not uploaded", flush=True)
        if recorder:
            recorder.close()
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
            send_evidence()
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
