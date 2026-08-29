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
    this.mediaRecorder = null;
    this.recordedChunks = [];
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
    return this.mediaRecorder?.state === 'recording';
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
      if (error.name !== 'AbortError') {this.onStatus(`AI error: ${error.message}`);}
    } finally {
      this.activeRequest = null;
      this.pendingResponseCount = 0;
      if (this.connected) {this.onStatus(this.idleStatus());}
    }
  }

  async startMicrophone() {
    if (!this.connected) {throw new Error('The AI is not connected yet.');}
    if (this.recording) {return;}
    const supported = navigator.mediaDevices.getSupportedConstraints?.() || {};
    this.onStatus('Starting microphone…');
    this.microphoneStream = await navigator.mediaDevices.getUserMedia({
      audio: microphoneAudioConstraints(supported),
    });
    this.recordedChunks = [];
    this.mediaRecorder = new MediaRecorder(this.microphoneStream);
    this.mediaRecorder.addEventListener('dataavailable', (event) => {
      if (event.data.size > 0) {this.recordedChunks.push(event.data);}
    });
    this.mediaRecorder.start();
    this.onStatus('Listening');
  }

  async stopMicrophone() {
    if (!this.mediaRecorder || this.mediaRecorder.state === 'inactive') {return;}
    const recorder = this.mediaRecorder;
    const completed = new Promise((resolve) => recorder.addEventListener('stop', resolve, { once: true }));
    recorder.stop();
    await completed;
    this.microphoneStream?.getTracks().forEach((track) => track.stop());
    this.microphoneStream = null;
    this.mediaRecorder = null;
    const audio = new Blob(this.recordedChunks, { type: recorder.mimeType || 'audio/webm' });
    this.recordedChunks = [];
    if (audio.size > 0) {await this.processAudio(audio, 'microphone.webm');}
    else {this.onStatus('Microphone off');}
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
      if (error.name !== 'AbortError') {this.onStatus(`AI error: ${error.message}`);}
    } finally {
      this.activeRequest = null;
      this.pendingResponseCount = 0;
      if (this.connected) {this.onStatus(this.idleStatus());}
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
    if (this.mediaRecorder?.state === 'recording') {this.mediaRecorder.stop();}
    this.microphoneStream?.getTracks().forEach((track) => track.stop());
    this.microphoneStream = null;
    this.mediaRecorder = null;
    this.recordedChunks = [];
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
