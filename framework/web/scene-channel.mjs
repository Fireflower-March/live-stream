import {resolveProjectId, validateProjectId} from './project-context.mjs';

// Peer election is local to a browser profile. Video/control signalling uses the
// local HTTP relay so isolated WebView2 processes can share the same project.
export class SceneChannel {
  constructor({projectId = resolveProjectId(), fetchImpl = globalThis.fetch.bind(globalThis),
    BroadcastChannelImpl = globalThis.BroadcastChannel, cryptoImpl = globalThis.crypto,
    retryDelay = 1000, autoPoll = true} = {}) {
    this.projectId = validateProjectId(projectId);
    this.fetch = fetchImpl;
    this.id = cryptoImpl.randomUUID();
    this.onmessage = null;
    this.onerror = null;
    this.closed = false;
    this.pending = [];
    this.cursor = null;
    this.available = false;
    this.retryDelay = retryDelay;
    this.abort = new AbortController();
    this.native = BroadcastChannelImpl ? new BroadcastChannelImpl('live-scene:' + this.projectId) : null;
    if (this.native) this.native.onmessage = event => this.onmessage?.(event);
    if (autoPoll) this.polling = this.poll();
  }

  _queue(message) {
    this.pending.push(message);
    if (this.pending.length > 64) this.pending.shift();
  }

  async _retry() {
    if (this.closed) return;
    await new Promise(resolve => {
      const done = () => { clearTimeout(timer); this.abort.signal.removeEventListener('abort', done); resolve(); };
      const timer = setTimeout(done, this.retryDelay);
      this.abort.signal.addEventListener('abort', done, {once:true});
    });
  }

  async poll() {
    while (!this.closed) {
      try {
        const query = new URLSearchParams({client:this.id, project:this.projectId});
        if (this.cursor !== null) query.set('after', String(this.cursor));
        const response = await this.fetch('/__scene-events?' + query, {cache:'no-store', signal:this.abort.signal});
        if (!response.ok) throw new Error('Signalling unavailable (' + response.status + ')');
        const data = await response.json();
        if (this.closed) break;
        this.cursor = data.cursor;
        this.available = true;
        for (const message of data.messages || []) this.onmessage?.({data:message});
        const pending = this.pending.splice(0);
        for (const message of pending) await this.postMessage(message);
      } catch (error) {
        this.available = false;
        if (this.closed) break;
        this.onerror?.(error);
        await this._retry();
      }
    }
  }

  async postMessage(message) {
    if (this.closed) return false;
    if (!message?.type?.startsWith('view-')) {
      this.native?.postMessage(message);
      return true;
    }
    if (!this.available) { this._queue(message); return false; }
    try {
      const response = await this.fetch('/__scene-message', {
        method:'POST', headers:{'Content-Type':'application/json'},
        body:JSON.stringify({client:this.id, project:this.projectId, message}),
        keepalive:message.type === 'view-bye',
      });
      if (!response.ok) throw new Error('Signalling publish failed (' + response.status + ')');
      return true;
    } catch (error) {
      if (!this.closed) { this.available = false; this._queue(message); this.onerror?.(error); }
      return false;
    }
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.available = false;
    this.pending.length = 0;
    this.abort.abort();
    this.native?.close();
  }
}
