"""Local Chirp upload demo. Run with Arduino's adb.exe as the first argument."""
import base64
import json
import subprocess
import sys
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Lock

ADB = sys.argv[1]
BOARD = ["-s", "432839798"]
LOCK = Lock()
PAGE = Path(__file__).with_name("listen.html")


class Handler(BaseHTTPRequestHandler):
    def reply(self, status, kind, data):
        self.send_response(status)
        self.send_header("Content-Type", kind)
        self.send_header("Content-Length", str(len(data)))
        self.end_headers()
        self.wfile.write(data)

    def do_GET(self):
        if self.path == "/":
            self.reply(200, "text/html; charset=utf-8", PAGE.read_bytes())
        elif self.path == "/sample.wav":
            sample = subprocess.run([ADB, *BOARD, "exec-out", "cat /home/arduino/chirp-test/soundscape.wav"],
                                    capture_output=True, timeout=30)
            if sample.stdout.startswith(b"RIFF"):
                self.reply(200, "audio/wav", sample.stdout)
            else:
                self.send_error(503, "Connect the UNO Q over USB")
        else:
            self.send_error(404)

    def do_POST(self):
        if self.path != "/analyse" or self.headers.get("Content-Type") != "application/octet-stream":
            return self.send_error(400)
        origin = self.headers.get("Origin")
        if origin and origin not in ("http://localhost:8765", "http://127.0.0.1:8765"):
            return self.send_error(403)
        size = int(self.headers.get("Content-Length", "0"))
        if not 288000 <= size <= 11520000 or size % 288000:
            return self.send_error(400, "Expected complete three-second audio windows")
        audio = self.rfile.read(size)
        windows = size // 288000
        command = ("cd /home/arduino/chirp-test && base64 -d | PYTHONPATH=lib python3 -c "
                   "\"import sys; from bird_audio import classify, Path; "
                   f"classify(lambda: sys.stdin.buffer.read(288000), Path.cwd(), {windows}, 0.5)\"")
        try:
            with LOCK:
                run = subprocess.run([ADB, *BOARD, "shell", "-T", command], input=base64.b64encode(audio),
                                     capture_output=True, timeout=90, check=True)
            rows = [json.loads(line) for line in run.stdout.splitlines() if line.startswith(b"{")]
            if len(rows) != windows:
                raise ValueError("Incomplete response")
            self.reply(200, "application/json", json.dumps(rows).encode())
        except (ValueError, subprocess.SubprocessError, OSError):
            self.reply(503, "text/plain", b"Board analysis failed. Check the UNO Q USB connection and retry.")


ThreadingHTTPServer(("127.0.0.1", 8765), Handler).serve_forever()
