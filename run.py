"""
Holo Lab launcher - press Run in PyCharm.

Starts a tiny local web server for this folder and opens Holo Lab in Google Chrome
(falls back to your default browser). Uses only the Python standard library.
The camera works because the page is served from localhost.

Stop it with the red Stop button in PyCharm (or Ctrl+C).
"""
import functools
import http.server
import shutil
import socket
import subprocess
import sys
import threading
import webbrowser
from pathlib import Path

ROOT = Path(__file__).resolve().parent
PREFERRED_PORT = 8765


class Handler(http.server.SimpleHTTPRequestHandler):
    extensions_map = {
        **http.server.SimpleHTTPRequestHandler.extensions_map,
        ".js": "text/javascript",
        ".mjs": "text/javascript",
        ".wasm": "application/wasm",
        ".task": "application/octet-stream",
        ".css": "text/css",
    }

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")   # always load your latest edits
        super().end_headers()

    def log_message(self, fmt, *args):                 # keep the console quiet
        pass


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
    port = free_port(PREFERRED_PORT)
    server = http.server.ThreadingHTTPServer(("127.0.0.1", port), functools.partial(Handler, directory=str(ROOT)))
    url = f"http://localhost:{server.server_address[1]}/"
    print(f"Holo Lab running at {url}")
    print("Click INITIALIZE, allow the camera, then pinch things. Stop with the red square in PyCharm.")
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
