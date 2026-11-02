// The bridge transports events. Projects decide which events trigger their own
// actions, queues, visual changes or voice responses.
export class LiveClient {
  constructor({fetchImpl = globalThis.fetch.bind(globalThis), WebSocketImpl = globalThis.WebSocket,
    retryDelay = 3000, healthTimeout = 4000, healthUrl = '/__bridge-status',
    onopen, onmessage, onclose, onerror, onstatus, onUnavailable, autoStart,
    setTimeoutImpl = globalThis.setTimeout.bind(globalThis), clearTimeoutImpl = globalThis.clearTimeout.bind(globalThis)} = {}) {
    this.fetch = fetchImpl;
    this.WebSocket = WebSocketImpl;
    this.retryDelay = retryDelay;
    this.healthTimeout = healthTimeout;
    this.healthUrl = healthUrl;
    this.onopen = onopen;
    this.onmessage = onmessage;
    this.onclose = onclose;
    this.onerror = onerror;
    this.onstatus = onstatus;
    this.onUnavailable = onUnavailable || autoStart;
    this.setTimeout = setTimeoutImpl;
    this.clearTimeout = clearTimeoutImpl;
    this.socket = null;
    this.timer = null;
    this.connecting = false;
    this.stopped = true;
    this.closed = false;
    this.generation = 0;
    this.abort = null;
  }

  _status(status, detail) { this.onstatus?.(status, detail); }

  _schedule() {
    this.clearTimeout(this.timer);
    this.timer = null;
    if (this.stopped || this.closed) return;
    this.timer = this.setTimeout(() => { this.timer = null; this.connect(); }, this.retryDelay);
  }

  async connect(address) {
    if (this.closed || this.connecting || (this.socket && this.socket.readyState <= 1)) return this.socket;
    this.stopped = false;
    this.connecting = true;
    this.clearTimeout(this.timer);
    this.timer = null;
    const generation = ++this.generation;
    this._status('connecting');
    let timeout = null;
    try {
      if (!address) {
        const controller = this.abort = new AbortController();
        timeout = this.setTimeout(() => controller.abort(), this.healthTimeout);
        const response = await this.fetch(this.healthUrl, {signal:controller.signal, cache:'no-store'});
        if (!response.ok) throw new Error('Bridge discovery failed (' + response.status + ')');
        const health = await response.json();
        if (!health.ok || typeof health.url !== 'string' || !/^wss?:\/\//.test(health.url)) throw new Error('Bridge offline');
        address = health.url;
      }
      if (this.stopped || this.closed || generation !== this.generation) return null;
      const socket = this.socket = new this.WebSocket(address);
      socket.onopen = event => {
        if (generation !== this.generation || this.stopped) return;
        this._status('connected', socket);
        this.onopen?.(event, this);
      };
      socket.onmessage = event => {
        if (generation !== this.generation || this.stopped) return;
        try { this.onmessage?.(JSON.parse(event.data), event); }
        catch (error) { this.onerror?.(error); }
      };
      socket.onerror = error => { if (generation === this.generation && !this.stopped) this.onerror?.(error); };
      socket.onclose = event => {
        if (generation !== this.generation) return;
        this.socket = null;
        this._status('disconnected', event);
        this.onclose?.(event);
        this._schedule();
      };
      return socket;
    } catch (error) {
      if (generation !== this.generation || this.stopped || this.closed) return null;
      this._status('unavailable', error);
      this.onerror?.(error);
      try { await this.onUnavailable?.(error); } catch (hookError) { this.onerror?.(hookError); }
      this._schedule();
      return null;
    } finally {
      this.clearTimeout(timeout);
      if (generation === this.generation) { this.connecting = false; this.abort = null; }
    }
  }

  send(message) {
    if (this.socket?.readyState !== 1) return false;
    this.socket.send(typeof message === 'string' ? message : JSON.stringify(message));
    return true;
  }

  disconnect() {
    this.stopped = true;
    this.generation++;
    this.connecting = false;
    this.clearTimeout(this.timer);
    this.timer = null;
    this.abort?.abort();
    this.abort = null;
    const socket = this.socket;
    this.socket = null;
    if (socket) {
      socket.onopen = socket.onmessage = socket.onclose = socket.onerror = null;
      socket.close();
    }
    this._status('stopped');
  }

  close() { this.disconnect(); this.closed = true; }
}
