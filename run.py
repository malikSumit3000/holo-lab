"""
Holo Lab launcher - press Run in PyCharm.

Starts a tiny local web server for this folder and opens Holo Lab in Google Chrome
(falls back to your default browser). Uses only the Python standard library.
The camera works because the page is served from localhost.

It also bridges to your LOCAL AI (Ollama) for "make me a ..." object generation:
  GET  /api/ai-status   -> is Ollama running, which model will be used
  POST /api/generate    -> {"request": "a rocket"}  ->  {"spec": {...part list...}}
If Ollama isn't running, it tries to start the Ollama app for you.
Pick a different model with:  HOLO_MODEL=llama3.2 python run.py

Options:  --port 8765   --no-browser
Stop it with the red Stop button in PyCharm (or Ctrl+C).
"""
import argparse
import functools
import http.server
import json
import os
import shutil
import socket
import subprocess
import sys
import threading
import time
import urllib.error
import urllib.request
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PREFERRED_PORT = 8765
OLLAMA = os.environ.get("OLLAMA_HOST", "http://127.0.0.1:11434").rstrip("/")
PREFERRED_MODELS = ("qwen3", "qwen2.5", "llama3", "gemma", "mistral")

# ----------------------------------------------------------------------------------------------
# Local AI (Ollama)
# ----------------------------------------------------------------------------------------------
PART = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "what": {"type": "string"},
        "shape": {"type": "string", "enum": ["box", "cylinder", "sphere", "cone", "torus", "capsule"]},
        "size": {"type": "array", "items": {"type": "number"}},
        "color": {"type": "string"},
        "attach_to": {"type": "string"},
        "side": {"type": "string", "enum": ["top", "bottom", "left", "right", "front", "back", "center"]},
        "align": {"type": "string", "enum": ["middle", "top", "bottom", "front", "back", "left", "right"]},
        "mirror": {"type": "boolean"},
        "repeat": {"type": "integer"},
        "pattern": {"type": "string", "enum": ["none", "ring", "corners"]},
        "axis": {"type": "string", "enum": ["y", "x", "z"]},
        "pointing": {"type": "string", "enum": ["up", "down", "left", "right", "front", "back"]},
        "inset": {"type": "number"},
    },
    "required": ["name", "shape", "size"],
}
SCHEMA = {
    "type": "object",
    "properties": {
        "name": {"type": "string"},
        "description": {"type": "string"},
        "parts": {"type": "array", "items": PART, "minItems": 4, "maxItems": 16},
    },
    "required": ["name", "parts"],
}

