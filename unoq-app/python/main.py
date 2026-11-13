"""UNO Q Linux side: camera mic -> BirdNET -> MCU over Bridge. No MQTT until after demo-v1."""
import json
import os
import subprocess
import sys
import threading
from pathlib import Path

from arduino.app_utils import App, Bridge

# Model + runtime are installed by hand on the board, not in git (see CLAUDE.md).
MODEL_DIR = Path(os.environ.get("CHIRP_MODEL_DIR", "/home/arduino/chirp-test"))
sys.path.append(str(MODEL_DIR / "lib"))  # fallback if requirements.txt didn't install ai_edge_litert

from bird_audio import WINDOW_BYTES, predict  # noqa: E402

MIC = os.environ.get("CHIRP_MIC", "plughw:CARD=Camera,DEV=0")
THRESHOLD = 0.5


# Common Finnish species, by BirdNET scientific name (label = "Scientific_Common").
# Verify against BirdNET_GLOBAL_6K_V2.4_Labels.txt on the board: a typo never matches.
FINNISH_SPECIES = {
    "Fringilla coelebs", "Parus major", "Cyanistes caeruleus", "Periparus ater",
    "Turdus merula", "Turdus philomelos", "Turdus pilaris", "Turdus iliacus",
    "Erithacus rubecula", "Cuculus canorus", "Phylloscopus trochilus", "Phylloscopus collybita",
    "Sylvia atricapilla", "Ficedula hypoleuca", "Regulus regulus", "Sitta europaea",
    "Emberiza citrinella", "Pyrrhula pyrrhula", "Spinus spinus", "Chloris chloris",
    "Passer domesticus", "Dendrocopos major", "Garrulus glandarius", "Pica pica",
    "Corvus cornix", "Columba palumbus", "Larus canus", "Grus grus",
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
            if accept(p):
                print(json.dumps(p), flush=True)
                Bridge.call("bird_detected")
            elif analysed % 20 == 0:
                print(f"[chirp] {analysed * 3} s analysed, last inference {p['inference_s']} s", flush=True)
        print(f"[chirp] mic stopped (arecord exit {mic.poll()})", flush=True)


# App.run() owns the main thread; inference runs alongside it.
threading.Thread(target=listen, daemon=True).start()
App.run()
