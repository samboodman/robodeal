export function fillPrompt(template, values) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (placeholder, key) => (
    Object.hasOwn(values, key) ? String(values[key]) : placeholder
  ));
}

export function microphoneAudioConstraints(supported = {}) {
  return {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
    ...(supported.voiceIsolation ? { voiceIsolation: true } : {}),
  };
}

function eventId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

export class VoiceAgent {
  constructor({
    onDelegation = async () => ({ speak: false, kind: 'ignored', utterance: '' }),
    onTranscript = () => {},
    onStatus = () => {},
    delegationDelayMs = 120,
  } = {}) {
    this.onDelegation = onDelegation;
    this.onTranscript = onTranscript;
    this.onStatus = onStatus;
    this.delegationDelayMs = delegationDelayMs;
    this.connection = null;
    this.channel = null;
    this.sender = null;
    this.audio = null;
    this.microphoneStream = null;
    this.audioTestContext = null;
    this.audioTestRunning = false;
    this.sessionStarted = false;
    this.sessionStartedResolve = null;
    this.inputTranscript = '';
    this.outputTranscript = '';
    this.conversation = [];
    this.pendingDelegations = [];
    this.delegationTimer = null;
    this.outputTranscriptTimer = null;
    this.pendingSpeechCount = 0;
    this.lastInputEndMs = null;
  }

  get connected() {
    return this.channel?.readyState === 'open' && this.sessionStarted;
  }

  get recording() {
    return Boolean(this.microphoneStream);
  }