SYSTEM_PROMPT = """You are a 3D designer. You describe objects as simple shapes and HOW THEY ATTACH to each other.
You never give coordinates - the program places every part exactly from your attachments.

Each part:
  "shape": box | cylinder | sphere | cone | torus | capsule
  "size": [width, height, depth] of the part's bounding box (x = width left-right, y = height, z = depth front-back).
          A 0.8-wide round pole 2 tall is "size": [0.8, 2, 0.8].
  "axis" (cylinder/capsule/torus): the long axis, "y" (vertical, default), "x" (left-right) or "z" (front-back).
          A horizontal axle 2 wide is a cylinder with "axis":"x","size":[2,0.2,0.2]. A wheel is a cylinder with "axis":"x".
  "pointing" (cone only): which way the tip points - up (default), down, left, right, front, back.
  "attach_to": the name of an EARLIER part. The FIRST part is the main body and has no attach_to.
  "side": where on that part it attaches - top, bottom, left, right, front, back, or center (inside it).
  "align": slide it along that face - for left/right/front/back sides: top, middle or bottom;
           for top/bottom sides: middle, front, back, left or right.
  "mirror": true makes a matching copy on the opposite side (left+right arms, wings, ears).
  "repeat": N with "pattern":"corners" puts N copies at the corners of the top/bottom face (table legs, car wheels).
  "repeat": N with "pattern":"ring" puts N copies evenly around the part (rocket fins, chair legs round a base).
  "inset": 0 to 0.9 - how far it sinks into the part it attaches to (0 = just touching).
  "color": cyan, blue, magenta, purple, gold, yellow, orange, green, red, white, silver or brown.
  "what": what the part does, max 10 words.

Rules:
- 5 to 14 parts (never more than 16) - only the important, visible pieces. Real names (e.g. "Nose Cone", "Fuel Tank", "Fin"). Name mirrored/repeated parts in the singular ("Arm", "Leg").
- Use realistic proportions: thin things are thin (a chair back is ~0.1 deep, a fin is ~0.05 thick).
- Attach detail parts to the part they belong to (Eyes attach to Head, not to Torso).
- Return ONLY the JSON object.

Example request: "a robot"
{"name":"Robot","description":"A friendly humanoid robot.","parts":[
 {"name":"Torso","shape":"box","size":[1.0,1.2,0.6],"color":"silver","what":"Holds the battery and motors."},
 {"name":"Neck","shape":"cylinder","size":[0.25,0.15,0.25],"attach_to":"Torso","side":"top","color":"gold","what":"Lets the head turn."},
 {"name":"Head","shape":"box","size":[0.7,0.6,0.6],"attach_to":"Neck","side":"top","color":"silver","what":"Holds the cameras and speakers."},
 {"name":"Eye","shape":"sphere","size":[0.15,0.15,0.1],"attach_to":"Head","side":"front","align":"top","mirror":false,"inset":0.3,"color":"cyan","what":"Camera that lets it see."},
 {"name":"Antenna","shape":"cylinder","size":[0.05,0.35,0.05],"attach_to":"Head","side":"top","color":"red","what":"Receives radio commands."},
 {"name":"Arm","shape":"capsule","size":[0.22,1.0,0.22],"attach_to":"Torso","side":"left","align":"top","mirror":true,"color":"silver","what":"Moves and lifts things."},
 {"name":"Hand","shape":"sphere","size":[0.26,0.26,0.26],"attach_to":"Arm","side":"bottom","color":"gold","what":"Grips objects."},
 {"name":"Leg","shape":"capsule","size":[0.3,1.1,0.3],"attach_to":"Torso","side":"bottom","align":"left","mirror":false,"repeat":2,"pattern":"corners","color":"silver","what":"Walks and balances."},
 {"name":"Chest Light","shape":"cylinder","size":[0.3,0.3,0.05],"axis":"z","attach_to":"Torso","side":"front","inset":0.5,"color":"cyan","what":"Shows the power level."}
]}

Example request: "a rocket"
{"name":"Rocket","description":"A small space rocket.","parts":[
 {"name":"Body","shape":"cylinder","size":[0.6,2.4,0.6],"color":"white","what":"Holds the fuel tanks."},
 {"name":"Nose Cone","shape":"cone","size":[0.6,0.7,0.6],"attach_to":"Body","side":"top","color":"red","what":"Cuts through the air."},
 {"name":"Window","shape":"cylinder","size":[0.2,0.2,0.05],"axis":"z","attach_to":"Body","side":"front","align":"top","inset":0.5,"color":"cyan","what":"Lets the crew look out."},
 {"name":"Fin","shape":"box","size":[0.45,0.6,0.05],"attach_to":"Body","side":"left","align":"bottom","repeat":4,"pattern":"ring","color":"red","what":"Keeps the rocket flying straight."},
 {"name":"Engine","shape":"cylinder","size":[0.4,0.25,0.4],"attach_to":"Body","side":"bottom","color":"silver","what":"Burns fuel to make thrust."},
 {"name":"Nozzle","shape":"cone","size":[0.45,0.4,0.45],"pointing":"up","attach_to":"Engine","side":"bottom","color":"orange","what":"Shapes the exhaust jet."}
]}"""


def ollama(path, payload=None, timeout=10):
    data = json.dumps(payload).encode() if payload is not None else None
    req = urllib.request.Request(OLLAMA + path, data=data, headers={"Content-Type": "application/json"},
                                 method="POST" if data else "GET")
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return json.loads(r.read().decode())


def ollama_up():
    try:
        ollama("/api/version", timeout=2)
        return True
    except Exception:
        return False


_start_lock = threading.Lock()


