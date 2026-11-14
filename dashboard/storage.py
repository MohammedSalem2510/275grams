import os
from pathlib import Path

DATA_DIR = Path(os.environ.get("CHIRP_DATA_DIR") or Path(__file__).resolve().parent)
DATA_DIR.mkdir(parents=True, exist_ok=True)
