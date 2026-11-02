"""Project discovery, page boundaries, and isolated shared-service routing."""
import contextlib
import io
import json
import sys
import tempfile
import unittest
from pathlib import Path
from unittest.mock import Mock, patch

import launch
from framework.project_registry import discover_projects, get_project, project_from_scene_path


class ProjectFixture:
    def setUp(self):
        self.fixture = tempfile.TemporaryDirectory(dir=Path(__file__).resolve().parent)
        self.addCleanup(self.fixture.cleanup)
        self.root = Path(self.fixture.name)
        self.write_project('avatar-printer', '头像打印机')
        self.write_project('starter', '新项目演示')
        root_patch = patch.object(launch, 'ROOT', self.root)
        root_patch.start()
        self.addCleanup(root_patch.stop)
        self.original_port = launch.ACTIVE_PORT
        self.addCleanup(setattr, launch, 'ACTIVE_PORT', self.original_port)

    def write_project(self, project_id, name, **extra):
        folder = self.root / 'projects' / project_id
        folder.mkdir(parents=True, exist_ok=True)
        (folder / 'index.html').write_text('<html></html>', encoding='utf-8')
        (folder / 'index-en.html').write_text('<html lang="en"></html>', encoding='utf-8')
        data = {'id':project_id, 'name':name, 'description':'独立玩法', 'entry':'index.html',
                'entries':{'en':'index-en.html'}, 'viewerTitle':name + ' · 直播小窗'}
        data.update(extra)
        (folder / 'project.json').write_text(json.dumps(data), encoding='utf-8')
        return folder

    def handler_class(self):
        with patch('launch.listening', return_value=False), \
                patch('launch.ThreadingHTTPServer') as factory, patch('launch.threading.Thread'):
            launch.ensure_server()
        return factory.call_args.args[1]

    def request(self, handler_class, path, body=None, same_origin=True):
        handler = object.__new__(handler_class)
        handler.path = path
        handler.headers = {'Host':'127.0.0.1:' + str(launch.ACTIVE_PORT),
                           'Sec-Fetch-Site':'same-origin' if same_origin else 'cross-site'}
        handler._json = lambda status, value: (status, json.loads(value))
        if body is None:
            return handler.do_GET()
        payload = json.dumps(body).encode()
        handler.headers['Content-Length'] = str(len(payload))
        handler.rfile = io.BytesIO(payload)
        return handler.do_POST()


