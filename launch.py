"""Standalone WebView2 printer and isolated live-room login window."""
import argparse
import json
import os
import re
import shutil
import socket
import subprocess
import sys
import threading
import urllib.request
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent

def room_id(raw):
    match = re.fullmatch(r'(?:https?://live\.douyin\.com/)?(\d{5,25})(?:[/?#].*)?', str(raw).strip())
    if not match:
        raise ValueError('请输入有效的直播间号或直播链接')
    return match[1]

def listening(port):
    with socket.socket() as sock:
        sock.settimeout(.3)
        return sock.connect_ex(('127.0.0.1', port)) == 0

def ensure_server():
    url = 'http://127.0.0.1:8080/'
    if listening(8080):
        with urllib.request.urlopen(url, timeout=3) as response:
            if 'AVATAR PRINT STUDIO' not in response.read(100000).decode('utf-8', errors='replace'):
                raise RuntimeError('8080 端口被其他程序占用')
        return url, None
    class Handler(SimpleHTTPRequestHandler):
        # 叠加一个本地控制端点：让浏览器页面也能拉起“独立应用窗口”（无浏览器界面）。
        def _guard(self):
            # 只允许本机页面调用（防其它网站借用本地服务拉进程）。
            if not self.headers.get('Host', '').startswith('127.0.0.1:8080'):
                return False
            return self.headers.get('Sec-Fetch-Site', '') == 'same-origin'

        def _spawn_app(self, url, size=(1280, 720), extra=None):
            exe = None
            for c in (r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
                      r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
                      r'C:\Program Files\Google\Chrome\Application\chrome.exe',
                      r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'):
                if os.path.exists(c):
                    exe = c
                    break
            if not exe:
                return False
            args = [exe, '--app=' + url, '--window-size=%d,%d' % size]
            if extra:
                args += extra
            subprocess.Popen(args)
            return True

        def do_GET(self):
            if self.path.startswith('/__open-live'):
                if not self._guard():
                    return self._json(403, '{"ok":false,"error":"forbidden"}')
                from urllib.parse import urlparse, parse_qs
                q = parse_qs(urlparse(self.path).query)
                room = ''.join(ch for ch in (q.get('room') or [''])[0] if ch.isdigit())[-25:]
                if not re.fullmatch(r'\d{5,25}', room):
                    return self._json(400, '{"ok":false,"error":"bad room"}')
                size = (720, 1280) if (q.get('portrait') or ['0'])[0] == '1' else (1280, 720)
                extra = None
                if (q.get('debug') or ['0'])[0] == '1':
                    extra = ['--remote-debugging-port=9223', '--user-data-dir=' + str(ROOT / '.bridge-profile'),
                             '--lang=zh-CN', '--no-first-run', '--no-default-browser-check',
                             '--disable-backgrounding-occluded-windows', '--disable-renderer-backgrounding',
                             '--disable-background-timer-throttling',
                             '--disable-features=IntensiveWakeUpThrottling,CalculateNativeWinOcclusion']
                if not self._spawn_app('https://live.douyin.com/' + room, size, extra):
                    return self._json(500, '{"ok":false,"error":"no browser found"}')
                return self._json(200, '{"ok":true}')
            if self.path.startswith('/__start-bridge'):
                if not self._guard():
                    return self._json(403, '{"ok":false,"error":"forbidden"}')
                from urllib.parse import urlparse, parse_qs
                q = parse_qs(urlparse(self.path).query)
                room = ''.join(ch for ch in (q.get('room') or [''])[0] if ch.isdigit())[-25:]
                if not re.fullmatch(r'\d{5,25}', room):
                    return self._json(400, '{"ok":false,"error":"bad room"}')
                if listening(8765):
                    return self._json(200, '{"ok":true,"already":true}')
                node = shutil.which('node')
                if not node:
                    return self._json(500, '{"ok":false,"error":"node not found"}')
                log = open(ROOT / 'desktop-bridge.log', 'ab')
                subprocess.Popen([node, str(ROOT / 'douyin-bridge.mjs'), room], cwd=str(ROOT),
                                 stdout=log, stderr=log,
                                 creationflags=subprocess.CREATE_NO_WINDOW)
                return self._json(200, '{"ok":true}')
            if self.path.startswith('/__stop-bridge'):
                if not self._guard():
                    return self._json(403, '{"ok":false,"error":"forbidden"}')
                try:
                    subprocess.run(['powershell', '-NoProfile', '-Command',
                                    "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'douyin-bridge.mjs' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"],
                                    timeout=15, creationflags=subprocess.CREATE_NO_WINDOW)
                except Exception:
                    pass
                return self._json(200, '{"ok":true}')
            if self.path.startswith('/__open-scene'):
                if not self._guard():
                    return self._json(403, '{"ok":false,"error":"forbidden"}')
                from urllib.parse import urlparse, parse_qs
                q = parse_qs(urlparse(self.path).query)
                spath = (q.get('path') or [''])[0]
                orient = (q.get('orient') or ['landscape'])[0]
                sizes = {'landscape': (1280, 720), 'landscape-1080p': (1920, 1080),
                         'portrait': (720, 1280), 'portrait-1080p': (1080, 1920)}
                w, h = sizes.get(orient, (1280, 720))
                size = f'{w},{h}'
                if not re.fullmatch(r'/[A-Za-z0-9_\-]+\.html\?scene=1', spath):
                    return self._json(400, '{"ok":false,"error":"bad path"}')
                exe = None
                for c in (r'C:\Program Files (x86)\Microsoft\Edge\Application\msedge.exe',
                          r'C:\Program Files\Microsoft\Edge\Application\msedge.exe',
                          r'C:\Program Files\Google\Chrome\Application\chrome.exe',
                          r'C:\Program Files (x86)\Google\Chrome\Application\chrome.exe'):
                    if os.path.exists(c):
                        exe = c
                        break
                if not exe:
                    return self._json(500, '{"ok":false,"error":"no browser found"}')
                subprocess.Popen([exe, '--app=http://127.0.0.1:8080' + spath, '--window-size=' + size])
                return self._json(200, '{"ok":true}')
            return super().do_GET()

        def _json(self, code, body):
            data = body.encode('utf-8')
            self.send_response(code)
            self.send_header('Content-Type', 'application/json')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)

        def log_message(self, *args):
            pass

    server = ThreadingHTTPServer(('127.0.0.1', 8080), Handler)
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return url, server

