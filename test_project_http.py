"""Loopback HTTP integration without opening any desktop or browser windows."""
import json
import threading
import unittest
import urllib.error
import urllib.request
from http.server import ThreadingHTTPServer

import launch
from test_project_registry import ProjectFixture


class ProjectHttpTests(ProjectFixture, unittest.TestCase):
    def test_http_registry_static_pages_and_project_signalling(self):
        handler = self.handler_class()
        server = ThreadingHTTPServer(('127.0.0.1', 0), handler)
        launch.ACTIVE_PORT = server.server_address[1]
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        base = 'http://127.0.0.1:' + str(launch.ACTIVE_PORT)
        opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

        def request(path, body=None):
            data = json.dumps(body).encode() if body is not None else None
            req = urllib.request.Request(base + path, data=data,
                headers={'Sec-Fetch-Site':'same-origin','Content-Type':'application/json'})
            with opener.open(req, timeout=3) as response:
                return response.status, response.read(), response.headers

        try:
            status, raw, _ = request('/__projects')
            self.assertEqual(status, 200)
            self.assertEqual(len(json.loads(raw)['projects']), 2)
            status, raw, headers = request('/projects/starter/index.html')
            self.assertEqual(status, 200)
            self.assertIn(b'<html>', raw)
            self.assertIn('no-store', headers['Cache-Control'])
            request('/__scene-message', {'project':'starter','client':'main',
                'message':{'type':'view-offer','sdp':{'sdp':'starter-only'}}})
            _, raw, _ = request('/__scene-events?project=starter&client=viewer&after=0')
            self.assertEqual(json.loads(raw)['messages'][0]['sdp']['sdp'], 'starter-only')
            _, raw, _ = request('/__scene-events?project=avatar-printer&client=viewer')
            self.assertEqual(json.loads(raw), {'cursor':0,'messages':[]})
            with self.assertRaises(urllib.error.HTTPError) as error:
                request('/__scene-message', {'project':'missing','client':'main','message':{'type':'view-ping'}})
            self.assertEqual(error.exception.code, 400)
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=3)


if __name__ == '__main__':
    unittest.main()
