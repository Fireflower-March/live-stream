// One active controller per project/browser profile. SceneChannel supplies the
// project boundary; this module owns election and leaves the channel lifecycle
// to its caller. Higher priority wins, then older sessions, then lexical id.
export class ProjectSession {
  constructor({channel, priority = 0, onChange, now = Date.now,
    cryptoImpl = globalThis.crypto, setIntervalImpl = globalThis.setInterval.bind(globalThis),
    clearIntervalImpl = globalThis.clearInterval.bind(globalThis), heartbeatMs = 2000,
    peerTimeoutMs = 6000} = {}) {
    if (!channel || typeof channel.postMessage !== 'function') {
      throw new TypeError('ProjectSession requires a channel');
    }
    if (!Number.isFinite(priority)) throw new TypeError('ProjectSession priority must be finite');
    Object.assign(this, {channel, priority, onChange, now, peerTimeoutMs,
      clearInterval:clearIntervalImpl});
    this.born = now();
    this.sid = cryptoImpl?.randomUUID?.() || this.born.toString(36) + '-' + Math.random().toString(36).slice(2);
    this.peers = new Map();
    this.closed = false;
    this.leader = true;
    this.timer = setIntervalImpl(() => { this._refresh(); this._announce(); }, heartbeatMs);
    this._announce();
  }

  _announce() {
    if (!this.closed) this.channel.postMessage({type:'who', sid:this.sid,
      born:this.born, priority:this.priority, scene:this.priority > 0});
  }

  _refresh(changed = false) {
    if (this.closed) return false;
    const timestamp = this.now();
    let leader = true;
    for (const [sid, peer] of this.peers) {
      if (timestamp - peer.t > this.peerTimeoutMs) {
        this.peers.delete(sid);
        changed = true;
        continue;
      }
      if (peer.priority > this.priority || (peer.priority === this.priority &&
        (peer.born < this.born || (peer.born === this.born && sid < this.sid)))) leader = false;
    }
    const leadershipChanged = leader !== this.leader;
    this.leader = leader;
    if (changed || leadershipChanged) this.onChange?.(leader, this);
    return leader;
  }

  isLeader() { return this._refresh(); }

  handleMessage(message) {
    if (this.closed || message?.type !== 'who') return false;
    if (typeof message.sid !== 'string' || !message.sid || message.sid.length > 128 ||
      !Number.isFinite(message.born) || message.sid === this.sid) return true;
    const priority = message.priority === undefined ? (message.scene ? 1 : 0) : message.priority;
    if (!Number.isFinite(priority)) return true;
    const previous = this.peers.get(message.sid);
    const changed = !previous || previous.born !== message.born || previous.priority !== priority;
    this.peers.set(message.sid, {t:this.now(), born:message.born, priority, scene:priority > 0});
    this._refresh(changed);
    // The first announcement can precede the new page's listener. Reply once
    // to a previously unknown peer so both sides converge without a 2s wait.
    if (!previous) this._announce();
    return true;
  }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.clearInterval(this.timer);
    this.peers.clear();
    const wasLeader = this.leader;
    this.leader = false;
    if (wasLeader) this.onChange?.(false, this);
  }
}
