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

export function rootMeanSquare(samples) {
  if (!samples?.length) return 0;
  let sum = 0;
  for (const sample of samples) sum += sample * sample;
  return Math.sqrt(sum / samples.length);
}

export function isBackchannelOnly(text) {
  const compact = String(text || '').toLowerCase().replace(/[^a-z]/g, '');
  return /^(?:m+h+m+|m+h+|h+m+|u+h+u+h+|u+h+h+|ok(?:ay)?|right|gotit|isee|yeah|yep)$/.test(compact);
}

export function isBackchannelPrefix(text) {
  const compact = String(text || '').toLowerCase().replace(/[^a-z]/g, '');
  if (!compact) return true;
  if (/^(?:m+h*m*|h+m*|u+h*(?:u+h*)?)$/.test(compact)) return true;
  const backchannels = ['mhmm', 'mhm', 'hmm', 'uhhuh', 'uhuh', 'okay', 'ok', 'right', 'gotit', 'isee', 'yeah', 'yep'];
  return backchannels.some((backchannel) => backchannel.startsWith(compact));
}

const APPEND_MAX_CHARS = 1200;

function markVoiceStage(name) {
  if (!globalThis.window?.performance) return;
  globalThis.window.__robodealVoiceStages ||= {};
  globalThis.window.__robodealVoiceStages[name] = globalThis.window.performance.now();
}

function clampAppend(content) {
  const text = String(content ?? '');
  return text.length <= APPEND_MAX_CHARS ? text : `${text.slice(0, APPEND_MAX_CHARS)}…`;
}