  async connect(voice = 'marin', { accent = 'neutral', pace = 'natural', preview = false } = {}) {
    this.disconnect();
    this.onStatus('Connecting…');
    if (!window.RTCPeerConnection) throw new Error('This browser does not support WebRTC.');

    this.connection = new RTCPeerConnection();
    this.sender = this.connection.addTransceiver('audio', { direction: 'sendrecv' }).sender;
    this.connection.addEventListener('track', (event) => {
      if (!this.audio) {
        this.audio = document.createElement('audio');
        this.audio.autoplay = true;
        this.audio.playsInline = true;
        this.audio.hidden = true;
        this.audio.muted = this.pendingSpeechCount === 0;
        document.body.append(this.audio);
      }
      this.audio.srcObject = event.streams[0];
      this.audio.play().catch(() => {});
    });

    this.channel = this.connection.createDataChannel('oai-events');
    const channelOpened = new Promise((resolve, reject) => {
      this.channel.addEventListener('open', resolve, { once: true });
      this.channel.addEventListener('close', () => reject(new Error('The voice connection closed.')), { once: true });
    });
    const sessionStarted = new Promise((resolve) => { this.sessionStartedResolve = resolve; });
    this.channel.addEventListener('message', (event) => this.handleEvent(JSON.parse(event.data)));
    this.channel.addEventListener('close', () => {
      this.sessionStarted = false;
      this.onStatus('Voice connection ended.');
    });

    const offer = await this.connection.createOffer();
    await this.connection.setLocalDescription(offer);
    const response = await fetch('/api/live-session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sdp: offer.sdp, voice, accent, pace, preview }),
    });
    const text = await response.text();
    let answer;
    try {
      answer = JSON.parse(text);
    } catch {
      answer = null;
    }
    if (!response.ok) throw new Error(answer?.error || text || 'GPT-Live could not start.');
    if (!answer?.transport?.sdp) throw new Error('GPT-Live returned no WebRTC answer.');
    await this.connection.setRemoteDescription({ type: 'answer', sdp: answer.transport.sdp });
    await channelOpened;
    await sessionStarted;
    this.onStatus('AI connected.');
  }

  updateContext(context) {
    if (!this.connected || !context) return;
    this.send({
      type: 'session.thinking.append',
      event_id: eventId('state'),
      delegation_id: null,
      content: String(context).slice(0, 2_000),
    });
  }

  speak(text, delegationId = null) {
    if (!this.connected || !text) return;
    this.pendingSpeechCount += 1;
    if (this.audio) this.audio.muted = false;
    this.onStatus('Speaking…');
    this.send({
      type: 'session.commentary.append',
      event_id: eventId('dealer'),
      delegation_id: delegationId,
      content: text,
    });
  }

  returnDelegation(result, delegationId) {
    if (result?.speak && result.utterance) {
      this.speak(result.utterance, delegationId);
      return;
    }
    this.send({
      type: 'session.thinking.append',
      event_id: eventId('silent'),
      delegation_id: delegationId,
      content: 'The backend determined that no response or action is required. Continue listening silently.',
    });
    if (this.audio) this.audio.muted = true;
    this.onStatus(this.idleStatus());
  }

  async startMicrophone() {
    if (!this.connected) throw new Error('The AI is not connected yet.');
    if (this.microphoneStream) return;
    const supported = navigator.mediaDevices.getSupportedConstraints?.() || {};
    this.onStatus('Starting microphone…');
    this.microphoneStream = await navigator.mediaDevices.getUserMedia({
      audio: microphoneAudioConstraints(supported),
    });
    await this.sender.replaceTrack(this.microphoneStream.getAudioTracks()[0]);
    this.onStatus('Listening');
  }

  async stopMicrophone() {
    await this.sender?.replaceTrack(null);
    this.microphoneStream?.getTracks().forEach((track) => track.stop());
    this.microphoneStream = null;
    this.onStatus('Microphone off');
  }

  async playAudioFile(file) {
    if (!this.connected) throw new Error('The AI is not connected yet.');
    if (!file) throw new Error('Choose an audio file first.');
    if (this.audioTestRunning) throw new Error('An audio test is already running.');

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error('This browser cannot decode audio files.');

    const previousTrack = this.sender.track;
    const context = new AudioContextClass();
    this.audioTestContext = context;
    this.audioTestRunning = true;
    this.onStatus(`Testing audio file: ${file.name || 'audio'}`);

    try {
      await context.resume();
      const audioBuffer = await context.decodeAudioData(await file.arrayBuffer());
      if (audioBuffer.duration < 0.1) throw new Error('The audio file must contain at least 0.1 seconds of sound.');
      const destination = context.createMediaStreamDestination();
      const source = context.createBufferSource();
      source.buffer = audioBuffer;
      source.connect(destination);
      await this.sender.replaceTrack(destination.stream.getAudioTracks()[0]);
      const ended = new Promise((resolve) => { source.onended = resolve; });
      source.start();
      await ended;
      if (this.connected) await this.sender.replaceTrack(previousTrack);
      this.onStatus('Audio test submitted.');
    } finally {
      if (this.channel?.readyState === 'open' && this.sender.track !== previousTrack) {
        await this.sender.replaceTrack(previousTrack).catch(() => {});
      }
      await context.close().catch(() => {});
      if (this.audioTestContext === context) this.audioTestContext = null;
      this.audioTestRunning = false;
    }
  }

  disconnect() {
    this.microphoneStream?.getTracks().forEach((track) => track.stop());
    this.microphoneStream = null;
    this.channel?.close();
    this.connection?.close();
    this.audio?.remove();
    clearTimeout(this.delegationTimer);
    clearTimeout(this.outputTranscriptTimer);
    this.channel = null;
    this.connection = null;
    this.sender = null;
    this.audio = null;
    this.audioTestContext?.close().catch(() => {});
    this.audioTestContext = null;
    this.audioTestRunning = false;
    this.sessionStarted = false;
    this.sessionStartedResolve = null;
    this.inputTranscript = '';
    this.outputTranscript = '';
    this.conversation = [];
    this.pendingDelegations = [];
    this.delegationTimer = null;
    this.outputTranscriptTimer = null;
    this.pendingSpeechCount = 0;
    this.lastInputEndMs = null;
  }

  send(event) {
    if (this.channel?.readyState === 'open') this.channel.send(JSON.stringify(event));
  }

  idleStatus() {
    return this.recording ? 'Listening' : 'Microphone off';
  }

  scheduleDelegations() {
    clearTimeout(this.delegationTimer);
    this.delegationTimer = setTimeout(() => this.flushDelegation(), this.delegationDelayMs);
  }

  async flushDelegation() {
    this.delegationTimer = null;
    const delegation = this.pendingDelegations.shift();
    if (!delegation) return;
    const transcript = this.inputTranscript.trim();
    this.inputTranscript = '';
    if (transcript) {
      this.conversation.push({ role: 'user', text: transcript });
      this.conversation = this.conversation.slice(-12);
      this.onTranscript(`Heard: “${transcript}”`);
    }
    this.onStatus('Processing…');
    try {
      const result = await this.onDelegation({
        delegationId: delegation.id,
        transcript,
        recentConversation: this.conversation.slice(-12),
        offsetMs: delegation.offsetMs,
      });
      this.returnDelegation(result, delegation.id);
    } catch (error) {
      this.returnDelegation({ speak: false, kind: 'error', utterance: '' }, delegation.id);
      this.onStatus(`AI error: ${error.message}`);
      this.onTranscript(`Dealer error: ${error.message}`);
    }
    if (this.pendingDelegations.length > 0) this.scheduleDelegations();
  }

  finishOutputTranscript() {
    clearTimeout(this.outputTranscriptTimer);
    this.outputTranscriptTimer = null;
    const transcript = this.outputTranscript.trim();
    this.outputTranscript = '';
    if (transcript) {
      this.conversation.push({ role: 'assistant', text: transcript });
      this.conversation = this.conversation.slice(-12);
      this.onTranscript(`RoboDeal: “${transcript}”`);
    }
    this.pendingSpeechCount = Math.max(0, this.pendingSpeechCount - 1);
    if (this.pendingSpeechCount === 0 && this.audio) this.audio.muted = true;
    this.onStatus(this.idleStatus());
  }

  async handleEvent(event) {
    if (event.type === 'session.started') {
      this.sessionStarted = true;
      this.sessionStartedResolve?.();
      this.sessionStartedResolve = null;
      return;
    }
    if (event.type === 'session.input_transcript.delta') {
      if (
        Number.isFinite(event.start_ms)
        && Number.isFinite(this.lastInputEndMs)
        && event.start_ms - this.lastInputEndMs > 1_500
      ) {
        this.inputTranscript = '';
      }
      this.inputTranscript = `${this.inputTranscript}${event.delta || ''}`.slice(-4_000);
      if (Number.isFinite(event.end_ms)) this.lastInputEndMs = event.end_ms;
      if (this.pendingDelegations.length > 0) this.scheduleDelegations();
      return;
    }
    if (event.type === 'session.delegation.created' && event.delegation?.target === 'client') {
      this.pendingDelegations.push({ id: event.delegation.id, offsetMs: event.offset_ms });
      this.scheduleDelegations();
      return;
    }
    if (event.type === 'session.output_transcript.delta') {
      if (this.pendingSpeechCount === 0) {
        if (this.audio) this.audio.muted = true;
        return;
      }
      this.outputTranscript += event.delta || '';
      this.onStatus('Speaking…');
      clearTimeout(this.outputTranscriptTimer);
      this.outputTranscriptTimer = setTimeout(() => this.finishOutputTranscript(), 800);
      return;
    }
    if (event.type === 'session.output_transcript.done' || event.type === 'session.output_audio.done') {
      this.finishOutputTranscript();
      return;
    }
    if (event.type === 'error') {
      this.pendingSpeechCount = 0;
      this.onStatus(`AI error: ${event.error?.message || 'unknown error'}`);
    }
  }
}