class DesktopApi:
    def __init__(self):
        self._live = None
        self._bridge = None
        self._room = None
        self._scene_windows = []
        self._lock = threading.RLock()

    def open_scene_window(self, path=None, orient='landscape'):
        # 独立场景窗口：纯 3D 打印画面，适合 OBS 窗口采集/第二屏幕。接受语言页路径与画面方向。
        import webview, re as _re
        path = str(path or '')
        if not _re.fullmatch(r'/[A-Za-z0-9_\-]+\.html\?scene=1', path):
            path = '/index.html?scene=1'
        url = 'http://127.0.0.1:8080' + path
        sizes = {'landscape': (1280, 720), 'landscape-1080p': (1920, 1080),
                 'portrait': (720, 1280), 'portrait-1080p': (1080, 1920)}
        size = sizes.get(orient, (1280, 720))

        def spawn():
            try:
                win = webview.create_window('Scene Window · Avatar Printer',
                                            url,
                                            width=size[0], height=size[1], background_color='#0b0e14',
                                            js_api=self, resizable=True)
                self._scene_windows.append(win)
            except Exception as exc:
                print('scene window error:', exc, flush=True)

        threading.Thread(target=spawn, daemon=True).start()
        return '独立场景窗口已打开 / Scene window opened：打印由它接管，本窗口只计数。'

    def resize_scene(self, w, h):
        # 场景小窗内切换横竖屏：调整所有由本应用打开的场景窗口尺寸。
        try:
            w, h = max(200, min(int(w), 4096)), max(200, min(int(h), 4096))
        except Exception:
            return 'bad size'
        for win in list(self._scene_windows):
            try:
                if not getattr(win, 'closed', False):
                    win.resize(w, h)
            except Exception:
                pass
        return 'ok'

    def open_live_room(self, raw):
        with self._lock:
            room = room_id(raw)
            if self._live and self._live.poll() is None:
                if room == self._room:
                    return '直播窗口已打开，请切换登录 / Live window already open — switch to it and log in.'
                # 直接换房间：关掉旧窗口开新窗口；运行中的数据桥会自动跟随 .bridge-room 切换。
                try:
                    self._live.terminate()
                    self._live.wait(timeout=5)
                except Exception:
                    pass
                self._live = None
            if listening(9224):
                raise RuntimeError('端口 9224 被占用，请关闭旧直播窗口 / Port 9224 busy — close the old live window')
            self._room = room
            (ROOT / '.bridge-room').write_text(room, encoding='utf-8')
            env = os.environ.copy()
            env['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = '--remote-debugging-port=9224 --remote-debugging-address=127.0.0.1'
            self._live = subprocess.Popen([sys.executable, str(ROOT / 'launch.py'), '--live-room', room], cwd=ROOT, env=env)
            return '直播窗口已打开，登录后点“开始抓取” / Live window opened — log in, then click Start Capture.'

    def start_capture(self, raw):
        with self._lock:
            room = room_id(raw)
            if not self._live or self._live.poll() is not None or room != self._room:
                raise RuntimeError("请先打开该房间的直播窗口并登录 / Open this room's live window and log in first")
            if self._bridge and self._bridge.poll() is None:
                return '数据桥已在运行 / Bridge already running.'
            if listening(8765):
                return '数据桥已在运行，自动跟随换房 / Bridge running — follows room switches automatically.'
            with urllib.request.urlopen('http://127.0.0.1:9224/json/list', timeout=3) as response:
                pages = json.load(response)
            if not any(re.match(r'https://live\.douyin\.com/' + room + r'(?:[/?#]|$)', p.get('url', '')) for p in pages):
                raise RuntimeError('直播窗口尚未进入该直播间，请先完成登录或验证')
            node = shutil.which('node')
            if not node:
                raise RuntimeError('未找到 Node.js')
            env = os.environ.copy()
            env['PRINTER_CDP_PORT'] = '9224'
            with open(ROOT / 'desktop-bridge.log', 'ab') as log:
                self._bridge = subprocess.Popen([node, str(ROOT / 'douyin-bridge.mjs'), room], cwd=ROOT,
                    env=env, stdout=log, stderr=log, creationflags=subprocess.CREATE_NO_WINDOW)
            return '数据桥已启动，正在连接直播评论。'

    def stop_capture(self, raw=None):
        with self._lock:
            if self._bridge and self._bridge.poll() is None:
                self._bridge.terminate()
                self._bridge.wait(timeout=5)
            self._bridge = None
            # 也停掉手动 node douyin-bridge.mjs 启动的外部数据桥。
            try:
                subprocess.run(['powershell', '-NoProfile', '-Command',
                                "Get-CimInstance Win32_Process | Where-Object { $_.Name -eq 'node.exe' -and $_.CommandLine -match 'douyin-bridge.mjs' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }"],
                                timeout=15, creationflags=subprocess.CREATE_NO_WINDOW)
            except Exception:
                pass
            return '抓取已停止 / Capture stopped.'

    def close(self):
        self.stop_capture()
        if self._live and self._live.poll() is None:
            self._live.terminate()
            self._live.wait(timeout=5)

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--live-room')
    parser.add_argument('--server-only', action='store_true')
    parser.add_argument('--room')
    parser.add_argument('--capture', action='store_true')
    args = parser.parse_args()
    if args.live_room:
        import webview
        webview.settings['REMOTE_DEBUGGING_PORT'] = 9224
        room = room_id(args.live_room)
        webview.create_window('直播间登录 · ' + room, 'https://live.douyin.com/' + room, width=1180, height=800)
        webview.start(gui='edgechromium', private_mode=False, storage_path=str(ROOT / '.live-webview-profile'))
        return
    url, server = ensure_server()
    api = DesktopApi()
    try:
        if args.server_only:
            threading.Event().wait()
        else:
            import webview
            webview.create_window('头像打印机 · 桌面版', url, js_api=api, width=1380, height=860,
                min_size=(900, 650), background_color='#0b0e14')
            def start_requested_room():
                if not args.room:
                    return
                try:
                    print(api.open_live_room(args.room), flush=True)
                    if args.capture:
                        for _ in range(30):
                            if listening(9224):
                                try:
                                    print(api.start_capture(args.room), flush=True)
                                    return
                                except (OSError, RuntimeError):
                                    pass
                            threading.Event().wait(1)
                        print('直播窗口未就绪，请完成登录后点击开始抓取', flush=True)
                except Exception as exc:
                    print(str(exc), flush=True)
            webview.start(start_requested_room, gui='edgechromium', private_mode=False, storage_path=str(ROOT / '.printer-webview-profile'))
    except KeyboardInterrupt:
        pass
    finally:
        api.close()
        if server:
            server.shutdown()
            server.server_close()

if __name__ == '__main__':
    main()
