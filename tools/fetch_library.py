"""
Holo Lab object library downloader.

Downloads a starter set of free 3-D models ONCE into library/models/, so voice commands like
"show me a toy car" work offline. Every model's licence and credit is recorded in
library/index.json and library/LICENSES.md.

Only models with a clear free licence are included (CC0 = no conditions, CC-BY = credit the author).

Usage (from the holo-lab folder, or right-click > Run in PyCharm):
  python tools/fetch_library.py            show the list and ask before downloading
  python tools/fetch_library.py --yes      download without asking
  python tools/fetch_library.py --only toy_car,lantern
  python tools/fetch_library.py --scan     just (re)index .glb files you put in library/models yourself

Your own models: drop any .glb file into library/models/ and run with --scan. The file name becomes
its voice name ("jet_engine.glb" -> "show me a jet engine").
"""
import argparse
import json
import shutil
import subprocess
import sys
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
LIB = ROOT / "library"
MODELS = LIB / "models"
REPO = "https://raw.githubusercontent.com/KhronosGroup/glTF-Sample-Assets/main/Models"

CURATED = [
    # id,            Khronos name,      display name,      aliases
    ("toy_car", "ToyCar", "Toy Car", ["toy car", "car", "race car", "vehicle", "automobile"]),
    ("milk_truck", "CesiumMilkTruck", "Milk Truck", ["truck", "milk truck", "lorry", "delivery truck", "van"]),
    ("lantern", "Lantern", "Lantern", ["lantern", "lamp", "street lamp", "street light"]),
    ("camera", "AntiqueCamera", "Antique Camera", ["camera", "antique camera", "old camera", "tripod camera"]),
    ("boombox", "BoomBox", "Boom Box", ["boombox", "boom box", "radio", "stereo", "speaker"]),
    ("water_bottle", "WaterBottle", "Water Bottle", ["water bottle", "bottle", "flask"]),
    ("helmet", "DamagedHelmet", "Sci-Fi Helmet", ["helmet", "sci fi helmet", "damaged helmet", "space helmet", "pilot helmet"]),
    ("avocado", "Avocado", "Avocado", ["avocado", "fruit"]),
]


def fetch_bytes(url, timeout=120):
    """curl first (macOS python.org builds often lack SSL certificates), urllib as a fallback."""
    if shutil.which("curl"):
        r = subprocess.run(["curl", "-sfL", "--max-time", str(timeout), url], capture_output=True)
        if r.returncode == 0:
            return r.stdout
        raise RuntimeError(f"download failed ({r.returncode}): {url}")
    with urllib.request.urlopen(url, timeout=timeout) as r:
        return r.read()


def head_size(url):
    try:
        if shutil.which("curl"):
            out = subprocess.run(["curl", "-sIL", url], capture_output=True, text=True).stdout
            sizes = [line.split(":", 1)[1].strip() for line in out.splitlines() if line.lower().startswith("content-length")]
            return int(sizes[-1]) if sizes else 0
    except Exception:  # noqa: BLE001
        pass
    return 0


def licence_of(khronos_name):
    """Licence + credit from the model's metadata.json in the Khronos repository."""
    try:
        meta = json.loads(fetch_bytes(f"{REPO}/{khronos_name}/metadata.json", 30))
        legal = meta.get("legal", [])
        lic = "; ".join(sorted({x.get("license", "?") for x in legal})) or "unknown"
        credit = "; ".join(f"{x.get('artist') or x.get('owner')} ({x.get('year', '')})".replace(" ()", "") for x in legal if x.get("artist") or x.get("owner"))
        return lic, credit
    except Exception:  # noqa: BLE001
        return "unknown", ""


def load_index():
    p = LIB / "index.json"
    if p.exists():
        try:
            return json.loads(p.read_text())
        except json.JSONDecodeError:
            pass
    return {"models": []}


def save_index(index):
    LIB.mkdir(exist_ok=True)
    index["models"].sort(key=lambda m: m["name"].lower())
    (LIB / "index.json").write_text(json.dumps(index, indent=2))
    lines = ["# Object library licences", "", "Every model in library/models and where it came from.", ""]
    for m in index["models"]:
        lines.append(f"- **{m['name']}** (`{m['file']}`) - {m['license']}" + (f" - credit: {m['attribution']}" if m.get("attribution") else "") + f" - source: {m['source']}")
    (LIB / "LICENSES.md").write_text("\n".join(lines) + "\n")


def scan(index):
    """Index any .glb the user dropped into library/models that isn't listed yet."""
    known = {m["file"] for m in index["models"]}
    added = 0
    for f in sorted(MODELS.glob("*.glb")):
        rel = f"library/models/{f.name}"
        if rel in known:
            continue
        name = f.stem.replace("_", " ").replace("-", " ").strip().title()
        index["models"].append({"id": f.stem.lower(), "name": name, "aliases": [name.lower()], "tags": ["my models"],
                                "file": rel, "license": "your own file", "source": "added by you"})
        added += 1
        print(f"  + indexed your model: {name}")
    return added


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--yes", action="store_true")
    ap.add_argument("--only", default="")
    ap.add_argument("--scan", action="store_true")
    args = ap.parse_args()
    MODELS.mkdir(parents=True, exist_ok=True)
    index = load_index()

    if args.scan:
        n = scan(index)
        save_index(index)
        print(f"Done - {n} new model(s) indexed, {len(index['models'])} in the library.")
        return

    wanted = [c for c in CURATED if not args.only or c[0] in args.only.split(",")]
    have = {m["id"] for m in index["models"]}
    todo = [c for c in wanted if c[0] not in have or not (MODELS / f"{c[0]}.glb").exists()]
    if not todo:
        print("Everything is already downloaded.")
        scan(index)
        save_index(index)
        return

    print("Holo Lab will download these free 3-D models (from github.com/KhronosGroup/glTF-Sample-Assets):\n")
    total = 0
    plan = []
    for cid, kname, name, aliases in todo:
        url = f"{REPO}/{kname}/glTF-Binary/{kname}.glb"
        size = head_size(url)
        lic, credit = licence_of(kname)
        total += size
        plan.append((cid, kname, name, aliases, url, lic, credit))
        print(f"  {name:16} {size / 1e6:6.1f} MB   {lic}" + (f"   credit: {credit}" if credit and 'CC0' not in lic else ""))
    print(f"\n  Total: {total / 1e6:.1f} MB into {MODELS}\n")
    if not args.yes:
        if input("Download now? [y/N] ").strip().lower() not in ("y", "yes"):
            print("Cancelled - nothing downloaded.")
            return

    for cid, kname, name, aliases, url, lic, credit in plan:
        print(f"  downloading {name} ...", end="", flush=True)
        try:
            data = fetch_bytes(url)
        except Exception as e:  # noqa: BLE001
            print(f" FAILED ({e})")
            continue
        (MODELS / f"{cid}.glb").write_bytes(data)
        index["models"] = [m for m in index["models"] if m["id"] != cid]
        index["models"].append({
            "id": cid, "name": name, "aliases": aliases, "tags": [],
            "file": f"library/models/{cid}.glb", "license": lic, "attribution": credit,
            "source": f"Khronos glTF Sample Assets - {kname}",
        })
        print(f" {len(data) / 1e6:.1f} MB ok")
    scan(index)
    save_index(index)
    print(f"\nDone. {len(index['models'])} models in the library. Licences: library/LICENSES.md")


if __name__ == "__main__":
    try:
        main()
    except KeyboardInterrupt:
        sys.exit("\nCancelled.")
