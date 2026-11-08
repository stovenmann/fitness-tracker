"""Serve Deck Log locally with a fake claude.ai runtime, for testing in a browser.

    python tools/dev_server.py [port]

Open http://localhost:8765/ . Add ?seed=1 for synthetic sample data, ?clear=1 to start empty.
The page is artifact/deck-log.html with two scripts injected before the app's own:
tools/mock-claude.js (the fake runtime) and tools/swim-tests.js (logic tests, run from the
console with runSwimTests()). The published artifact never contains either.
"""
import http.server
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parent.parent
PAGE = ROOT / "artifact" / "deck-log.html"
INJECT = (
    b'<script>window.__DL_TEST__=true</script>'
    b'<script src="/tools/mock-claude.js"></script>'
    b'<script src="/tools/swim-tests.js"></script>'
)


class Handler(http.server.SimpleHTTPRequestHandler):
    def __init__(self, *args, **kwargs):
        super().__init__(*args, directory=str(ROOT), **kwargs)

    def end_headers(self):
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def do_GET(self):
        if self.path == "/" or self.path.startswith("/?") or self.path.startswith("/#"):
            body = PAGE.read_bytes().replace(b"<body>", b"<body>" + INJECT, 1)
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
