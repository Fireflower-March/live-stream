export const DEFAULT_PROJECT_ID = 'avatar-printer';
const PROJECT_ID = /^[a-z0-9][a-z0-9_-]{0,63}$/;

export function validateProjectId(value) {
  if (typeof value !== 'string' || !PROJECT_ID.test(value)) throw new TypeError('Invalid project id');
  return value;
}

export function resolveProjectId({projectId, document = globalThis.document, location = globalThis.location, fallback = DEFAULT_PROJECT_ID} = {}) {
  const meta = document?.querySelector?.('meta[name="live-project-id"]')?.content;
  const query = location?.search ? new URLSearchParams(location.search).get('project') : null;
  return validateProjectId(projectId ?? meta ?? query ?? fallback);
}

export function projectViewerUrl(projectId = resolveProjectId()) {
  return '/framework/web/live-view.html?project=' + encodeURIComponent(validateProjectId(projectId));
}

// Project preferences share an origin, but never a key space. Legacy migration
// is opt-in so newly added projects cannot inherit the printer's preferences.
export function createProjectStorage(projectId, storage = globalThis.localStorage, {legacyKeys = []} = {}) {
  const prefix = 'live-project:' + validateProjectId(projectId) + ':';
  const legacy = new Set(legacyKeys);
  return {
    getItem(key) {
      key = String(key);
      const value = storage.getItem(prefix + key);
      if (value !== null || !legacy.has(key)) return value;
      const previous = storage.getItem(key);
      if (previous !== null) storage.setItem(prefix + key, previous);
      return previous;
    },
    setItem(key, value) { storage.setItem(prefix + String(key), String(value)); },
    removeItem(key) { storage.removeItem(prefix + String(key)); },
    getJSON(key, fallback = null) {
      try { const value = this.getItem(key); return value === null ? fallback : JSON.parse(value); }
      catch { return fallback; }
    },
    setJSON(key, value) { this.setItem(key, JSON.stringify(value)); },
    prefix,
  };
}

export async function fetchProject(projectId = resolveProjectId(), fetchImpl = globalThis.fetch.bind(globalThis)) {
  validateProjectId(projectId);
  const response = await fetchImpl('/__projects', {cache:'no-store'});
  if (!response.ok) throw new Error('Project registry unavailable (' + response.status + ')');
  const data = await response.json();
  const projects = Array.isArray(data) ? data : data.projects;
  const project = projects?.find(item => item.id === projectId);
  if (!project) throw new Error('Unknown project: ' + projectId);
  return project;
}
