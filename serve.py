"""Local development server for Pickle Rally.

Same as `python -m http.server 8000`, but it tells the browser never to cache
files, so every refresh always loads the latest game code.

Run:  python serve.py        then open http://localhost:8000
"""
import http.server
import os
import sys

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8000


class NoCacheHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Expires', '0')
        super().end_headers()


if __name__ == '__main__':
    os.chdir(os.path.dirname(os.path.abspath(__file__)))
    server = http.server.ThreadingHTTPServer(('', PORT), NoCacheHandler)
    print(f'Pickle Rally running at http://localhost:{PORT}  (Ctrl+C to stop)')
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
