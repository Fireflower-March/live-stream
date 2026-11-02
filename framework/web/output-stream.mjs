// Project-agnostic canvas/video mirroring. A project supplies a MediaStream and
// optional camera callbacks; this module owns only the WebRTC connection.
export class OutputStream {
  constructor({channel, getStream, getFrameRate = () => 60, isActive = () => true,
    onConnectionChange, onDetached, onStats, onCameraRequest, onCameraChange, onerror,
    PeerConnectionImpl = globalThis.RTCPeerConnection, RtpSenderImpl = globalThis.RTCRtpSender,
    heartbeatTimeout = 12000, now = Date.now, setIntervalImpl = globalThis.setInterval.bind(globalThis),
    clearIntervalImpl = globalThis.clearInterval.bind(globalThis)} = {}) {
    if (!channel || typeof getStream !== 'function') throw new TypeError('OutputStream requires channel and getStream');
    Object.assign(this, {channel, getStream, getFrameRate, isActive, onConnectionChange, onDetached,
      onStats, onCameraRequest, onCameraChange, onerror, PeerConnectionImpl, RtpSenderImpl,
      heartbeatTimeout, now, clearInterval:clearIntervalImpl});
    this.pc = null;
    this.stream = null;
    this.sourcePromise = null;
    this.pendingIce = [];
    this.lastSeen = 0;
    this.connected = false;
    this.closed = false;
    this.generation = 0;
    this.watchdog = setIntervalImpl(() => {
      if (this.connected && this.now() - this.lastSeen > this.heartbeatTimeout) this._teardown();
    }, 3000);
  }

  _connection(connected) {
    if (this.connected === connected) return;
    this.connected = connected;
    this.onConnectionChange?.(connected);
  }

  get connectionState() { return this.pc?.connectionState || 'closed'; }
  get active() { return !!this.pc; }

  _teardown() {
    this.generation++;
    const pc = this.pc;
    this.pc = null;
    if (pc) { pc.onicecandidate = null; pc.close(); }
    this.stream?.getTracks().forEach(track => track.stop());
    this.stream = null;
    const pendingSource = this.sourcePromise;
    this.sourcePromise = null;
    // A canvas/video project may return its source asynchronously. Closing the
    // output before it resolves must still release the resulting tracks.
    pendingSource?.then(stream => { if (stream !== this.stream) stream.getTracks().forEach(track => track.stop()); }).catch(() => {});
    this.pendingIce = [];
    this._connection(false);
    this.onDetached?.(false);
  }

  async _offer() {
    const generation = ++this.generation;
    try {
      if (this.pc) { this.pc.onicecandidate = null; this.pc.close(); }
      this.pc = null;
      if (!this.stream) {
        if (!this.sourcePromise) this.sourcePromise = Promise.resolve().then(() => this.getStream());
        const sourcePromise = this.sourcePromise;
        const stream = await sourcePromise;
        if (this.closed || generation !== this.generation) return;
        this.stream = stream;
        if (this.sourcePromise === sourcePromise) this.sourcePromise = null;
      }
      if (this.closed || generation !== this.generation) return;
      this.stream.getVideoTracks().forEach(track => { track.contentHint = 'detail'; });
      const pc = this.pc = new this.PeerConnectionImpl();
      this.pendingIce = [];
      const input = pc.createDataChannel('controls', {ordered:false, maxRetransmits:0});
      input.onmessage = event => {
        try { const message = JSON.parse(event.data); if (message.type === 'view-camera-change') this.onCameraChange?.(message); }
        catch (error) { this.onerror?.(error); }
      };
      this.stream.getVideoTracks().forEach(track => pc.addTrack(track, this.stream));
      pc.onicecandidate = event => {
        if (generation !== this.generation || !event.candidate) return;
        const {candidate, sdpMid, sdpMLineIndex} = event.candidate;
        this.channel.postMessage({type:'view-ice', candidate:{candidate, sdpMid, sdpMLineIndex}});
      };
      await this.setFrameRate(this.getFrameRate());
      const codecs = this.RtpSenderImpl?.getCapabilities?.('video')?.codecs || [];
      const preferred = codecs.filter(codec => codec.mimeType.toLowerCase() === 'video/h264');
      if (preferred.length) for (const transceiver of pc.getTransceivers()) {
        transceiver.setCodecPreferences([...preferred, ...codecs.filter(codec => !preferred.includes(codec))]);
      }
      const offer = await pc.createOffer();
      if (this.closed || generation !== this.generation) return;
      await pc.setLocalDescription(offer);
      if (this.closed || generation !== this.generation) return;
      this.lastSeen = this.now();
      this._connection(true);
      this.channel.postMessage({type:'view-offer', sdp:{type:offer.type, sdp:offer.sdp}});
      // Static and canvas.captureStream(0) sources also need an initial frame.
      this.requestFrame();
    } catch (error) {
      if (generation !== this.generation) return;
      this.onerror?.(error);
      this._teardown();
    }
  }

  handleMessage(message) {
    if (this.closed || !message?.type?.startsWith('view-')) return false;
    switch (message.type) {
      case 'view-request':
        if (this.isActive()) { this.lastSeen = this.now(); this._offer(); }
        return true;
      case 'view-answer':
        if (this.pc && message.sdp) {
          const pc = this.pc;
          this.lastSeen = this.now();
          pc.setRemoteDescription(message.sdp).then(async () => {
            if (this.pc !== pc) return;
            for (const candidate of this.pendingIce.splice(0)) await pc.addIceCandidate(candidate);
          }).catch(error => this.onerror?.(error));
        }
        return true;
      case 'view-ice':
        if (this.pc && message.candidate) {
          this.lastSeen = this.now();
          if (this.pc.remoteDescription) this.pc.addIceCandidate(message.candidate).catch(error => this.onerror?.(error));
          else this.pendingIce.push(message.candidate);
        }
        return true;
      case 'view-ping':
      case 'view-ready':
        if (!this.pc) return true;
        this.lastSeen = this.now();
        this._connection(true);
        this.onDetached?.(true);
        return true;
      case 'view-stats': if (this.pc) this.onStats?.(message); return true;
      case 'view-camera-request': if (this.pc) this.onCameraRequest?.(); return true;
      case 'view-camera-change': if (this.pc) this.onCameraChange?.(message); return true;
      case 'view-bye': this._teardown(); return true;
      default: return false;
    }
  }

  async setFrameRate(fps) {
    if (!this.pc) return;
    for (const sender of this.pc.getSenders()) {
      const params = sender.getParameters();
      if (!params.encodings?.length) params.encodings = [{}];
      params.encodings[0].scaleResolutionDownBy = 1;
      params.encodings[0].maxBitrate = 40000000;
      params.encodings[0].maxFramerate = fps;
      params.degradationPreference = 'maintain-resolution';
      // Chromium can reject initial parameters until SDP negotiation finishes.
      // The source still requests frames at the project's target frequency.
      try { await sender.setParameters(params); } catch (error) { this.onerror?.(error); }
    }
  }

  requestFrame() { if (this.pc) this.stream?.getVideoTracks()[0]?.requestFrame?.(); }

  close() {
    if (this.closed) return;
    this.closed = true;
    this.clearInterval(this.watchdog);
    this._teardown();
  }
}
