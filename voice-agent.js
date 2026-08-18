export class VoiceAgent {
  constructor({ getInstructions, tools = [], executeTool, onTranscript = () => {}, onStatus = () => {} }) {
    this.getInstructions = getInstructions;
    this.tools = tools;
    this.executeTool = executeTool;
    this.onTranscript = onTranscript;
    this.onStatus = onStatus;
    this.connection = null;
    this.channel = null;
    this.sender = null;
    this.audio = null;
    this.microphoneStream = null;
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
          noise_reduction: { type: 'far_field' },
          transcription: { model: 'gpt-4o-mini-transcribe', language: 'en' },
          turn_detection: { type: 'server_vad', create_response: true, interrupt_response: true },
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
          content: [{ type: 'input_text', text: `Say exactly this: ${text}` }],
        }],
        tool_choice: 'none',
      },
    });
  }

  async startMicrophone() {
    if (!this.connected) throw new Error('The AI is not connected yet.');
    if (this.microphoneStream) return;
    this.microphoneStream = await navigator.mediaDevices.getUserMedia({
      audio: { echoCancellation: true, noiseSuppression: true },
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
  }

  send(event) {
    if (this.connected) this.channel.send(JSON.stringify(event));
  }

  async handleEvent(event) {
    if (event.type === 'conversation.item.input_audio_transcription.completed') {
      this.onTranscript(`Heard: “${event.transcript}”`);
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
    this.updateContext();
    this.send({ type: 'response.create' });
  }
}
