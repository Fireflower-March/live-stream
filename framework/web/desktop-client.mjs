import {projectViewerUrl, resolveProjectId} from './project-context.mjs';

export function normalizeRoom(value) {
  const match=String(value||'').trim().match(/^(?:https?:\/\/live\.douyin\.com\/)?(\d{5,25})(?:[/?#].*)?$/);
  if (!match) throw new Error('请输入有效的直播间号或 live.douyin.com 直播链接');
  return match[1];
}

// The host manages windows and live capture; projects own their presentation.
export class DesktopClient {
  constructor(projectId = resolveProjectId()) { this.projectId = projectId; }

  async request(method, args, endpoint, query = {}) {
    const api = globalThis.window?.pywebview?.api;
    if (api?.[method]) return api[method](...args);
    const response = await fetch(endpoint + '?' + new URLSearchParams(query));
    const result = await response.json();
    if (!response.ok || !result.ok) throw new Error(result.error || '操作失败');
    return result.message || '操作已完成';
  }

  openOutput(orient = 'landscape') {
    const path = projectViewerUrl(this.projectId);
    return this.request('open_scene_window', [path, orient], '/__open-scene', {path, orient});
  }

  openLiveRoom(raw) { const room=normalizeRoom(raw); return this.request('open_live_room', [room], '/__open-live', {room, debug:'1'}); }
  startCapture(raw) { const room=normalizeRoom(raw); return this.request('start_capture', [room], '/__start-bridge', {room}); }
  stopCapture() { return this.request('stop_capture', [], '/__stop-bridge'); }

  async projectUrl(id = null) {
    const api = globalThis.window?.pywebview?.api;
    if (api?.open_project) return api.open_project(id);
    if (!id) return '/';
    const response = await fetch('/__projects', {cache:'no-store'});
    const data = await response.json();
    const project = data.projects?.find(project => project.id === id);
    if (!project) throw new Error('项目不存在');
    return project.entry;
  }
}
