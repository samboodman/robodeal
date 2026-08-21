export function audioBufferToPcm16(audioBuffer, targetSampleRate = 24_000) {
  const sourceRate = audioBuffer.sampleRate;
  const outputLength = Math.floor(audioBuffer.length * targetSampleRate / sourceRate);
  const pcm = new Uint8Array(outputLength * 2);
  const view = new DataView(pcm.buffer);
  const channels = Array.from(
    { length: audioBuffer.numberOfChannels },
    (_, channel) => audioBuffer.getChannelData(channel),
  );

  for (let index = 0; index < outputLength; index += 1) {
    const sourcePosition = index * sourceRate / targetSampleRate;
    const first = Math.floor(sourcePosition);
    const second = Math.min(first + 1, audioBuffer.length - 1);
    const mix = sourcePosition - first;
    let sample = 0;
    channels.forEach((channel) => {
      sample += channel[first] + (channel[second] - channel[first]) * mix;
    });
    sample = Math.max(-1, Math.min(1, sample / channels.length));
    view.setInt16(index * 2, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
  }
  return pcm;
}

export function bytesToBase64(bytes) {
  let binary = '';
  const blockSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += blockSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + blockSize));
  }
  return btoa(binary);
}

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

export class VoiceAgent {
  constructor({ getInstructions, prompts, tools = [], executeTool, onTranscript = () => {}, onStatus = () => {} }) {
    this.getInstructions = getInstructions;
    this.prompts = prompts;
    this.tools = tools;
    this.executeTool = executeTool;
    this.onTranscript = onTranscript;
    this.onStatus = onStatus;
    this.connection = null;
    this.channel = null;
    this.sender = null;
    this.audio = null;
    this.microphoneStream = null;
    this.audioTestContext = null;
    this.audioTestRunning = false;
  }

  get connected() {
    return this.channel?.readyState === 'open';
  }

  get recording() {
    return Boolean(this.microphoneStream);
  }

  sessionConfiguration(voice) {
    return {
      type: 'realtime',
      instructions: this.getInstructions(),
      tools: this.tools,
      tool_choice: this.tools.length > 0 ? 'auto' : 'none',
      output_modalities: ['audio'],
      audio: {
        input: {
          format: { type: 'audio/pcm', rate: 24_000 },
          noise_reduction: { type: 'far_field' },
          transcription: {
            model: 'gpt-live-transcribe',
            prompt: this.prompts.transcription.prompt,
            keywords: this.prompts.transcription.keywords,
            languages: this.prompts.transcription.languages,
            delay: 'medium',
          },
          turn_detection: { type: 'semantic_vad', create_response: false, interrupt_response: false },
        },
        output: { voice },
      },
    };
  }

  async connect(voice = 'marin') {
    this.disconnect();
    if (!window.RTCPeerConnection) throw new Error('This browser does not support WebRTC.');

    this.connection = new RTCPeerConnection();
    this.sender = this.connection.addTransceiver('audio', { direction: 'sendrecv' }).sender;
    this.connection.addEventListener('track', (event) => {
      if (!this.audio) {
        this.audio = document.createElement('audio');
        this.audio.autoplay = true;
        this.audio.playsInline = true;
        this.audio.hidden = true;
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
    this.channel.addEventListener('message', (event) => this.handleEvent(JSON.parse(event.data)));
    this.channel.addEventListener('close', () => this.onStatus('Voice connection ended.'));

    const offer = await this.connection.createOffer();
    await this.connection.setLocalDescription(offer);
    const response = await fetch('/api/realtime-call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sdp: offer.sdp }),
    });
    const answer = await response.text();
    if (!response.ok) throw new Error(answer);
    await this.connection.setRemoteDescription({ type: 'answer', sdp: answer });
    await channelOpened;
    this.send({ type: 'session.update', session: this.sessionConfiguration(voice) });
    this.onStatus('AI connected.');
  }

  updateContext() {
    if (!this.connected) return;
    this.send({
      type: 'session.update',
      session: {
        type: 'realtime',
        instructions: this.getInstructions(),
        tools: this.tools,
        tool_choice: this.tools.length > 0 ? 'auto' : 'none',
      },
    });
  }

  speak(text) {
    if (!this.connected) return;
    this.send({
      type: 'response.create',
      response: {
        conversation: 'none',
        input: [{
          type: 'message',
          role: 'user',
          content: [{ type: 'input_text', text: fillPrompt(this.prompts.sayExactly, { TEXT: text }) }],
        }],
        tool_choice: 'none',
      },
    });
  }

  async startMicrophone() {
    if (!this.connected) throw new Error('The AI is not connected yet.');
    if (this.microphoneStream) return;
    const supported = navigator.mediaDevices.getSupportedConstraints?.() || {};
    this.microphoneStream = await navigator.mediaDevices.getUserMedia({
      audio: microphoneAudioConstraints(supported),
    });
    await this.sender.replaceTrack(this.microphoneStream.getAudioTracks()[0]);
    this.onStatus('AI is listening.');
  }

  async stopMicrophone() {
    await this.sender?.replaceTrack(null);
    this.microphoneStream?.getTracks().forEach((track) => track.stop());
    this.microphoneStream = null;
    this.onStatus('Microphone is off.');
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
      const pcm = audioBufferToPcm16(audioBuffer);
      if (pcm.length < 4_800) throw new Error('The audio file must contain at least 0.1 seconds of sound.');

      await this.sender.replaceTrack(null);
      this.send({ type: 'input_audio_buffer.clear' });
      const chunkSize = 48_000;
      for (let offset = 0; offset < pcm.length; offset += chunkSize) {
        this.send({
          type: 'input_audio_buffer.append',
          audio: bytesToBase64(pcm.subarray(offset, offset + chunkSize)),
        });
      }
      this.send({ type: 'input_audio_buffer.commit' });
      if (this.connected) await this.sender.replaceTrack(previousTrack);
      this.onStatus('Audio test submitted.');
    } finally {
      if (this.connected && this.sender.track !== previousTrack) {
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
    this.channel = null;
    this.connection = null;
    this.sender = null;
    this.audio = null;
    this.audioTestContext?.close().catch(() => {});
    this.audioTestContext = null;
    this.audioTestRunning = false;
  }

  send(event) {
    if (this.connected) this.channel.send(JSON.stringify(event));
  }

  async handleEvent(event) {
    if (event.type === 'conversation.item.input_audio_transcription.completed') {
      this.onTranscript(`Heard: “${event.transcript}”`);
      this.updateContext();
      this.send({ type: 'response.create' });
      return;
    }
    if (event.type === 'response.output_audio_transcript.done') {
      this.onTranscript(`RoboDeal: “${event.transcript}”`);
      return;
    }
    if (event.type === 'error') {
      this.onStatus(`AI error: ${event.error?.message || 'unknown error'}`);
      return;
    }
    if (event.type !== 'response.function_call_arguments.done') return;

    let result;
    try {
      result = await this.executeTool(event.name, JSON.parse(event.arguments || '{}'));
    } catch (error) {
      result = { ok: false, message: error.message };
    }

    this.send({
      type: 'conversation.item.create',
      item: {
        type: 'function_call_output',
        call_id: event.call_id,
        output: JSON.stringify(result),
      },
    });
    if (result.silent) return;
    this.updateContext();
    this.send({ type: 'response.create' });
  }
}
