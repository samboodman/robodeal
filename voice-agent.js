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

function bytesToBase64(bytes) {
  let binary = '';
  const blockSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += blockSize) {
    binary += String.fromCharCode(...bytes.subarray(offset, offset + blockSize));
  }
  return btoa(binary);
}

async function blobToBase64(blob) {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

function responseText(response) {
  if (response.output_text) {return response.output_text.trim();}
  return (response.output || [])
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === 'output_text')
    .map((content) => content.text)
    .join('\n')
    .trim();
}

async function apiJson(body, signal) {
  const response = await fetch('/api/voice', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
    signal,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {throw new Error(result.error || 'The voice service failed.');}
  return result;
}

export class VoiceAgent {
  constructor({ getInstructions, prompts, tools = [], executeTool, onTranscript = () => {}, onStatus = () => {} }) {
    this.getInstructions = getInstructions;
    this.prompts = prompts;
    this.tools = tools;
    this.executeTool = executeTool;
    this.onTranscript = onTranscript;
    this.onStatus = onStatus;
    this.voice = 'alloy';
    this.isConnected = false;
    this.microphoneStream = null;
    this.peerConnection = null;
    this.dataChannel = null;
    this.vadAudioContext = null;
    this.vadSource = null;
    this.vadAnalyser = null;
    this.vadSamples = null;
    this.vadTimer = null;
    this.vadSpeaking = false;
    this.vadSpeechStartedAt = 0;
    this.vadLastVoiceAt = 0;
    this.microphoneMuted = false;
    this.transcriptDeltas = new Map();
    this.transcriptQueue = Promise.resolve();
    this.processingTranscript = false;
    this.audio = null;
    this.audioUrl = null;
    this.activeRequest = null;
    this.audioTestRunning = false;
    this.pendingResponseCount = 0;
  }

  get connected() {
    return this.isConnected;
  }

  get recording() {
    return Boolean(this.microphoneStream);
  }

  async connect(voice = 'alloy') {
    this.disconnect();
    this.voice = voice;
    this.isConnected = true;
    this.onStatus('AI connected.');
  }

  updateContext() {}

  async speak(text) {
    if (!this.connected || !text) {return;}
    this.cancelResponse();
    this.pendingResponseCount = 1;
    this.onStatus('Thinking…');
    this.activeRequest = new AbortController();
    const restoreMicrophone = this.recording && !this.microphoneMuted;
    if (restoreMicrophone) {this.setMicrophoneMuted(true);}
    let failed = false;
    try {
      const response = await fetch('/api/voice', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'speech', text, voice: this.voice }),
        signal: this.activeRequest.signal,
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || 'Speech generation failed.');
      }
      const audioBlob = await response.blob();
      if (!this.connected) {return;}
      this.onTranscript(`RoboDeal: “${text}”`);
      this.onStatus('Speaking…');
      await this.playBlob(audioBlob);
    } catch (error) {
      failed = error.name !== 'AbortError';
      if (failed) {this.onStatus(`AI error: ${error.message}`);}
    } finally {
      this.activeRequest = null;
      this.pendingResponseCount = 0;
      if (restoreMicrophone && this.connected && this.recording) {this.setMicrophoneMuted(false);}
      if (this.connected && !failed) {this.onStatus(this.idleStatus());}
    }
  }

  async startMicrophone() {
    if (!this.connected) {throw new Error('The AI is not connected yet.');}
    if (this.recording) {return;}
    const supported = navigator.mediaDevices.getSupportedConstraints?.() || {};
    this.onStatus('Starting microphone…');
    try {
      this.microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: microphoneAudioConstraints(supported),
      });
      this.peerConnection = new RTCPeerConnection();
      this.dataChannel = this.peerConnection.createDataChannel('oai-events');
      this.dataChannel.addEventListener('message', (event) => this.handleRealtimeEvent(event));
      this.dataChannel.addEventListener('open', () => this.startClientVad());
      this.dataChannel.addEventListener('close', () => {
        if (this.connected && this.recording) {this.onStatus('Voice unavailable: transcription connection closed.');}
      });
      this.startClientVad();
      this.peerConnection.addEventListener?.('connectionstatechange', () => {
        if (this.peerConnection?.connectionState === 'failed') {
          this.onStatus('Voice unavailable: transcription connection failed.');
        }
      });
      const microphoneTrack = this.microphoneStream.getAudioTracks?.()[0]
        || this.microphoneStream.getTracks()[0];
      this.peerConnection.addTrack(microphoneTrack, this.microphoneStream);

      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      const tokenResponse = await fetch('/api/realtime-call', {
        method: 'POST',
      });
      const tokenData = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || !tokenData.value) {
        throw new Error(tokenData.error || 'Could not create a live transcription key.');
      }
      const connectionController = new AbortController();
      const connectionTimeout = setTimeout(() => connectionController.abort(), 12000);
      let response;
      try {
        response = await fetch('https://api.openai.com/v1/realtime/calls', {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${tokenData.value}`,
            'Content-Type': 'application/sdp',
          },
          body: offer.sdp,
          signal: connectionController.signal,
        });
      } catch (error) {
        if (error.name === 'AbortError') {
          throw new Error('OpenAI took too long to connect. Please try again.');
        }
        throw error;
      } finally {
        clearTimeout(connectionTimeout);
      }
      const answer = await response.text();
      if (!response.ok) {
        let message = 'The live transcription connection failed.';
        try {message = JSON.parse(answer).error?.message || JSON.parse(answer).error || message;} catch {}
        throw new Error(message);
      }
      await this.peerConnection.setRemoteDescription({ type: 'answer', sdp: answer });
      if (this.dataChannel.readyState === 'open') {this.startClientVad();}
      this.onStatus('Listening');
    } catch (error) {
      this.closeMicrophoneConnection();
      throw error;
    }
  }

  async stopMicrophone() {
    if (!this.recording) {return;}
    this.closeMicrophoneConnection();
    this.onStatus('Microphone off');
  }

  handleRealtimeEvent(messageEvent) {
    let event;
    try {event = JSON.parse(messageEvent.data);} catch {return;}

    if (event.type === 'input_audio_buffer.speech_started') {
      if (!this.microphoneMuted) {this.onStatus('Hearing speech…');}
      return;
    }
    if (event.type === 'input_audio_buffer.speech_stopped') {
      if (!this.microphoneMuted) {this.onStatus('Transcribing…');}
      return;
    }
    if (event.type === 'conversation.item.input_audio_transcription.delta') {
      const itemId = event.item_id || 'current';
      const transcript = `${this.transcriptDeltas.get(itemId) || ''}${event.delta || ''}`;
      this.transcriptDeltas.set(itemId, transcript);
      if (transcript.trim()) {this.onTranscript(`Hearing: “${transcript.trim()}”`);}
      return;
    }
    if (event.type === 'conversation.item.input_audio_transcription.completed') {
      const itemId = event.item_id || 'current';
      this.transcriptDeltas.delete(itemId);
      const transcript = String(event.transcript || '').trim();
      if (!transcript) {
        if (this.connected && this.recording) {this.onStatus(this.idleStatus());}
        return;
      }
      this.onTranscript(`Heard: “${transcript}”`);
      this.transcriptQueue = this.transcriptQueue
        .then(() => this.processLiveTranscript(transcript))
        .catch((error) => {
          this.onStatus(`AI error: ${error.message}`);
        });
      return;
    }
    if (event.type === 'error') {
      this.onStatus(`AI error: ${event.error?.message || 'Live transcription failed.'}`);
    }
  }

  async processLiveTranscript(transcript) {
    if (!this.connected || !this.recording) {return;}
    this.cancelResponse();
    this.processingTranscript = true;
    this.pendingResponseCount = 1;
    this.activeRequest = new AbortController();
    this.setMicrophoneMuted(true);
    let failed = false;
    try {
      await this.processText(transcript, this.activeRequest.signal);
    } catch (error) {
      failed = error.name !== 'AbortError';
      if (failed) {this.onStatus(`AI error: ${error.message}`);}
    } finally {
      this.activeRequest = null;
      this.pendingResponseCount = 0;
      this.processingTranscript = false;
      if (this.connected && this.recording) {
        this.setMicrophoneMuted(false);
        if (!failed) {this.onStatus('Listening');}
      }
    }
  }

  setMicrophoneMuted(muted) {
    this.microphoneMuted = muted;
    this.microphoneStream?.getTracks().forEach((track) => {track.enabled = !muted;});
  }

  startClientVad() {
    if (this.vadTimer || !this.microphoneStream) {return;}
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) {
      this.onStatus('Voice unavailable: this browser cannot detect when speech ends.');
      return;
    }
    this.vadAudioContext = new AudioContextClass();
    this.vadAudioContext.resume?.().catch(() => {});
    this.vadSource = this.vadAudioContext.createMediaStreamSource(this.microphoneStream);
    this.vadAnalyser = this.vadAudioContext.createAnalyser();
    this.vadAnalyser.fftSize = 1024;
    this.vadSamples = new Float32Array(this.vadAnalyser.fftSize);
    this.vadSource.connect(this.vadAnalyser);
    this.vadTimer = setInterval(() => this.sampleVoiceActivity(), 50);
  }

  sampleVoiceActivity(now = Date.now()) {
    if (!this.vadAnalyser || !this.vadSamples || this.microphoneMuted) {return;}
    this.vadAnalyser.getFloatTimeDomainData(this.vadSamples);
    const sumOfSquares = this.vadSamples.reduce((sum, sample) => sum + (sample * sample), 0);
    const volume = Math.sqrt(sumOfSquares / this.vadSamples.length);
    if (volume >= 0.018) {
      if (!this.vadSpeaking) {
        this.vadSpeaking = true;
        this.vadSpeechStartedAt = now;
        this.onStatus('Hearing speech…');
      }
      this.vadLastVoiceAt = now;
      return;
    }
    if (this.vadSpeaking && now - this.vadLastVoiceAt >= 700) {
      const speechDuration = this.vadLastVoiceAt - this.vadSpeechStartedAt;
      this.vadSpeaking = false;
      if (speechDuration >= 200) {this.commitDetectedSpeechTurn();}
    }
  }

  commitDetectedSpeechTurn() {
    if (this.dataChannel?.readyState !== 'open') {return;}
    this.onStatus('Transcribing…');
    this.dataChannel.send(JSON.stringify({ type: 'input_audio_buffer.commit' }));
  }

  closeMicrophoneConnection() {
    const microphoneStream = this.microphoneStream;
    const dataChannel = this.dataChannel;
    const peerConnection = this.peerConnection;
    this.microphoneStream = null;
    this.dataChannel = null;
    this.peerConnection = null;
    this.microphoneMuted = false;
    this.transcriptDeltas.clear();
    if (this.vadTimer) {clearInterval(this.vadTimer);}
    this.vadTimer = null;
    this.vadSpeaking = false;
    this.vadSpeechStartedAt = 0;
    this.vadLastVoiceAt = 0;
    this.vadSource?.disconnect();
    this.vadAudioContext?.close().catch(() => {});
    this.vadSource = null;
    this.vadAnalyser = null;
    this.vadSamples = null;
    this.vadAudioContext = null;
    microphoneStream?.getTracks().forEach((track) => track.stop());
    dataChannel?.close();
    peerConnection?.close();
  }

  async playAudioFile(file) {
    if (!this.connected) {throw new Error('The AI is not connected yet.');}
    if (!file) {throw new Error('Choose an audio file first.');}
    if (this.audioTestRunning) {throw new Error('An audio test is already running.');}
    this.audioTestRunning = true;
    try {
      await this.processAudio(file, file.name || 'audio');
    } finally {
      this.audioTestRunning = false;
    }
  }

  async processAudio(audio, fileName) {
    this.cancelResponse();
    this.pendingResponseCount = 1;
    this.activeRequest = new AbortController();
    const restoreMicrophone = this.recording && !this.microphoneMuted;
    if (restoreMicrophone) {this.setMicrophoneMuted(true);}
    let failed = false;
    try {
      this.onStatus('Transcribing…');
      const transcription = await apiJson({
        action: 'transcribe',
        audio: await blobToBase64(audio),
        mimeType: audio.type || 'audio/webm',
        fileName,
        prompt: this.prompts.transcription.prompt,
      }, this.activeRequest.signal);
      const transcript = String(transcription.text || '').trim();
      if (!transcript) {throw new Error('No speech was detected.');}
      this.onTranscript(`Heard: “${transcript}”`);
      await this.processText(transcript, this.activeRequest.signal);
    } catch (error) {
      failed = error.name !== 'AbortError';
      if (failed) {this.onStatus(`AI error: ${error.message}`);}
    } finally {
      this.activeRequest = null;
      this.pendingResponseCount = 0;
      if (restoreMicrophone && this.connected && this.recording) {this.setMicrophoneMuted(false);}
      if (this.connected && !failed) {this.onStatus(this.idleStatus());}
    }
  }

  async processText(transcript, signal) {
    this.onStatus('Thinking…');
    let response = await apiJson({
      action: 'respond',
      input: transcript,
      instructions: this.getInstructions(),
      tools: this.tools,
    }, signal);

    for (let turn = 0; turn < 4; turn += 1) {
      const functionCalls = (response.output || []).filter((item) => item.type === 'function_call');
      if (functionCalls.length === 0) {break;}
      const outputs = [];
      let shouldStaySilent = false;
      this.onStatus('Applying action…');
      for (const call of functionCalls) {
        let result;
        try {
          result = await this.executeTool(call.name, JSON.parse(call.arguments || '{}'));
        } catch (error) {
          result = { ok: false, message: error.message };
        }
        shouldStaySilent ||= Boolean(result.silent);
        outputs.push({
          type: 'function_call_output',
          call_id: call.call_id,
          output: JSON.stringify(result),
        });
      }
      if (shouldStaySilent) {return;}
      this.onStatus('Thinking…');
      response = await apiJson({
        action: 'respond',
        input: outputs,
        previousResponseId: response.id,
        instructions: this.getInstructions(),
        tools: this.tools,
      }, signal);
    }

    const text = responseText(response);
    if (text) {await this.speakWithoutCancelling(text, signal);}
  }

  async speakWithoutCancelling(text, signal) {
    const response = await fetch('/api/voice', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ action: 'speech', text, voice: this.voice }),
      signal,
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || 'Speech generation failed.');
    }
    this.onTranscript(`RoboDeal: “${text}”`);
    this.onStatus('Speaking…');
    await this.playBlob(await response.blob());
  }

  playBlob(blob) {
    if (this.audioUrl) {URL.revokeObjectURL(this.audioUrl);}
    this.audioUrl = URL.createObjectURL(blob);
    this.audio = new Audio(this.audioUrl);
    return new Promise((resolve, reject) => {
      this.audio.addEventListener('ended', resolve, { once: true });
      this.audio.addEventListener('error', () => reject(new Error('The generated speech could not play.')), { once: true });
      this.audio.play().catch(reject);
    });
  }

  cancelResponse() {
    this.activeRequest?.abort();
    this.activeRequest = null;
    this.audio?.pause();
    this.audio = null;
    if (this.audioUrl) {URL.revokeObjectURL(this.audioUrl);}
    this.audioUrl = null;
    this.pendingResponseCount = 0;
  }

  disconnect() {
    this.cancelResponse();
    this.closeMicrophoneConnection();
    this.isConnected = false;
  }

  send(event) {
    if (event?.type === 'response.cancel' || event?.type === 'output_audio_buffer.clear') {
      this.cancelResponse();
    }
  }

  idleStatus() {
    return this.recording ? 'Listening' : 'Microphone off';
  }
}