def ensure_ollama():
    """Start Ollama if it isn't running (opens the Ollama app on macOS). Returns True when reachable."""
    if ollama_up():
        return True
    with _start_lock:
        if ollama_up():
            return True
        print("[ai] Ollama isn't running - starting it...")
        try:
            if sys.platform == "darwin" and Path("/Applications/Ollama.app").exists():
                subprocess.Popen(["open", "-a", "Ollama"])
            elif shutil.which("ollama"):
                subprocess.Popen(["ollama", "serve"], stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
            else:
                return False
        except OSError:
            return False
        for _ in range(40):
            time.sleep(0.5)
            if ollama_up():
                print("[ai] Ollama is up.")
                return True
    return False


def pick_model():
    wanted = os.environ.get("HOLO_MODEL")
    models = [m["name"] for m in ollama("/api/tags").get("models", [])]
    if wanted:
        return wanted, models
    for pref in PREFERRED_MODELS:
        for m in models:
            if m.startswith(pref):
                return m, models
    return (models[0] if models else None), models


def ai_status():
    if not ensure_ollama():
        return {"ok": False, "error": "Ollama isn't installed or won't start. Install it from ollama.com, then run: ollama pull qwen3"}
    model, models = pick_model()
    if not model:
        return {"ok": False, "error": "Ollama has no models. In a terminal run: ollama pull qwen3"}
    return {"ok": True, "model": model, "models": models}


def generate(request_text):
    status = ai_status()
    if not status["ok"]:
        return 503, {"error": status["error"]}
    payload = {
        "model": status["model"],
        "stream": False,
        "format": SCHEMA,
        "think": False,                       # qwen3: answer directly, no slow "thinking"
        "options": {"temperature": 0.4, "num_ctx": 8192, "num_predict": 2200, "repeat_penalty": 1.15},
        "messages": [
            {"role": "system", "content": SYSTEM_PROMPT},
            {"role": "user", "content": f"Design: {request_text}"},
        ],
    }
    t0 = time.time()
    try:
        try:
            out = ollama("/api/chat", payload, timeout=240)
        except urllib.error.HTTPError as e:      # older Ollama / non-thinking model: retry without "think"
            if e.code == 400:
                payload.pop("think", None)
                out = ollama("/api/chat", payload, timeout=240)
            else:
                raise
        content = out.get("message", {}).get("content", "")
        spec = json.loads(content)
    except json.JSONDecodeError:
        return 502, {"error": "The AI returned something that isn't valid JSON"}
    except Exception as e:  # noqa: BLE001
        return 502, {"error": f"AI request failed: {e}"}
    print(f"[ai] designed '{request_text}' with {status['model']} in {time.time() - t0:.1f}s")
    return 200, {"spec": spec, "model": status["model"], "seconds": round(time.time() - t0, 1)}


# ----------------------------------------------------------------------------------------------
# Web server
# ----------------------------------------------------------------------------------------------
class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".wasm": "application/wasm",
        ".task": "application/octet-stream",
        ".glb": "model/gltf-binary",
        ".css": "text/css",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")   # always load your latest edits
        super().end_headers()

    def log_message(self, fmt, *args):                 # keep the console quiet
        pass

    def _json(self, code, obj):
        body = json.dumps(obj).encode()
        self.send_response(code)
        self.send_header("Content-Type", "application/json")
        self.send_header("Content-Length", str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_GET(self):
        if self.path.split("?")[0] == "/api/ai-status":
            return self._json(200, ai_status())
        return super().do_GET()

    def do_POST(self):
        if self.path.split("?")[0] != "/api/generate":
            return self._json(404, {"error": "not found"})
        try:
            length = min(int(self.headers.get("Content-Length", 0)), 10_000)
            req = json.loads(self.rfile.read(length) or b"{}")
            text = str(req.get("request", "")).strip()[:200]
        except (ValueError, json.JSONDecodeError):
            return self._json(400, {"error": "bad request"})
        if not text:
            return self._json(400, {"error": "say what to make"})
        code, obj = generate(text)
        return self._json(code, obj)


def free_port(preferred):
    for port in [preferred, *range(preferred + 1, preferred + 50)]:
        with socket.socket() as s:
            if s.connect_ex(("127.0.0.1", port)) != 0:
                return port
    return 0


def open_browser(url):
    chrome = Path("/Applications/Google Chrome.app")
    if sys.platform == "darwin" and chrome.exists() and shutil.which("open"):
        subprocess.Popen(["open", "-a", str(chrome), url])
    else:
        webbrowser.open(url)


def main():
    ap = argparse.ArgumentParser(description="Holo Lab launcher")
    ap.add_argument("--port", type=int, default=PREFERRED_PORT)
    ap.add_argument("--no-browser", action="store_true", help="don't open Chrome")
    args = ap.parse_args()
    port = free_port(args.port)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(Handler, directory=str(ROOT)))
    url = f"http://localhost:{server.server_address[1]}/"
    print(f"Holo Lab running at {url}")
    print("Click INITIALIZE, allow the camera, then pinch things. Stop with the red square in PyCharm.")
    if not args.no_browser:
        threading.Timer(0.6, open_browser, args=(url,)).start()
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
        print("Holo Lab stopped.")


if __name__ == "__main__":
    main()