function eventId(prefix) {
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

const VAD_POLL_MS = 50;
const VAD_RMS_THRESHOLD = 0.012;

export class VoiceAgent {
  constructor({
    onDelegation = async () => ({ speak: false, kind: 'ignored', utterance: '' }),
    onSpeculativeDelegation = null,
    onTranscript = () => {},
    onStatus = () => {},
    onLatency = () => {},
    silentAppend = '',
    delegationDelayMs = 60,
    speculationDelayMs = 250,
    outputSilenceThreshold = 0.008,
    outputSilenceMs = 180,
    outputDrainMinMs = 350,
    outputDrainMaxMs = 2_000,
    outputDrainFallbackMs = 450,
    outputDrainPollMs = 30,
    outputResponseTimeoutMs = 5_000,
    outputTranscriptIdleMs = 800,
    outputAuthorizationDelayMs = 150,
    eagerEndOfTurnMs = 200,
    speechFetch = (...args) => fetch(...args),
    createPlaybackAudio = () => new Audio(),
  } = {}) {
    this.onDelegation = onDelegation;
    this.onSpeculativeDelegation = onSpeculativeDelegation;
    this.onTranscript = onTranscript;
    this.onStatus = onStatus;
    this.onLatency = onLatency;
    this.silentAppend = silentAppend;
    this.delegationDelayMs = delegationDelayMs;
    this.speculationDelayMs = speculationDelayMs;
    this.outputSilenceThreshold = outputSilenceThreshold;
    this.outputSilenceMs = outputSilenceMs;
    this.outputDrainMinMs = outputDrainMinMs;
    this.outputDrainMaxMs = outputDrainMaxMs;
    this.outputDrainFallbackMs = outputDrainFallbackMs;
    this.outputDrainPollMs = outputDrainPollMs;
    this.outputResponseTimeoutMs = outputResponseTimeoutMs;
    this.outputTranscriptIdleMs = outputTranscriptIdleMs;
    this.outputAuthorizationDelayMs = outputAuthorizationDelayMs;
    this.connection = null;
    this.channel = null;
    this.sender = null;
    this.audio = null;
    this.silentInputContext = null;
    this.silentInputTrack = null;
    this.outputAudioContext = null;
    this.outputAudioSource = null;
    this.outputAnalyser = null;
    this.outputAnalyserSamples = null;
    this.outputDelay = null;
    this.outputGate = null;
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
    this.speculationTimer = null;
    this.speculativeTurn = null;
    this.outputTranscriptTimer = null;
    this.outputTranscriptAuthorized = false;
    this.outputDrainTimer = null;
    this.outputDrainStartedAt = null;
    this.outputSilenceStartedAt = null;
    this.outputCompletionsAwaitingDrain = 0;
    this.pendingSpeechTelemetry = [];
    this.pendingSpeechCount = 0;
    this.lastInputEndMs = null;
    this.eagerEndOfTurnMs = eagerEndOfTurnMs;
    this.speechFetch = speechFetch;
    this.createPlaybackAudio = createPlaybackAudio;
    this.eagerDelegated = false;
    this.eagerInFlight = false;
    this.vadContext = null;
    this.vadAnalyser = null;
    this.vadSamples = null;
    this.vadTimer = null;
    this.lastVoiceAt = 0;
    this.playbackAudio = null;
    this.playbackUrl = null;
    this.speechGeneration = 0;
  }

  get connected() {
    return this.channel?.readyState === 'open' && this.sessionStarted;
  }

  get recording() {
    return Boolean(this.microphoneStream);
  }

  createSilentInputTrack() {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return null;
    const context = new AudioContextClass();
    const destination = context.createMediaStreamDestination();
    const gain = context.createGain();
    gain.gain.value = 0;
    const oscillator = context.createOscillator();
    oscillator.connect(gain);
    gain.connect(destination);
    oscillator.start();
    this.silentInputContext = context;
    this.silentInputTrack = destination.stream.getAudioTracks()[0];
    return this.silentInputTrack;
  }

  async connect(voice = 'marin', { accent = 'neutral', pace = 'natural', preview = false } = {}) {
    this.disconnect();
    this.onStatus('Connecting…');
    this.voice = voice;
    this.accent = accent;
    this.pace = pace;
    if (!window.RTCPeerConnection) throw new Error('This browser does not support WebRTC.');

    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (AudioContextClass) {
      this.outputAudioContext = new AudioContextClass();
      await this.outputAudioContext.resume().catch(() => {});
    }

    this.connection = new RTCPeerConnection();
    this.sender = this.connection.addTransceiver('audio', { direction: 'sendrecv' }).sender;
    if (preview) {
      const silentTrack = this.createSilentInputTrack();
      if (silentTrack) await this.sender.replaceTrack(silentTrack);
    }
    this.connection.addEventListener('track', (event) => {
      if (!this.audio) {
        this.audio = document.createElement('audio');
        this.audio.autoplay = true;
        this.audio.playsInline = true;
        this.audio.hidden = true;
        this.audio.muted = true;
        document.body.append(this.audio);
      }
      this.audio.srcObject = event.streams[0];
      this.connectOutputMonitor();
      this.setOutputGate(this.pendingSpeechCount > 0);
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
      content: clampAppend(context),
    });
  }

  speak(text, delegationId = null, timing = null) {
    const sentence = String(text ?? '').trim();
    if (!this.connected || !sentence) return;
    this.stopExactSpeech(false);
    const generation = this.speechGeneration;
    this.pendingSpeechCount = 1;
    this.pendingSpeechTelemetry = [{ ...(timing || {}), commentarySentAt: Date.now(), speechStarted: false }];
    this.onStatus('Speaking…');
    this.playExactSpeech(sentence, generation).catch((error) => {
      if (generation !== this.speechGeneration) return;
      this.finishExactSpeech(generation);
      this.onStatus(`AI error: ${error.message}`);
    });
  }

  instruct(text) {
    if (!this.connected || !text) return;
    this.send({
      type: 'session.instructions.append',
      event_id: eventId('instruction'),
      delegation_id: null,
      content: clampAppend(text),
    });
  }

  async playExactSpeech(text, generation) {
    const response = await this.speechFetch('/api/speech', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text, voice: this.voice, accent: this.accent, pace: this.pace }),
    });
    if (!response.ok) throw new Error(await response.text() || 'Speech rendering failed.');
    const audio = this.createPlaybackAudio();
    const blob = await response.blob();
    if (generation !== this.speechGeneration) return;
    this.playbackAudio = audio;
    this.playbackUrl = URL.createObjectURL(blob);
    audio.src = this.playbackUrl;
    audio.onplay = () => {
      if (generation !== this.speechGeneration) return;
      const telemetry = this.pendingSpeechTelemetry[0];
      if (telemetry && !telemetry.speechStarted) {
        telemetry.speechStarted = true;
        this.onLatency({ ...telemetry, ttsSpeechStartMs: Date.now() - telemetry.commentarySentAt });
      }
    };
    audio.onended = () => this.finishExactSpeech(generation);
    await audio.play();
  }

  stopExactSpeech(updateStatus = true) {
    this.speechGeneration += 1;
    this.playbackAudio?.pause();
    this.playbackAudio = null;
    if (this.playbackUrl) URL.revokeObjectURL(this.playbackUrl);
    this.playbackUrl = null;
    this.pendingSpeechCount = 0;
    this.pendingSpeechTelemetry = [];
    if (updateStatus) this.onStatus(this.idleStatus());
  }

  finishExactSpeech(generation) {
    if (generation !== this.speechGeneration) return;
    this.playbackAudio = null;
    if (this.playbackUrl) URL.revokeObjectURL(this.playbackUrl);
    this.playbackUrl = null;
    this.pendingSpeechCount = 0;
    this.pendingSpeechTelemetry = [];
    this.onStatus(this.idleStatus());
  }

  returnDelegation(result, delegationId) {
    if (result?.speak && result.utterance) {
      this.speak(result.utterance, delegationId, result.timing);
      return;
    }
    if (this.silentAppend) {
      this.send({
        type: 'session.thinking.append',
        event_id: eventId('silent'),
        delegation_id: delegationId,
        content: this.silentAppend,
      });
    }
    if (this.pendingSpeechCount === 0) this.setOutputGate(false);
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
    this.startInputVad(this.microphoneStream);
    this.onStatus('Listening');
  }

  startInputVad(stream) {
    this.stopInputVad();
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) return;
    try {
      const context = new AudioContextClass();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 512;
      source.connect(analyser);
      this.vadContext = context;
      this.vadAnalyser = analyser;
      this.vadSamples = new Float32Array(analyser.fftSize);
      this.lastVoiceAt = Date.now();
      this.vadTimer = setInterval(() => this.pollInputVad(), VAD_POLL_MS);
    } catch {
      this.vadContext = null;
      this.vadAnalyser = null;
      this.vadSamples = null;
      this.vadTimer = null;
    }
  }

  pollInputVad() {
    if (!this.vadAnalyser || !this.vadSamples) return;
    this.vadAnalyser.getFloatTimeDomainData(this.vadSamples);
    let sum = 0;
    for (let index = 0; index < this.vadSamples.length; index += 1) sum += this.vadSamples[index] * this.vadSamples[index];
    const rms = Math.sqrt(sum / this.vadSamples.length);
    const now = Date.now();
    if (rms > VAD_RMS_THRESHOLD) {
      this.lastVoiceAt = now;
      return;
    }
    // Local silence is enough to commit the turn: don't wait for the server to
    // decide we stopped. The speculative dealer turn (if already prepared) is
    // reused, so this removes the end-of-turn detection wait.
    if (!this.recording || this.eagerDelegated || this.eagerInFlight) return;
    if (!this.inputTranscript.trim()) return;
    if (now - this.lastVoiceAt < this.eagerEndOfTurnMs) return;
    if (this.pendingDelegations.length > 0) return;
    this.maybeEagerEndOfTurn();
  }

  async maybeEagerEndOfTurn() {
    this.eagerInFlight = true;
    try {
      const transcript = this.inputTranscript.trim();
      const turn = this.speculativeTurn;
      // Only commit early when the speculative dealer turn matches exactly this
      // transcript — i.e. the decision for this exact wording is ready.
      if (!turn || turn.transcript !== transcript) return;
      const prepared = await turn.preparedTurn;
      if (!prepared || prepared.error || !prepared.response) return;
      // Never commit a partial/no-op utterance: only commit when the model
      // returned a concrete action for it.
      if (!prepared.response.speak || !prepared.response.toolName) return;
      if (this.eagerDelegated || this.pendingDelegations.length > 0) return;
      this.eagerDelegated = true;
      this.pendingDelegations.push({
        id: eventId('eager'),
        offsetMs: null,
        inputEndMs: this.lastInputEndMs,
        receivedAt: Date.now(),
        eager: true,
      });
      this.scheduleDelegations();
    } finally {
      this.eagerInFlight = false;
    }
  }

  stopInputVad() {
    clearInterval(this.vadTimer);
    this.vadTimer = null;
    this.vadContext?.close().catch(() => {});
    this.vadContext = null;
    this.vadAnalyser = null;
    this.vadSamples = null;
  }

  async stopMicrophone() {
    this.stopInputVad();
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
    this.stopExactSpeech(false);
    this.microphoneStream?.getTracks().forEach((track) => track.stop());
    this.microphoneStream = null;
    this.channel?.close();
    this.connection?.close();
    this.audio?.remove();
    clearTimeout(this.delegationTimer);
    clearTimeout(this.speculationTimer);
    clearTimeout(this.outputTranscriptTimer);
    clearTimeout(this.outputDrainTimer);
    this.stopInputVad();
    this.channel = null;
    this.connection = null;
    this.sender = null;
    this.audio = null;
    this.outputAudioSource = null;
    this.outputAnalyser = null;
    this.outputAnalyserSamples = null;
    this.outputDelay = null;
    this.outputGate = null;
    this.silentInputTrack?.stop();
    this.silentInputTrack = null;
    this.silentInputContext?.close().catch(() => {});
    this.silentInputContext = null;
    this.outputAudioContext?.close().catch(() => {});
    this.outputAudioContext = null;
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
    this.speculationTimer = null;
    this.speculativeTurn = null;
    this.outputTranscriptTimer = null;
    this.outputTranscriptAuthorized = false;
    this.outputDrainTimer = null;
    this.outputDrainStartedAt = null;
    this.outputSilenceStartedAt = null;
    this.outputCompletionsAwaitingDrain = 0;
    this.pendingSpeechTelemetry = [];
    this.pendingSpeechCount = 0;
    this.lastInputEndMs = null;
    this.eagerDelegated = false;
    this.eagerInFlight = false;
  }

  send(event) {
    if (this.channel?.readyState === 'open') this.channel.send(JSON.stringify(event));
  }

  idleStatus() {
    return this.recording ? 'Listening' : 'Microphone off';
  }

  connectOutputMonitor() {
    if (!this.audio || !this.outputAudioContext || this.outputAudioSource) return;
    try {
      this.outputAudioSource = this.outputAudioContext.createMediaElementSource(this.audio);
      this.outputAnalyser = this.outputAudioContext.createAnalyser();
      this.outputAnalyser.fftSize = 512;
      this.outputAnalyserSamples = new Float32Array(this.outputAnalyser.fftSize);
      this.outputDelay = this.outputAudioContext.createDelay(1);
      this.outputDelay.delayTime.value = this.outputAuthorizationDelayMs / 1_000;
      this.outputGate = this.outputAudioContext.createGain();
      this.outputAudioSource.connect(this.outputDelay);
      this.outputDelay.connect(this.outputAnalyser);
      this.outputAnalyser.connect(this.outputGate);
      this.outputGate.connect(this.outputAudioContext.destination);
      this.audio.muted = false;
    } catch {
      this.outputAudioSource = null;
      this.outputAnalyser = null;
      this.outputAnalyserSamples = null;
      this.outputDelay = null;
      this.outputGate = null;
    }
  }

  setOutputGate(open) {
    // GPT-Live is used for microphone transcription and delegation only. Its
    // generative audio can paraphrase or speak unsolicited text, so it never
    // reaches the speakers; exact app narration uses playExactSpeech instead.
    void open;
    if (this.outputGate && this.outputAudioContext) {
      const { gain } = this.outputGate;
      gain.cancelScheduledValues?.(this.outputAudioContext.currentTime);
      gain.setValueAtTime(0, this.outputAudioContext.currentTime);
      if (this.audio) this.audio.muted = true;
      return;
    }
    if (this.audio) this.audio.muted = true;
  }

  silenceOutputForUserSpeech() {
    this.stopExactSpeech(false);
    this.pendingSpeechCount = 0;
    this.pendingSpeechTelemetry = [];
    this.outputCompletionsAwaitingDrain = 0;
    this.outputDrainStartedAt = null;
    this.outputSilenceStartedAt = null;
    this.outputTranscript = '';
    this.outputTranscriptAuthorized = false;
    clearTimeout(this.outputTranscriptTimer);
    this.outputTranscriptTimer = null;
    clearTimeout(this.outputDrainTimer);
    this.outputDrainTimer = null;
    this.setOutputGate(false);
  }

  outputIsSilent() {
    if (!this.outputAnalyser || !this.outputAnalyserSamples) return null;
    this.outputAnalyser.getFloatTimeDomainData(this.outputAnalyserSamples);
    return rootMeanSquare(this.outputAnalyserSamples) < this.outputSilenceThreshold;
  }

  scheduleDelegations() {
    clearTimeout(this.delegationTimer);
    this.delegationTimer = setTimeout(() => this.flushDelegation(), this.delegationDelayMs);
  }

  scheduleSpeculation() {
    if (!this.onSpeculativeDelegation) return;
    clearTimeout(this.speculationTimer);
    this.speculationTimer = setTimeout(() => {
      this.speculationTimer = null;
      const transcript = this.inputTranscript.trim();
      if (!transcript) return;
      const recentConversation = [
        ...this.conversation,
        { role: 'user', text: transcript },
      ].slice(-12);
      this.speculativeTurn = {
        transcript,
        preparedTurn: this.onSpeculativeDelegation({ transcript, recentConversation }),
      };
    }, this.speculationDelayMs);
  }

  async flushDelegation() {
    this.delegationTimer = null;
    clearTimeout(this.speculationTimer);
    this.speculationTimer = null;
    const delegation = this.pendingDelegations.shift();
    if (!delegation) return;
    const transcript = this.inputTranscript.trim();
    this.inputTranscript = '';
    if (transcript) {
      this.conversation.push({ role: 'user', text: transcript });
      this.conversation = this.conversation.slice(-12);
      this.onTranscript(`Heard: “${transcript}”`);
    }
    const preparedTurn = this.speculativeTurn?.transcript === transcript
      ? this.speculativeTurn.preparedTurn
      : null;
    this.speculativeTurn = null;
    this.onStatus('Processing…');
    markVoiceStage('delegationFlushed');
    const backendStartedAt = Date.now();
    try {
      const result = await this.onDelegation({
        delegationId: delegation.id,
        transcript,
        recentConversation: this.conversation.slice(-12),
        offsetMs: delegation.offsetMs,
        preparedTurn,
      });
      result.timing = {
        ...(result.timing || {}),
        transcriptBufferMs: backendStartedAt - delegation.receivedAt,
        liveTurnDetectionMs: Number.isFinite(delegation.offsetMs) && Number.isFinite(delegation.inputEndMs)
          ? Math.max(0, delegation.offsetMs - delegation.inputEndMs)
          : null,
      };
      markVoiceStage('delegationCompleted');
      this.returnDelegation(result, delegation.eager ? null : delegation.id);
    } catch (error) {
      this.returnDelegation({ speak: false, kind: 'error', utterance: '' }, delegation.eager ? null : delegation.id);
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
  }

  scheduleOutputCompletion(delayMs) {
    clearTimeout(this.outputTranscriptTimer);
    this.outputTranscriptTimer = setTimeout(() => this.completeOutputResponse(), delayMs);
    this.outputTranscriptTimer.unref?.();
  }

  completeOutputResponse() {
    if (!this.outputTranscriptAuthorized && isBackchannelOnly(this.outputTranscript)) {
      this.outputTranscript = '';
      this.setOutputGate(false);
      this.onStatus('Processing…');
      this.scheduleOutputCompletion(this.outputResponseTimeoutMs);
      return;
    }
    this.finishOutputTranscript();
    this.outputTranscriptAuthorized = false;
    if (this.outputCompletionsAwaitingDrain === 0) this.markOutputAudioDone();
  }

  markOutputAudioDone() {
    if (this.pendingSpeechCount === 0) {
      this.setOutputGate(false);
      return;
    }
    this.outputCompletionsAwaitingDrain += 1;
    clearTimeout(this.outputDrainTimer);
    this.outputDrainStartedAt = Date.now();
    this.outputSilenceStartedAt = null;
    this.pollOutputDrain();
  }

  pollOutputDrain() {
    const now = Date.now();
    const elapsed = now - this.outputDrainStartedAt;
    const silent = this.outputIsSilent();

    if (silent === null) {
      if (elapsed >= this.outputDrainFallbackMs) {
        this.finishOutputPlayback();
        return;
      }
    } else if (silent) {
      this.outputSilenceStartedAt ??= now;
      const silentFor = now - this.outputSilenceStartedAt;
      if (elapsed >= this.outputDrainMinMs && silentFor >= this.outputSilenceMs) {
        this.finishOutputPlayback();
        return;
      }
    } else {
      this.outputSilenceStartedAt = null;
    }

    if (elapsed >= this.outputDrainMaxMs) {
      this.finishOutputPlayback();
      return;
    }
    this.outputDrainTimer = setTimeout(() => this.pollOutputDrain(), this.outputDrainPollMs);
    this.outputDrainTimer.unref?.();
  }

  finishOutputPlayback() {
    clearTimeout(this.outputDrainTimer);
    this.outputDrainTimer = null;
    const completed = this.outputCompletionsAwaitingDrain;
    this.outputCompletionsAwaitingDrain = 0;
    this.outputDrainStartedAt = null;
    this.outputSilenceStartedAt = null;
    this.pendingSpeechCount = Math.max(0, this.pendingSpeechCount - completed);
    this.pendingSpeechTelemetry.splice(0, completed);
    if (this.pendingSpeechCount === 0) {
      this.setOutputGate(false);
      this.onStatus(this.idleStatus());
    } else {
      this.onStatus('Speaking…');
    }
  }

  async handleEvent(event) {
    if (event.type === 'session.started') {
      this.sessionStarted = true;
      this.sessionStartedResolve?.();
      this.sessionStartedResolve = null;
      return;
    }
    if (event.type === 'session.input_transcript.delta') {
      // Any new foreground speech revokes the previous output authorization.
      // This both handles interruption and prevents GPT-Live backchannels from
      // leaking through while the authoritative dealer is still working.
      this.silenceOutputForUserSpeech();
      if (
        Number.isFinite(event.start_ms)
        && Number.isFinite(this.lastInputEndMs)
        && event.start_ms - this.lastInputEndMs > 1_500
      ) {
        this.inputTranscript = '';
        this.eagerDelegated = false;
      }
      this.inputTranscript = `${this.inputTranscript}${event.delta || ''}`.slice(-4_000);
      this.scheduleSpeculation();
      if (Number.isFinite(event.end_ms)) {
        this.lastInputEndMs = event.end_ms;
        if (this.pendingDelegations.length > 0) {
          this.pendingDelegations[this.pendingDelegations.length - 1].inputEndMs = event.end_ms;
        }
      }
      if (this.pendingDelegations.length > 0) this.scheduleDelegations();
      return;
    }
    if (event.type === 'session.delegation.created' && event.delegation?.target === 'client') {
      markVoiceStage('delegationReceived');
      // If we already committed this turn locally (eager end-of-turn), ignore
      // the server's duplicate delegation.
      if (this.eagerDelegated) return;
      this.pendingDelegations.push({
        id: event.delegation.id,
        offsetMs: event.offset_ms,
        inputEndMs: this.lastInputEndMs,
        receivedAt: Date.now(),
      });
      this.scheduleDelegations();
      return;
    }
    if (event.type === 'session.output_transcript.delta') {
      this.setOutputGate(false);
      return;
    }
    if (event.type === 'session.output_transcript.done') {
      this.setOutputGate(false);
      return;
    }
    if (event.type === 'session.output_audio.done') {
      return;
    }
    if (event.type === 'error') {
      this.pendingSpeechCount = 0;
      this.outputCompletionsAwaitingDrain = 0;
      clearTimeout(this.outputDrainTimer);
      this.outputDrainTimer = null;
      this.setOutputGate(false);
      this.onStatus(`AI error: ${event.error?.message || 'unknown error'}`);
    }
  }
}
