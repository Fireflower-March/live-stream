"""Discover independent projects and expose only validated local page URLs."""
import json
import re
from pathlib import Path
from urllib.parse import quote, parse_qs, urlsplit


DEFAULT_PROJECT = 'avatar-printer'
PROJECT_ID = re.compile(r'[a-z0-9][a-z0-9_-]{0,63}')
VIEWER_PATH = '/framework/web/live-view.html'


def _root(root):
    return Path(root) if root is not None else Path(__file__).resolve().parents[1]


def _page_url(folder, relative):
    if not isinstance(relative, str) or not relative or '\\' in relative:
        raise ValueError('入口必须是项目目录内的 HTML 文件')
    parsed = urlsplit(relative)
    if parsed.scheme or parsed.netloc or parsed.query or parsed.fragment or relative.startswith('/'):
        raise ValueError('入口必须是项目目录内的 HTML 文件')
    path = (folder / relative).resolve()
    try:
        local = path.relative_to(folder.resolve())
    except ValueError:
        raise ValueError('入口不能超出项目目录') from None
    if '..' in Path(relative).parts or path.suffix.lower() != '.html' or not path.is_file():
        raise ValueError('入口 HTML 文件不存在或路径无效')
    return '/projects/' + quote(folder.name, safe='') + '/' + quote(local.as_posix(), safe='/')


def _read_project(folder):
    data = json.loads((folder / 'project.json').read_text(encoding='utf-8-sig'))
    if not isinstance(data, dict) or not PROJECT_ID.fullmatch(folder.name) or data.get('id') != folder.name:
        raise ValueError('项目 id 必须与目录名一致，且仅使用小写字母、数字、短横线或下划线')
    name = data.get('name')
    if not isinstance(name, str) or not name.strip() or len(name) > 100:
        raise ValueError('项目必须包含有效名称')
    description = data.get('description', '')
    if not isinstance(description, str) or len(description) > 1000:
        raise ValueError('项目说明必须是 1000 字符以内的文本')
    entry = _page_url(folder, data.get('entry', 'index.html'))
    entries = data.get('entries', {})
    if not isinstance(entries, dict):
        raise ValueError('entries 必须是页面名称与 HTML 路径的映射')
    pages = {}
    for key, value in entries.items():
        if not isinstance(key, str) or not re.fullmatch(r'[A-Za-z][A-Za-z0-9_-]{0,19}', key):
            raise ValueError('entries 页面名称无效')
        pages[key] = _page_url(folder, value)
    title = data.get('viewerTitle', name)
    if not isinstance(title, str) or not title.strip() or len(title) > 120:
        raise ValueError('直播小窗标题无效')
    output = data.get('output', {'mode': 'mirror', 'camera': False})
    if not isinstance(output, dict) or output.get('mode', 'mirror') != 'mirror' or not isinstance(output.get('camera', False), bool):
        raise ValueError('output 仅支持 mirror 模式和布尔值 camera')
    return {'id': folder.name, 'name': name.strip(), 'description': description,
            'entry': entry, 'entries': pages, 'viewerTitle': title.strip(),
            'output': {'mode': 'mirror', 'camera': output.get('camera', False)}}


def discover_projects(root=None):
    projects, errors = [], []
    directory = _root(root) / 'projects'
    if not directory.is_dir():
        return {'projects': projects, 'errors': errors}
    for folder in sorted(directory.iterdir(), key=lambda item: item.name):
        if not folder.is_dir() or not (folder / 'project.json').is_file():
            continue
        try:
            # A project cannot redirect discovery outside the integrations folder.
            if not folder.resolve().is_relative_to(directory.resolve()):
                raise ValueError('项目目录不能超出 projects 文件夹')
            projects.append(_read_project(folder))
        except (OSError, ValueError, TypeError) as exc:
            message = str(exc) if isinstance(exc, (ValueError, TypeError)) else '无法读取项目配置'
            errors.append({'project': folder.name, 'error': message})
    return {'projects': projects, 'errors': errors}


def get_project(project_id, root=None):
    if not isinstance(project_id, str) or not PROJECT_ID.fullmatch(project_id):
        raise ValueError('无效的项目 id')
    for project in discover_projects(root)['projects']:
        if project['id'] == project_id:
            return project
    raise ValueError('未找到可用项目：' + project_id)


def scene_view_url(project_id, root=None):
    project = get_project(project_id, root)
    return VIEWER_PATH + '?project=' + quote(project['id'], safe='')


def project_from_scene_path(path, default_project=DEFAULT_PROJECT, root=None):
    if path is None:
        return get_project(default_project, root)
    if not isinstance(path, str):
        raise ValueError('无效的直播小窗地址')
    parsed = urlsplit(path)
    if parsed.scheme or parsed.netloc or parsed.fragment or parsed.path not in {VIEWER_PATH, '/live-view.html'}:
        raise ValueError('直播小窗必须使用公共输出页面')
    query = parse_qs(parsed.query)
    project_ids = query.get('project', [default_project])
    if len(project_ids) != 1:
        raise ValueError('无效的直播小窗项目')
    return get_project(project_ids[0], root)
