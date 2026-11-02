"""Isolated real HTTP host for headless checks; never opens live rooms or bridges."""
import socket
import sys
import threading
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import launch

with socket.socket() as probe:
    probe.bind(('127.0.0.1', 0))
    port = probe.getsockname()[1]
launch.SERVER_PORTS = (port,)
launch.bridge_status = lambda: {'ok': False}
url, server = launch.ensure_server()
base = server.RequestHandlerClass

class SafeHandler(base):
    def do_GET(self):
        if self.path == '/favicon.ico':
            self.send_response(204)
            self.end_headers()
            return
        if self.path.startswith(('/__start-bridge', '/__stop-bridge', '/__open-live', '/__open-scene')):
            return self._json(200, '{"ok":false,"error":"disabled in isolated tests"}')
        return super().do_GET()

server.RequestHandlerClass = SafeHandler
print('TEST_URL=' + url, flush=True)
try:
    threading.Event().wait()
except KeyboardInterrupt:
    pass
finally:
    server.shutdown()
    server.server_close()
