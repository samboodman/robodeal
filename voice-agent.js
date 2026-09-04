import {
  matchVoiceCommand,
  matchVoiceCommandViaApi,
} from "./voice-command-matcher.js";

export function fillPrompt(template, values) {
  return template.replace(/\{\{([A-Z_]+)\}\}/g, (placeholder, key) =>
    Object.hasOwn(values, key) ? String(values[key]) : placeholder,
  );
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
  let binary = "";
  const blockSize = 0x8000;
  for (let offset = 0; offset < bytes.length; offset += blockSize) {
    binary += String.fromCharCode(
      ...bytes.subarray(offset, offset + blockSize),
    );
  }
  return btoa(binary);
}

async function blobToBase64(blob) {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

function responseText(response) {
  if (response.output_text) {
    return response.output_text.trim();
  }
  return (response.output || [])
    .flatMap((item) => item.content || [])
    .filter((content) => content.type === "output_text")
    .map((content) => content.text)
    .join("\n")
    .trim();
}

function comparableTranscript(transcript) {
  return String(transcript || "")
    .toLowerCase()
    .replace(/[^a-z0-9$\s]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function preciseNow() {
  return globalThis.performance?.now?.() ?? Date.now();
}

const silentAudioUrl =
  "data:audio/wav;base64,UklGRigAAABXQVZFZm10IBAAAAABAAEAQB8AAEAfAAABAAgAZGF0YQQAAACAgICA";
const pcmSampleRate = 24_000;
const completeCommandSilenceMs = 220;
const fallbackSilenceMs = 650;

function pcmWavBlob(pcmBytes) {
  const header = new ArrayBuffer(44);
  const view = new DataView(header);
  const writeText = (offset, text) =>
    [...text].forEach((character, index) => {
      view.setUint8(offset + index, character.charCodeAt(0));
    });
  writeText(0, "RIFF");
  view.setUint32(4, 36 + pcmBytes.byteLength, true);
  writeText(8, "WAVE");
  writeText(12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 1, true);
  view.setUint32(24, pcmSampleRate, true);
  view.setUint32(28, pcmSampleRate * 2, true);
  view.setUint16(32, 2, true);
  view.setUint16(34, 16, true);
  writeText(36, "data");
  view.setUint32(40, pcmBytes.byteLength, true);
  return new Blob([header, pcmBytes], { type: "audio/wav" });
}

async function apiJson(body, signal) {
  const response = await fetch("/api/voice", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(result.error || "The voice service failed.");
  }
  return result;
}

export class VoiceAgent {
  constructor({
    getInstructions,
    prompts,
    tools = [],
    executeTool,
    onTranscript = () => {},
    onStatus = () => {},
    onLatency = () => {},
  }) {
    this.getInstructions = getInstructions;
    this.prompts = prompts;
    this.tools = tools;
    this.executeTool = executeTool;
    this.onTranscript = onTranscript;
    this.onStatus = onStatus;
    this.onLatency = onLatency;
    this.voice = "alloy";
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
    this.latestDeltaItemId = null;
    this.microphoneMuted = false;
    this.transcriptDeltas = new Map();
    this.preparedTranscriptCommands = new Map();
    this.processedUtteranceIds = new Set();
    this.currentSpeechTiming = null;
    this.lastLatency = null;
    this.transcriptQueue = Promise.resolve();
    this.processingTranscript = false;
    this.audio = null;
    this.audioUrl = null;
    this.audioUnlocked = false;
    this.outputAudioContext = null;
    this.outputAudioSources = new Set();
    this.nextAudioStartAt = 0;
    this.audioGeneration = 0;
    this.backgroundSpeech = null;
    this.backgroundSpeechController = null;
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

  async connect(voice = "alloy") {
    this.disconnect();
    this.voice = voice;
    this.isConnected = true;
    this.onStatus("AI connected.");
  }

  updateContext() {}

  unlockAudioPlayback() {
    if (typeof Audio === "undefined" || this.audioUnlocked) {
      return;
    }
    this.audio ||= new Audio();
    this.audioUnlocked = true;
    this.audio.src = silentAudioUrl;
    Promise.resolve(this.audio.play()).catch(() => {
      this.audioUnlocked = false;
    });
    const AudioContextClass =
      globalThis.AudioContext || globalThis.webkitAudioContext;
    if (AudioContextClass && !this.outputAudioContext) {
      this.outputAudioContext = new AudioContextClass({
        sampleRate: pcmSampleRate,
      });
      this.outputAudioContext.resume?.().catch(() => {});
    }
  }

  async speak(text) {
    if (!this.connected || !text) {
      return;
    }
    this.cancelResponse();
    this.pendingResponseCount = 1;
    this.onStatus("Thinking…");
    this.activeRequest = new AbortController();
    const restoreMicrophone = this.recording && !this.microphoneMuted;
    if (restoreMicrophone) {
      this.setMicrophoneMuted(true);
    }
    let failed = false;
    try {
      const response = await fetch("/api/voice", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "speech", text, voice: this.voice }),
        signal: this.activeRequest.signal,
      });
      if (!response.ok) {
        const result = await response.json().catch(() => ({}));
        throw new Error(result.error || "Speech generation failed.");
      }
      if (!this.connected) {
        return;
      }
      this.onTranscript(`RoboDeal: “${text}”`);
      this.onStatus("Speaking…");
      await this.playPcmResponse(response);
    } catch (error) {
      failed = error.name !== "AbortError";
      if (failed) {
        this.onStatus(`AI error: ${error.message}`);
      }
    } finally {
      this.activeRequest = null;
      this.pendingResponseCount = 0;
      if (restoreMicrophone && this.connected && this.recording) {
        this.setMicrophoneMuted(false);
      }
      if (this.connected && !failed && !this.backgroundSpeech) {
        this.onStatus(this.idleStatus());
      }
    }
  }

  async startMicrophone() {
    if (!this.connected) {
      throw new Error("The AI is not connected yet.");
    }
    if (this.recording) {
      return;
    }
    const supported = navigator.mediaDevices.getSupportedConstraints?.() || {};
    this.onStatus("Starting microphone…");
    try {
      this.microphoneStream = await navigator.mediaDevices.getUserMedia({
        audio: microphoneAudioConstraints(supported),
      });
      this.peerConnection = new RTCPeerConnection();
      this.dataChannel = this.peerConnection.createDataChannel("oai-events");
      this.dataChannel.addEventListener("message", (event) =>
        this.handleRealtimeEvent(event),
      );
      this.dataChannel.addEventListener("open", () => this.startClientVad());
      this.dataChannel.addEventListener("close", () => {
        if (this.connected && this.recording) {
          this.onStatus("Voice unavailable: transcription connection closed.");
        }
      });
      this.peerConnection.addEventListener?.("connectionstatechange", () => {
        if (this.peerConnection?.connectionState === "failed") {
          this.onStatus("Voice unavailable: transcription connection failed.");
        }
      });
      const microphoneTrack =
        this.microphoneStream.getAudioTracks?.()[0] ||
        this.microphoneStream.getTracks()[0];
      this.peerConnection.addTrack(microphoneTrack, this.microphoneStream);

      const offer = await this.peerConnection.createOffer();
      await this.peerConnection.setLocalDescription(offer);
      const tokenResponse = await fetch("/api/realtime-call", {
        method: "POST",
      });
      const tokenData = await tokenResponse.json().catch(() => ({}));
      if (!tokenResponse.ok || !tokenData.value) {
        throw new Error(
          tokenData.error || "Could not create a live transcription key.",
        );
      }
      const connectionController = new AbortController();
      const connectionTimeout = setTimeout(
        () => connectionController.abort(),
        12000,
      );
      let response;
      try {
        response = await fetch("https://api.openai.com/v1/realtime/calls", {
          method: "POST",
          headers: {
            Authorization: `Bearer ${tokenData.value}`,
            "Content-Type": "application/sdp",
          },
          body: offer.sdp,
          signal: connectionController.signal,
        });
      } catch (error) {
        if (error.name === "AbortError") {
          throw new Error("OpenAI took too long to connect. Please try again.");
        }
        throw error;
      } finally {
        clearTimeout(connectionTimeout);
      }
      const answer = await response.text();
      if (!response.ok) {
        let message = "The live transcription connection failed.";
        try {
          message =
            JSON.parse(answer).error?.message ||
            JSON.parse(answer).error ||
            message;
        } catch {}
        throw new Error(message);
      }
      await this.peerConnection.setRemoteDescription({
        type: "answer",
        sdp: answer,
      });
      if (this.dataChannel.readyState === "open") {
        this.startClientVad();
      }
      this.onStatus("Listening");
    } catch (error) {
      this.closeMicrophoneConnection();
      throw error;
    }
  }

  async stopMicrophone() {
    if (!this.recording) {
      return;
    }
    this.closeMicrophoneConnection();
    this.onStatus("Microphone off");
  }

  handleRealtimeEvent(messageEvent) {
    let event;
    try {
      event = JSON.parse(messageEvent.data);
    } catch {
      return;
    }

    if (event.type === "input_audio_buffer.speech_started") {
      if (!this.microphoneMuted) {
        this.currentSpeechTiming = {
          utteranceId: event.item_id || null,
          speechStartedAt: preciseNow(),
        };
        this.onStatus("Hearing speech…");
      }
      return;
    }
    if (event.type === "input_audio_buffer.speech_stopped") {
      if (!this.microphoneMuted) {
        this.currentSpeechTiming ||= { utteranceId: event.item_id || null };
        this.currentSpeechTiming.speechStoppedAt = preciseNow();
        this.onStatus("Transcribing…");
      }
      return;
    }
    if (event.type === "conversation.item.input_audio_transcription.delta") {
      const itemId = event.item_id || "current";
      this.latestDeltaItemId = itemId;
      const transcript = `${this.transcriptDeltas.get(itemId) || ""}${event.delta || ""}`;
      this.transcriptDeltas.set(itemId, transcript);
      if (transcript.trim()) {
        this.onTranscript(`Hearing: “${transcript.trim()}”`);
        this.prepareTranscriptCommand(itemId, transcript);
      }
      return;
    }
    if (
      event.type === "conversation.item.input_audio_transcription.completed"
    ) {
      const itemId = event.item_id || "current";
      if (this.latestDeltaItemId === itemId) {
        this.latestDeltaItemId = null;
      }
      this.transcriptDeltas.delete(itemId);
      const transcript = String(event.transcript || "").trim();
      const prepared = this.preparedTranscriptCommands.get(itemId);
      this.preparedTranscriptCommands.delete(itemId);
      if (!transcript) {
        if (this.connected && this.recording) {
          this.onStatus(this.idleStatus());
        }
        return;
      }
      const utteranceId = event.item_id || event.event_id || null;
      if (utteranceId && this.processedUtteranceIds.has(utteranceId)) {
        return;
      }
      if (utteranceId) {
        this.processedUtteranceIds.add(utteranceId);
        if (this.processedUtteranceIds.size > 100) {
          this.processedUtteranceIds.delete(
            this.processedUtteranceIds.values().next().value,
          );
        }
      }
      const timing = this.currentSpeechTiming || { utteranceId };
      timing.utteranceId ||= utteranceId;
      timing.transcriptionCompletedAt = preciseNow();
      this.currentSpeechTiming = null;
      this.onTranscript(`Heard: “${transcript}”`);
      const preparedCommand =
        prepared?.transcript === comparableTranscript(transcript)
          ? prepared.command
          : null;
      this.transcriptQueue = this.transcriptQueue
        .then(() =>
          this.processLiveTranscript(transcript, preparedCommand, timing),
        )
        .catch((error) => {
          this.onStatus(`AI error: ${error.message}`);
        });
      return;
    }
    if (event.type === "error") {
      this.onStatus(
        `AI error: ${event.error?.message || "Live transcription failed."}`,
      );
    }
  }

  prepareTranscriptCommand(itemId, transcript) {
    const comparable = comparableTranscript(transcript);
    if (
      !comparable ||
      this.preparedTranscriptCommands.get(itemId)?.transcript === comparable
    ) {
      return;
    }
    const localCommand = matchVoiceCommand(transcript);
    if (!localCommand) {
      this.preparedTranscriptCommands.delete(itemId);
      return;
    }
    const command = ["raise", "bet"].includes(localCommand.name)
      ? matchVoiceCommandViaApi(transcript)
      : Promise.resolve(localCommand);
    this.preparedTranscriptCommands.set(itemId, {
      transcript: comparable,
      command,
    });
  }

  async processLiveTranscript(
    transcript,
    preparedCommand = null,
    timing = null,
  ) {
    if (!this.connected || !this.recording) {
      return;
    }
    this.cancelResponse();
    this.processingTranscript = true;
    this.pendingResponseCount = 1;
    this.activeRequest = new AbortController();
    this.setMicrophoneMuted(true);
    let failed = false;
    try {
      await this.processText(
        transcript,
        this.activeRequest.signal,
        preparedCommand && (await preparedCommand),
        timing,
      );
    } catch (error) {
      failed = error.name !== "AbortError";
      if (failed) {
        this.onStatus(`AI error: ${error.message}`);
      }
      this.finishLatency(timing);
    } finally {
      this.activeRequest = null;
      this.pendingResponseCount = 0;
      this.processingTranscript = false;
      if (this.connected && this.recording) {
        if (!this.backgroundSpeech) {
          this.setMicrophoneMuted(false);
        }
        if (!failed && !this.backgroundSpeech) {
          this.onStatus("Listening");
        }
      }
    }
  }

  setMicrophoneMuted(muted) {
    this.microphoneMuted = muted;
    this.microphoneStream?.getTracks().forEach((track) => {
      track.enabled = !muted;
    });
  }

  startClientVad() {
    if (this.vadTimer || !this.microphoneStream) {
      return;
    }
    const AudioContextClass =
      globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) {
      this.onStatus(
        "Voice unavailable: this browser cannot detect when speech ends.",
      );
      return;
    }
    this.vadAudioContext = new AudioContextClass();
    this.vadAudioContext.resume?.().catch(() => {});
    this.vadSource = this.vadAudioContext.createMediaStreamSource(
      this.microphoneStream,
    );
    this.vadAnalyser = this.vadAudioContext.createAnalyser();
    this.vadAnalyser.fftSize = 1024;
    this.vadSamples = new Float32Array(this.vadAnalyser.fftSize);
    this.vadSource.connect(this.vadAnalyser);
    this.vadTimer = setInterval(() => this.sampleVoiceActivity(), 50);
  }

  sampleVoiceActivity(now = Date.now()) {
    if (!this.vadAnalyser || !this.vadSamples || this.microphoneMuted) {
      return;
    }
    this.vadAnalyser.getFloatTimeDomainData(this.vadSamples);
    const sumOfSquares = this.vadSamples.reduce(
      (sum, sample) => sum + sample * sample,
      0,
    );
    const volume = Math.sqrt(sumOfSquares / this.vadSamples.length);
    if (volume >= 0.018) {
      if (!this.vadSpeaking) {
        this.vadSpeaking = true;
        this.vadSpeechStartedAt = now;
        this.currentSpeechTiming = {
          utteranceId: this.latestDeltaItemId,
          speechStartedAt: preciseNow(),
        };
        this.onStatus("Hearing speech…");
      }
      this.vadLastVoiceAt = now;
      return;
    }
    if (!this.vadSpeaking) {
      return;
    }
    const hasCompleteCommand =
      this.latestDeltaItemId &&
      this.preparedTranscriptCommands.has(this.latestDeltaItemId);
    const silenceMs = hasCompleteCommand
      ? completeCommandSilenceMs
      : fallbackSilenceMs;
    if (now - this.vadLastVoiceAt < silenceMs) {
      return;
    }
    const speechDuration = this.vadLastVoiceAt - this.vadSpeechStartedAt;
    this.vadSpeaking = false;
    if (speechDuration >= 150) {
      this.commitDetectedSpeechTurn();
    }
  }

  commitDetectedSpeechTurn() {
    if (this.dataChannel?.readyState !== "open") {
      return;
    }
    this.currentSpeechTiming ||= { utteranceId: this.latestDeltaItemId };
    this.currentSpeechTiming.speechStoppedAt = preciseNow();
    this.onStatus("Transcribing…");
    this.dataChannel.send(
      JSON.stringify({ type: "input_audio_buffer.commit" }),
    );
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
    this.preparedTranscriptCommands.clear();
    this.processedUtteranceIds.clear();
    this.currentSpeechTiming = null;
    this.latestDeltaItemId = null;
    if (this.vadTimer) {
      clearInterval(this.vadTimer);
    }
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
    if (!this.connected) {
      throw new Error("The AI is not connected yet.");
    }
    if (!file) {
      throw new Error("Choose an audio file first.");
    }
    if (this.audioTestRunning) {
      throw new Error("An audio test is already running.");
    }
    this.audioTestRunning = true;
    try {
      await this.processAudio(file, file.name || "audio");
    } finally {
      this.audioTestRunning = false;
    }
  }

  async processAudio(audio, fileName) {
    this.cancelResponse();
    this.pendingResponseCount = 1;
    this.activeRequest = new AbortController();
    const restoreMicrophone = this.recording && !this.microphoneMuted;
    if (restoreMicrophone) {
      this.setMicrophoneMuted(true);
    }
    let failed = false;
    const timing = {
      utteranceId: fileName,
      inputSubmittedAt: preciseNow(),
    };
    try {
      this.onStatus("Transcribing…");
      const transcription = await apiJson(
        {
          action: "transcribe",
          audio: await blobToBase64(audio),
          mimeType: audio.type || "audio/webm",
          fileName,
          prompt: this.prompts.transcription.prompt,
        },
        this.activeRequest.signal,
      );
      const transcript = String(transcription.text || "").trim();
      if (!transcript) {
        throw new Error("No speech was detected.");
      }
      timing.transcriptionCompletedAt = preciseNow();
      this.onTranscript(`Heard: “${transcript}”`);
      await this.processText(
        transcript,
        this.activeRequest.signal,
        null,
        timing,
      );
    } catch (error) {
      failed = error.name !== "AbortError";
      if (failed) {
        this.onStatus(`AI error: ${error.message}`);
      }
      this.finishLatency(timing);
    } finally {
      this.activeRequest = null;
      this.pendingResponseCount = 0;
      if (
        restoreMicrophone &&
        this.connected &&
        this.recording &&
        !this.backgroundSpeech
      ) {
        this.setMicrophoneMuted(false);
      }
      if (this.connected && !failed && !this.backgroundSpeech) {
        this.onStatus(this.idleStatus());
      }
    }
  }

  async processText(transcript, signal, preparedCommand = null, timing = null) {
    const directCommand =
      preparedCommand || (await matchVoiceCommandViaApi(transcript));
    if (directCommand && typeof this.executeTool === "function") {
      this.onStatus("Applying action…");
      let result;
      try {
        result = await this.executeTool(directCommand.name, directCommand.args);
      } catch (error) {
        result = { ok: false, message: error.message };
      }
      if (timing) {
        timing.actionAppliedAt = preciseNow();
      }
      if (result?.silent) {
        this.finishLatency(timing);
        return;
      }
      const message = String(result?.message || "").trim();
      if (message) {
        this.startBackgroundAcknowledgement(message, timing);
      } else {
        this.finishLatency(timing);
      }
      return;
    }

    this.onStatus("Thinking…");
    let response = await apiJson(
      {
        action: "respond",
        input: transcript,
        instructions: this.getInstructions(),
        tools: this.tools,
      },
      signal,
    );

    for (let turn = 0; turn < 4; turn += 1) {
      const functionCalls = (response.output || []).filter(
        (item) => item.type === "function_call",
      );
      if (functionCalls.length === 0) {
        break;
      }
      const outputs = [];
      let shouldStaySilent = false;
      this.onStatus("Applying action…");
      for (const call of functionCalls) {
        let result;
        try {
          result = await this.executeTool(
            call.name,
            JSON.parse(call.arguments || "{}"),
          );
        } catch (error) {
          result = { ok: false, message: error.message };
        }
        if (timing && !timing.actionAppliedAt) {
          timing.actionAppliedAt = preciseNow();
        }
        shouldStaySilent ||= Boolean(result.silent);
        outputs.push({
          type: "function_call_output",
          call_id: call.call_id,
          output: JSON.stringify(result),
        });
      }
      if (shouldStaySilent) {
        this.finishLatency(timing);
        return;
      }
      this.onStatus("Thinking…");
      response = await apiJson(
        {
          action: "respond",
          input: outputs,
          previousResponseId: response.id,
          instructions: this.getInstructions(),
          tools: this.tools,
        },
        signal,
      );
    }

    const text = responseText(response);
    if (text) {
      await this.speakWithoutCancelling(text, signal, timing);
    }
    this.finishLatency(timing);
  }

  startBackgroundAcknowledgement(text, timing) {
    this.backgroundSpeechController?.abort();
    const controller = new AbortController();
    this.backgroundSpeechController = controller;
    const speech = this.speakWithoutCancelling(text, controller.signal, timing)
      .catch((error) => {
        if (error.name !== "AbortError") {
          this.onStatus(`AI error: ${error.message}`);
        }
      })
      .finally(() => {
        this.finishLatency(timing);
        if (this.backgroundSpeech === speech) {
          this.backgroundSpeech = null;
          this.backgroundSpeechController = null;
          if (this.connected && this.recording) {
            this.setMicrophoneMuted(false);
          }
          if (this.connected) {
            this.onStatus(this.idleStatus());
          }
        }
      });
    this.backgroundSpeech = speech;
  }

  finishLatency(timing) {
    if (!timing || timing.reported) {
      return;
    }
    timing.reported = true;
    timing.completedAt = preciseNow();
    const startedAt =
      timing.speechStartedAt ??
      timing.inputSubmittedAt ??
      timing.transcriptionCompletedAt;
    const report = Object.freeze({
      ...timing,
      ...(startedAt === undefined
        ? {}
        : { totalMs: timing.completedAt - startedAt }),
      ...(timing.speechStoppedAt === undefined ||
      timing.transcriptionCompletedAt === undefined
        ? {}
        : {
            transcriptionMs:
              timing.transcriptionCompletedAt - timing.speechStoppedAt,
          }),
      ...(timing.transcriptionCompletedAt === undefined ||
      timing.actionAppliedAt === undefined
        ? {}
        : {
            commandMs: timing.actionAppliedAt - timing.transcriptionCompletedAt,
          }),
      ...(timing.ttsRequestedAt === undefined ||
      timing.ttsFirstAudioAt === undefined
        ? {}
        : { ttsFirstAudioMs: timing.ttsFirstAudioAt - timing.ttsRequestedAt }),
    });
    this.lastLatency = report;
    this.onLatency(report);
  }

  async speakWithoutCancelling(text, signal, timing = null) {
    if (timing) {
      timing.ttsRequestedAt = preciseNow();
    }
    const response = await fetch("/api/voice", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "speech", text, voice: this.voice }),
      signal,
    });
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || "Speech generation failed.");
    }
    this.onTranscript(`RoboDeal: “${text}”`);
    this.onStatus("Speaking…");
    await this.playPcmResponse(response, timing);
  }

  async playPcmResponse(response, timing = null) {
    const AudioContextClass =
      globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass || !response.body?.getReader) {
      const pcmBytes = new Uint8Array(await response.arrayBuffer());
      if (timing && !timing.ttsFirstAudioAt && pcmBytes.byteLength) {
        timing.ttsFirstAudioAt = preciseNow();
      }
      await this.playBlob(pcmWavBlob(pcmBytes));
      if (timing) {
        timing.ttsPlaybackCompletedAt = preciseNow();
      }
      return;
    }

    this.outputAudioContext ||= new AudioContextClass({
      sampleRate: pcmSampleRate,
    });
    await this.outputAudioContext.resume?.();
    const context = this.outputAudioContext;
    const generation = this.audioGeneration;
    const reader = response.body.getReader();
    let leftover = new Uint8Array(0);
    let finalPlayback = Promise.resolve();

    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        if (generation !== this.audioGeneration) {
          await reader.cancel().catch(() => {});
          return;
        }
        if (!value?.byteLength) {
          continue;
        }
        if (timing && !timing.ttsFirstAudioAt) {
          timing.ttsFirstAudioAt = preciseNow();
        }

        const combined = new Uint8Array(leftover.byteLength + value.byteLength);
        combined.set(leftover);
        combined.set(value, leftover.byteLength);
        const playableLength = combined.byteLength - (combined.byteLength % 2);
        leftover = combined.slice(playableLength);
        if (!playableLength) {
          continue;
        }

        const sampleCount = playableLength / 2;
        const samples = new Float32Array(sampleCount);
        const sampleView = new DataView(
          combined.buffer,
          combined.byteOffset,
          playableLength,
        );
        for (let index = 0; index < sampleCount; index += 1) {
          samples[index] = sampleView.getInt16(index * 2, true) / 32768;
        }
        const buffer = context.createBuffer(1, sampleCount, pcmSampleRate);
        buffer.copyToChannel(samples, 0);
        const source = context.createBufferSource();
        source.buffer = buffer;
        source.connect(context.destination);
        const startAt = Math.max(
          context.currentTime + 0.02,
          this.nextAudioStartAt,
        );
        this.nextAudioStartAt = startAt + buffer.duration;
        this.outputAudioSources.add(source);
        finalPlayback = new Promise((resolve) => {
          source.onended = () => {
            this.outputAudioSources.delete(source);
            resolve();
          };
        });
        source.start(startAt);
      }
      await finalPlayback;
      if (timing) {
        timing.ttsPlaybackCompletedAt = preciseNow();
      }
    } finally {
      reader.releaseLock?.();
      if (
        generation === this.audioGeneration &&
        this.outputAudioSources.size === 0
      ) {
        this.nextAudioStartAt = 0;
      }
    }
  }

  playBlob(blob) {
    if (this.audioUrl) {
      URL.revokeObjectURL(this.audioUrl);
    }
    this.audioUrl = URL.createObjectURL(blob);
    this.audio ||= new Audio();
    this.audio.src = this.audioUrl;
    return new Promise((resolve, reject) => {
      this.audio.addEventListener("ended", resolve, { once: true });
      this.audio.addEventListener(
        "error",
        () => reject(new Error("The generated speech could not play.")),
        { once: true },
      );
      this.audio.play().catch(reject);
    });
  }

  cancelResponse() {
    this.activeRequest?.abort();
    this.activeRequest = null;
    this.backgroundSpeechController?.abort();
    this.backgroundSpeechController = null;
    this.backgroundSpeech = null;
    this.audioGeneration += 1;
    for (const source of this.outputAudioSources) {
      try {
        source.stop();
      } catch {}
    }
    this.outputAudioSources.clear();
    this.nextAudioStartAt = 0;
    this.audio?.pause();
    if (this.audioUrl) {
      URL.revokeObjectURL(this.audioUrl);
    }
    this.audioUrl = null;
    this.pendingResponseCount = 0;
  }

  disconnect() {
    this.cancelResponse();
    this.closeMicrophoneConnection();
    this.isConnected = false;
  }

  send(event) {
    if (
      event?.type === "response.cancel" ||
      event?.type === "output_audio_buffer.clear"
    ) {
      this.cancelResponse();
    }
  }

  idleStatus() {
    return this.recording ? "Listening" : "Microphone off";
  }
}
