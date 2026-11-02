"""Port selection and isolated scene-window startup without opening native UI."""
import io
import json
import os
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import launch


class LaunchPortTests(unittest.TestCase):
    def setUp(self):
        self.original_port = launch.ACTIVE_PORT
        self.addCleanup(setattr, launch, 'ACTIVE_PORT', self.original_port)
        fixture = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent)
        self.addCleanup(fixture.cleanup)
        root = Path(fixture.name)
        folder = root / 'projects' / 'avatar-printer'
        folder.mkdir(parents=True)
        (folder / 'index.html').write_text('<html></html>', encoding='utf-8')
        (folder / 'project.json').write_text(json.dumps({'id':'avatar-printer', 'name':'头像打印机',
            'entry':'index.html', 'viewerTitle':'直播小窗 · Avatar Printer'}), encoding='utf-8')
        root_patch = patch.object(launch, 'ROOT', root)
        root_patch.start()
        self.addCleanup(root_patch.stop)

    def test_first_start_uses_8080(self):
        with patch('launch.listening', return_value=False), \
                patch('launch.ThreadingHTTPServer') as server_factory, \
                patch('launch.threading.Thread') as thread:
            url, server = launch.ensure_server()
        self.assertEqual(url, 'http://127.0.0.1:8080/')
        self.assertEqual(launch.ACTIVE_PORT, 8080)
        self.assertIs(server, server_factory.return_value)
        self.assertEqual(server_factory.call_args.args[0], ('127.0.0.1', 8080))
        thread.return_value.start.assert_called_once()

    def test_foreign_8080_service_uses_8081(self):
        with patch('launch.listening', side_effect=lambda port: port == 8080), \
                patch('launch.local_get', return_value=io.BytesIO(b'another application')), \
                patch('launch.ThreadingHTTPServer') as server_factory, \
                patch('launch.threading.Thread'):
            url, _ = launch.ensure_server()
        self.assertEqual(url, 'http://127.0.0.1:8081/')
        self.assertEqual(launch.ACTIVE_PORT, 8081)
        self.assertEqual(server_factory.call_args.args[0], ('127.0.0.1', 8081))

    def test_existing_printer_server_is_reused(self):
        status = json.dumps({'service':'live-project-framework', 'identity':str(launch.ROOT)}).encode()
        with patch('launch.listening', return_value=True), \
                patch('launch.local_get', return_value=io.BytesIO(status)), \
                patch('launch.ThreadingHTTPServer') as server_factory:
            url, server = launch.ensure_server()
        self.assertEqual(url, 'http://127.0.0.1:8080/')
        self.assertIsNone(server)
        server_factory.assert_not_called()

    def test_bind_race_tries_the_next_port(self):
        server = Mock()
        with patch('launch.listening', return_value=False), \
                patch('launch.ThreadingHTTPServer', side_effect=[OSError('port in use'), server]) as server_factory, \
                patch('launch.threading.Thread'):
            url, actual_server = launch.ensure_server()
        self.assertEqual(url, 'http://127.0.0.1:8081/')
        self.assertIs(actual_server, server)
        self.assertEqual([call.args[0][1] for call in server_factory.call_args_list], [8080, 8081])

    def test_all_ports_occupied_reports_the_candidates(self):
        with patch('launch.listening', return_value=True), \
                patch('launch.local_get', side_effect=OSError('unrelated service')), \
                patch('launch.ThreadingHTTPServer') as server_factory:
            with self.assertRaises(RuntimeError) as error:
                launch.ensure_server()
        self.assertIn('均被占用或不可用', str(error.exception))
        for port in launch.SERVER_PORTS:
            self.assertIn(str(port), str(error.exception))
        server_factory.assert_not_called()

    def test_scene_child_receives_the_active_port(self):
        launch.ACTIVE_PORT = 8181
        with patch('launch.subprocess.Popen') as spawn:
            launch.DesktopApi().open_scene_window(orient='portrait')
        command = spawn.call_args.args[0]
        self.assertEqual(command[command.index('--server-port') + 1], '8181')
        self.assertEqual(command[command.index('--scene-orient') + 1], 'portrait')

    def test_scene_process_opens_the_inherited_origin(self):
        webview = Mock()
        with patch.object(sys, 'argv', ['launch.py', '--scene-view', '--server-port', '8181']), \
                patch.dict(sys.modules, {'webview': webview}), \
                patch.dict(os.environ), \
                patch('launch.ensure_server') as ensure_server:
            launch.main()
        self.assertEqual(webview.create_window.call_args.args[1],
            'http://127.0.0.1:8181/framework/web/live-view.html?project=avatar-printer')
        self.assertEqual(launch.ACTIVE_PORT, 8181)
        ensure_server.assert_not_called()
        webview.start.assert_called_once()


if __name__ == '__main__':
    unittest.main()