class ProjectTests(ProjectFixture, unittest.TestCase):
    def test_projects_have_independent_absolute_page_urls(self):
        result = discover_projects(self.root)
        self.assertEqual(result['errors'], [])
        self.assertEqual([p['id'] for p in result['projects']], ['avatar-printer', 'starter'])
        starter = get_project('starter', self.root)
        self.assertEqual(starter['entry'], '/projects/starter/index.html')
        self.assertEqual(starter['entries']['en'], '/projects/starter/index-en.html')

    def test_invalid_manifest_does_not_hide_other_projects(self):
        folder = self.write_project('broken', '错误项目')
        (folder / 'project.json').write_text('{broken json', encoding='utf-8')
        result = discover_projects(self.root)
        self.assertEqual(len(result['projects']), 2)
        self.assertEqual(result['errors'][0]['project'], 'broken')

    def test_entry_cannot_escape_project_or_point_to_remote_page(self):
        for entry in ('../../index.html', 'https://example.com/index.html', '/index.html', 'missing.html'):
            with self.subTest(entry=entry):
                self.write_project('invalid', '错误入口', entry=entry)
                self.assertEqual(len(discover_projects(self.root)['projects']), 2)
                with self.assertRaises(ValueError):
                    get_project('invalid', self.root)

    def test_manifest_id_must_match_directory_and_output_is_validated(self):
        self.write_project('mismatch', '错误项目', id='other')
        self.write_project('invalid-output', '错误输出', output={'mode':'arbitrary-code'})
        self.assertEqual(len(discover_projects(self.root)['errors']), 2)

    def test_scene_path_resolves_only_registered_projects(self):
        project = project_from_scene_path('/framework/web/live-view.html?project=starter', root=self.root)
        self.assertEqual(project['id'], 'starter')
        for path in ('https://example.com/live-view.html?project=starter',
                     '/index.html?project=starter', '/framework/web/live-view.html?project=missing',
                     '/framework/web/live-view.html?project=starter&project=avatar-printer'):
            with self.subTest(path=path), self.assertRaises(ValueError):
                project_from_scene_path(path, root=self.root)

    def test_projects_api_discovers_new_project_without_server_restart(self):
        handler = self.handler_class()
        status, result = self.request(handler, '/__projects')
        self.assertEqual(status, 200)
        self.assertEqual(len(result['projects']), 2)
        self.write_project('another', '新增项目')
        self.assertEqual(len(self.request(handler, '/__projects')[1]['projects']), 3)

    def test_framework_identity_is_workspace_specific(self):
        handler = self.handler_class()
        self.assertEqual(self.request(handler, '/__framework-status')[1],
            {'service':'live-project-framework', 'identity':str(self.root)})
        status = json.dumps({'service':'live-project-framework', 'identity':'F:/another/workspace'}).encode()
        with patch('launch.listening', side_effect=lambda port: port == 8080), \
                patch('launch.local_get', return_value=io.BytesIO(status)), \
                patch('launch.ThreadingHTTPServer'), patch('launch.threading.Thread'):
            url, _ = launch.ensure_server()
        self.assertEqual(url, 'http://127.0.0.1:8081/')

    def test_signal_cursors_and_messages_are_isolated_between_projects(self):
        handler = self.handler_class()
        for project, sender in [('avatar-printer','printer'), ('starter','starter')]:
            status, _ = self.request(handler, '/__scene-message', {'project':project,
                'client':sender, 'message':{'type':'view-offer','sdp':{'sdp':project}}})
            self.assertEqual(status, 200)
        for project in ('avatar-printer', 'starter'):
            status, result = self.request(handler, '/__scene-events?client=viewer&after=0&project='+project)
            self.assertEqual(status, 200)
            self.assertEqual(result['cursor'], 1)
            self.assertEqual([m['sdp']['sdp'] for m in result['messages']], [project])

    def test_unregistered_or_cross_origin_signal_requests_are_rejected(self):
        handler = self.handler_class()
        body = {'project':'missing', 'client':'viewer', 'message':{'type':'view-ping'}}
        self.assertEqual(self.request(handler, '/__scene-message', body)[0], 400)
        self.assertEqual(self.request(handler, '/__scene-message', body, same_origin=False)[0], 403)
        self.assertEqual(self.request(handler, '/__scene-events?client=viewer&project=missing')[0], 400)

    def test_switching_project_closes_old_scene_and_preserves_live_capture(self):
        api = launch.DesktopApi('avatar-printer')
        api._scene_process = Mock()
        api._scene_process.poll.return_value = None
        scene, bridge = api._scene_process, Mock()
        api._bridge = bridge
        launch.ACTIVE_PORT = 8181
        self.assertEqual(api.open_project('starter'), 'http://127.0.0.1:8181/projects/starter/index.html')
        scene.terminate.assert_called_once()
        bridge.terminate.assert_not_called()
        self.assertEqual(api._project, 'starter')
        with patch('launch.subprocess.Popen') as spawn:
            api.open_scene_window('/framework/web/live-view.html?project=starter', 'portrait')
        command = spawn.call_args.args[0]
        self.assertEqual(command[command.index('--project')+1], 'starter')

    def test_invalid_project_does_not_close_existing_scene(self):
        api = launch.DesktopApi('avatar-printer')
        api._scene_process = Mock()
        with self.assertRaises(ValueError):
            api.open_project('missing')
        api._scene_process.terminate.assert_not_called()

    def test_cli_lists_projects_without_starting_a_server_or_native_window(self):
        with patch.object(sys, 'argv', ['launch.py','--list-projects']), \
                patch('launch.ensure_server') as ensure_server, \
                contextlib.redirect_stdout(io.StringIO()) as stdout:
            launch.main()
        self.assertEqual(len(json.loads(stdout.getvalue())['projects']), 2)
        ensure_server.assert_not_called()

    def test_cli_unknown_project_fails_before_server_start(self):
        with patch.object(sys, 'argv', ['launch.py','--project','missing']), \
                patch('launch.ensure_server') as ensure_server, \
                contextlib.redirect_stderr(io.StringIO()), self.assertRaises(SystemExit):
            launch.main()
        ensure_server.assert_not_called()


if __name__ == '__main__':
    unittest.main()
