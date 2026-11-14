"""Run BirdNET v2.4 on a 48 kHz mono PCM WAV or an ALSA capture device."""

import argparse
import json
import subprocess
import time
import wave
from contextlib import closing
from pathlib import Path

import numpy as np
from ai_edge_litert.interpreter import Interpreter


WINDOW_BYTES = 288000  # 3 s of 48 kHz mono S16_LE


def predict(read_window, model_dir, windows=None, threshold=0.5, skip=None):
    """Yield one dict per analysed 3 s window; windows=None runs until read_window runs dry.
    skip() -> True reads and discards the next window without inference (duty cycling)."""
    prefix = "BirdNET_GLOBAL_6K_V2.4"
    labels = (model_dir / f"{prefix}_Labels.txt").read_text().splitlines()
    model = Interpreter(str(model_dir / f"{prefix}_Model_FP32.tflite"), num_threads=2)
    model.allocate_tensors()
    input_id = model.get_input_details()[0]["index"]
    output_id = model.get_output_details()[0]["index"]
    index = 0
    while windows is None or index < windows:
        raw = read_window()
        if len(raw) != WINDOW_BYTES:
            break
        if skip and skip():
            index += 1
            continue
        started = time.monotonic()
        samples = np.frombuffer(raw, dtype="<i2").astype(np.float32) / 32768
        model.set_tensor(input_id, samples.reshape(1, -1))
        model.invoke()
        logits = model.get_tensor(output_id)[0]
        scores = 1 / (1 + np.exp(-np.clip(logits, -80, 80)))
        best = int(np.argmax(scores))
        yield dict(start_s=3 * index, top=labels[best], species=labels[best] if scores[best] >= threshold else None,
                   score=round(float(scores[best]), 4), inference_s=round(time.monotonic() - started, 3))
        index += 1


def classify(read_window, model_dir, windows, threshold):
    for row in predict(read_window, model_dir, windows, threshold):
        print(json.dumps(row), flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    source = parser.add_mutually_exclusive_group(required=True)
    source.add_argument("--wav", type=Path)
    source.add_argument("--device", help="ALSA device, e.g. plughw:CARD=Camera,DEV=0")
    parser.add_argument("--model-dir", type=Path, default=Path.cwd())
    parser.add_argument("--windows", type=int, default=40)
    parser.add_argument("--threshold", type=float, default=0.5)
    args = parser.parse_args()
    if args.windows < 1 or not 0 <= args.threshold <= 1:
        parser.error("windows must be positive and threshold must be between 0 and 1")
    if args.wav:
        with wave.open(str(args.wav)) as audio:
            if audio.getparams()[:3] != (1, 2, 48000):
                parser.error("expected mono 16-bit PCM at 48000 Hz")
            classify(lambda: audio.readframes(144000), args.model_dir, args.windows, args.threshold)
    else:
        command = ["arecord", "-q", "-D", args.device, "-t", "raw", "-f", "S16_LE", "-c", "1", "-r", "48000"]
        with subprocess.Popen(command, stdout=subprocess.PIPE) as capture, closing(capture.stdout):
            try:
                classify(lambda: capture.stdout.read(288000), args.model_dir, args.windows, args.threshold)
                if capture.poll() not in (None, 0):
                    raise SystemExit("Microphone capture failed")
            finally:
                capture.terminate()


if __name__ == "__main__":
    main()
