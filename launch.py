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
    server = ThreadingHTTPServer(('127.0.0.1', 8080), partial(SimpleHTTPRequestHandler, directory=str(ROOT)))
    threading.Thread(target=server.serve_forever, daemon=True).start()
    return url, server

class DesktopApi:
    def __init__(self):
        self._live = None
        self._bridge = None
        self._room = None
        self._lock = threading.RLock()

    def open_live_room(self, raw):
        with self._lock:
            room = room_id(raw)
            if self._live and self._live.poll() is None:
                if room == self._room:
                    return '直播窗口已经打开，请切换到该窗口登录。'
                return '请先关闭已有直播窗口，再打开新的房间。'
            if listening(9224):
                raise RuntimeError('直播窗口端口 9224 已被占用，请关闭旧应用后重试')
            self.stop_capture()
            self._room = room
            (ROOT / '.bridge-room').write_text(room, encoding='utf-8')
            env = os.environ.copy()
            env['WEBVIEW2_ADDITIONAL_BROWSER_ARGUMENTS'] = '--remote-debugging-port=9224 --remote-debugging-address=127.0.0.1'
            self._live = subprocess.Popen([sys.executable, str(ROOT / 'launch.py'), '--live-room', room], cwd=ROOT, env=env)
            return '已打开独立直播窗口，请登录后点击“开始抓取”。'

    def start_capture(self, raw):
        with self._lock:
            room = room_id(raw)
            if not self._live or self._live.poll() is not None or room != self._room:
                raise RuntimeError('请先打开这个房间的独立直播窗口并登录')
            if self._bridge and self._bridge.poll() is None:
                return '数据桥已经运行。'
            if listening(8765):
                raise RuntimeError('旧数据桥仍占用 8765 端口，请关闭旧版启动程序')
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
            return '抓取已停止，可以继续在直播窗口观看。'

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
