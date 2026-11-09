"""Serve this static app on localhost, the secure camera context required by browsers."""
import argparse
import functools
import http.server
from pathlib import Path
import threading
import webbrowser

parser = argparse.ArgumentParser(description="Motion Roulette local preview")
parser.add_argument("--port", type=int, default=4175)
parser.add_argument("--no-open", action="store_true")
args = parser.parse_args()
root = Path(__file__).resolve().parents[1]

class QuietHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def log_message(self, *_args):
        pass

handler = functools.partial(QuietHandler, directory=str(root))
try:
    server = http.server.ThreadingHTTPServer(("127.0.0.1", args.port), handler)
except OSError as error:
    raise SystemExit(f"Port {args.port} is unavailable. Try: python tools/serve.py --port {args.port + 1}\n{error}")
url = f"http://127.0.0.1:{args.port}/#draw"
print(f"Motion Roulette: {url}\nKeep this window open. Ctrl+C stops the preview.", flush=True)
if not args.no_open:
    threading.Timer(0.6, lambda: webbrowser.open(url)).start()
try:
    server.serve_forever()
except KeyboardInterrupt:
    pass
finally:
    server.server_close()
