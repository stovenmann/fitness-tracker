"""Serve Fitness Tracker locally with a stand-in for its Cloudflare API, for testing in a browser.

    python tools/dev_server.py [port]

Open http://localhost:8765/ . Add ?seed=1 for made-up sample data, ?clear=1 to start empty;
tools/mock-api.js lists the other flags (no signal, signed out, a server problem, ...).
The page is public/index.html with three things put in before the app's own script:
window.__DL_TEST__ (so the app exposes its pure functions on window.__DL), tools/mock-api.js
(the stand-in API) and tools/swim-tests.js (logic tests, run from the console with
runSwimTests()). Cloudflare serves public/ as it is and never sees any of them.

Other files the page links to (the manifest, icons) are served from public/, as on Cloudflare.
Everything else comes from the repo: http://localhost:8765/tools/tests.html runs all the checks
(the Worker's, then the app's). Never serve export/ to anything but this machine.
"""
import http.server
import pathlib
import sys
import urllib.parse

ROOT = pathlib.Path(__file__).resolve().parent.parent
PUBLIC = ROOT / "public"
PAGE = PUBLIC / "index.html"
INJECT = (
    b'<script>window.__DL_TEST__=true</script>'
    b'<script src="/tools/mock-api.js"></script>'
    b'<script src="/tools/swim-tests.js"></script>'
)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def translate_path(self, path):
        # a file that Cloudflare would serve from public/ is served from there here too
        rel = urllib.parse.unquote(urllib.parse.urlsplit(path).path).lstrip("/")
        if rel and ".." not in rel.split("/"):
            candidate = PUBLIC / rel
            if candidate.is_file():
                return str(candidate)
        return super().translate_path(path)

    def do_GET(self):
        if self.path == "/" or self.path.startswith("/?") or self.path.startswith("/#"):
            src = PAGE.read_bytes()
            if src.count(b"<body>") != 1:
                self.send_error(500, "public/index.html should have exactly one <body>")
                return
            body = src.replace(b"<body>", b"<body>" + INJECT, 1)
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(body)))
            self.end_headers()
            self.wfile.write(body)
            return
        super().do_GET()


if __name__ == "__main__":
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 8765
    http.server.ThreadingHTTPServer(("127.0.0.1", port), Handler).serve_forever()
