"""Bird photos for the dashboard: fetched once from iNaturalist, then served from a local cache.

Only the species' scientific name is sent to iNaturalist. A photo is used only if the taxon is a bird
(iconic taxon Aves) whose name matches exactly, and its licence allows reuse with credit.
Pre-fetch before a demo (offline venue Wi-Fi):  python -m dashboard.fetch_photos
"""
import json
import re
import urllib.parse
import urllib.request
from pathlib import Path

from dashboard.storage import DATA_DIR

CACHE = DATA_DIR / "photos"
CACHE.mkdir(exist_ok=True)
ALLOWED = {"pd": "Public domain", "cc0": "CC0", "cc-by": "CC BY", "cc-by-sa": "CC BY-SA",
           "cc-by-nc": "CC BY-NC", "cc-by-nc-sa": "CC BY-NC-SA"}  # Chirp is non-commercial; shown unchanged, with credit
HEADERS = {"User-Agent": "Chirp-dashboard/1.0", "Accept": "application/json"}
SAFE = re.compile(r"^[a-z]+(-[a-z]+)+$")


class Unreachable(Exception):
    """iNaturalist could not be reached; nothing is cached, so a later call retries."""


def scientific(label: str) -> str:
    return label.split("_", 1)[0].strip()


def slug(label: str) -> str:
    return re.sub(r"[^a-z]+", "-", scientific(label).lower()).strip("-")


def image_path(name: str) -> Path | None:
    stem = name.removesuffix(".jpg")
    return CACHE / f"{stem}.jpg" if SAFE.match(stem) else None


def _get(url: str, accept_json=True, timeout=8) -> bytes:
    req = urllib.request.Request(url, headers=HEADERS if accept_json else {"User-Agent": HEADERS["User-Agent"]})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read(3_000_000)


def _lookup(sci: str) -> dict:
    q = urllib.parse.urlencode({"q": sci, "rank": "species", "iconic_taxa": "Aves", "per_page": 10})
    results = json.loads(_get(f"https://api.inaturalist.org/v1/taxa?{q}")).get("results", [])
    # Exact match on the current name, or on the synonym iNaturalist matched (BirdNET uses some
    # older names, e.g. Emberiza schoeniclus is now Schoeniclus schoeniclus). Never a fuzzy match.
    exact = lambda t: sci.lower() in {t.get("name", "").lower(), (t.get("matched_term") or "").lower()}
    taxon = next((t for t in results if exact(t) and t.get("iconic_taxon_name") == "Aves"), None)
    if not taxon:
        return {"available": False, "reason": "no matching bird"}
    usable = lambda p: p and ALLOWED.get((p.get("license_code") or "").lower())
    photo = taxon.get("default_photo")
    if not usable(photo):  # the default photo's licence doesn't allow reuse: try the species' other photos
        detail = json.loads(_get(f"https://api.inaturalist.org/v1/taxa/{taxon['id']}")).get("results", [{}])[0]
        photo = next((tp["photo"] for tp in detail.get("taxon_photos", []) if usable(tp.get("photo"))), None)
    if not usable(photo):
        return {"available": False, "reason": "no photo with a reusable licence"}
    licence = usable(photo)
    return {"available": True, "url": photo.get("medium_url") or photo.get("url"), "licence": licence,
            "credit": photo.get("attribution") or "iNaturalist contributor",
            "source": f"https://www.inaturalist.org/taxa/{taxon['id']}"}


def photo(label: str) -> dict:
    """Metadata for a BirdNET label, from cache or fetched once. Raises Unreachable on network failure."""
    s = slug(label)
    if not SAFE.match(s):
        return {"available": False}
    meta_file = CACHE / f"{s}.json"
    if meta_file.exists():
        meta = json.loads(meta_file.read_text(encoding="utf-8"))
    else:
        try:
            meta = _lookup(scientific(label))
            if meta["available"]:
                img = _get(meta.pop("url"), accept_json=False, timeout=15)
                tmp = CACHE / f"{s}.part"
                tmp.write_bytes(img)
                tmp.replace(CACHE / f"{s}.jpg")
        except (OSError, ValueError) as e:  # network down, timeout or a bad response: don't cache, retry later
            raise Unreachable(str(e)) from e
        meta_file.write_text(json.dumps(meta), encoding="utf-8")  # also caches "no photo", so it isn't re-asked
    if not meta.get("available") or not (CACHE / f"{s}.jpg").exists():
        return {"available": False}
    return {"available": True, "image": f"/api/species-photo/file/{s}.jpg",
            "credit": meta["credit"], "licence": meta["licence"], "source": meta["source"]}
