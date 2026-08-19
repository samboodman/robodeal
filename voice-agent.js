export class VoiceAgent {
  constructor({ getInstructions, getRelevanceContext = () => '', tools = [], executeTool, onTranscript = () => {}, onStatus = () => {} }) {
    this.getInstructions = getInstructions;
    this.getRelevanceContext = getRelevanceContext;
    this.tools = tools;
    this.executeTool = executeTool;
    this.onTranscript = onTranscript;
    this.onStatus = onStatus;
    this.connection = null;
    this.channel = null;
    this.sender = null;
    this.audio = null;
    this.microphoneStream = null;
    this.pendingRelevanceChecks = new Map();
    this.nextUtteranceNumber = 1;
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
          turn_detection: { type: 'server_vad', create_response: false, interrupt_response: false },
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
    this.pendingRelevanceChecks.forEach(({ cleanupTimer }) => clearTimeout(cleanupTimer));
    this.pendingRelevanceChecks.clear();
  }

  send(event) {
    if (this.connected) this.channel.send(JSON.stringify(event));
  }

  checkTranscriptRelevance(transcript, itemId) {
    const utteranceId = `utterance-${this.nextUtteranceNumber++}`;
    const cleanupTimer = setTimeout(() => {
      this.pendingRelevanceChecks.delete(utteranceId);
    }, 30_000);
    this.pendingRelevanceChecks.set(utteranceId, { itemId, cleanupTimer });

    this.send({
      type: 'response.create',
      response: {
        conversation: 'none',
        output_modalities: ['text'],
        metadata: { kind: 'relevance-check', utteranceId },
        max_output_tokens: 64,
        instructions: [
          'Use semantic understanding of the complete heard sentence and the supplied live game state.',
          'Call approve_game_utterance only when the sentence is meaningfully related to the current game.',
          'Do not classify by matching individual words or phrases.',
          'For anything unrelated or uncertain, do not call the function and output only UNRELATED.',
          'Do not answer the speaker.',
        ].join(' '),
        input: [{
          type: 'message',
          role: 'user',
          content: [{
            type: 'input_text',
            text: `Current poker game state:\n${this.getRelevanceContext()}\n\nHeard sentence:\n${transcript}`,
          }],
        }],
        tools: [{
          type: 'function',
          name: 'approve_game_utterance',
          description: 'Approve an utterance whose complete semantic meaning is related to the current game.',
          parameters: {
            type: 'object',
            properties: {
              utteranceId: {
                type: 'string',
                enum: [utteranceId],
              },
            },
            required: ['utteranceId'],
            additionalProperties: false,
          },
        }],
        tool_choice: 'auto',
      },
    });
  }

  approveGameUtterance(argumentsJson) {
    let utteranceId;
    try {
      utteranceId = JSON.parse(argumentsJson || '{}').utteranceId;
    } catch {
      return;
    }
    const pending = this.pendingRelevanceChecks.get(utteranceId);
    if (!pending) return;

    clearTimeout(pending.cleanupTimer);
    this.pendingRelevanceChecks.delete(utteranceId);
    this.updateContext();
    this.send({ type: 'response.create' });
  }

  rejectUnapprovedUtterance(response) {
    const utteranceId = response.metadata?.utteranceId;
    const pending = this.pendingRelevanceChecks.get(utteranceId);
    if (!pending) return;

    clearTimeout(pending.cleanupTimer);
    this.pendingRelevanceChecks.delete(utteranceId);
    if (pending.itemId) {
      this.send({ type: 'conversation.item.delete', item_id: pending.itemId });
    }
  }

  async handleEvent(event) {
    if (event.type === 'conversation.item.input_audio_transcription.completed') {
      this.onTranscript(`Heard: “${event.transcript}”`);
      this.checkTranscriptRelevance(event.transcript, event.item_id);
      return;
    }
    if (event.type === 'response.done' && event.response?.metadata?.kind === 'relevance-check') {
      this.rejectUnapprovedUtterance(event.response);
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
    if (event.name === 'approve_game_utterance') {
      this.approveGameUtterance(event.arguments);
      return;
    }

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
