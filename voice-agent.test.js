import assert from 'node:assert/strict';
import test from 'node:test';
import { fillPrompt, microphoneAudioConstraints, VoiceAgent } from './voice-agent.js';
import { handleVoiceApi } from './voice-api-handler.js';
import { createRealtimeTranscriptionClientSecret } from './realtime-transcription.js';

const prompts = {
  transcription: { prompt: 'Poker commands at a noisy table.' },
};

function jsonResponse(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function audioResponse(bytes = new Uint8Array([1, 2, 3, 4])) {
  return new Response(bytes, {
    status: 200,
    headers: { 'Content-Type': 'audio/mpeg' },
  });
}

function installAudioPlayer() {
  const played = [];
  const originalAudio = globalThis.Audio;
  globalThis.Audio = class FakeAudio {
    constructor(url) {
      this.url = url;
      this.listeners = new Map();
      played.push(this);
    }

    addEventListener(type, listener) {
      this.listeners.set(type, listener);
    }

    async play() {
      queueMicrotask(() => this.listeners.get('ended')?.());
    }

    pause() {
      this.paused = true;
    }
  };
  return {
    played,
    restore() {
      globalThis.Audio = originalAudio;
    },
  };
}

function installRealtimeMicrophone() {
  const originalNavigatorDescriptor = Object.getOwnPropertyDescriptor(globalThis, 'navigator');
  const originalPeerConnection = globalThis.RTCPeerConnection;
  const track = {
    enabled: true,
    stopped: false,
    stop() {this.stopped = true;},
  };
  const stream = {
    getAudioTracks: () => [track],
    getTracks: () => [track],
  };

  class FakeDataChannel {
    constructor() {
      this.listeners = new Map();
      this.closed = false;
      this.readyState = 'open';
      this.sent = [];
    }

    addEventListener(type, listener) {
      const listeners = this.listeners.get(type) || [];
      listeners.push(listener);
      this.listeners.set(type, listeners);
    }

    emit(type, value = {}) {
      for (const listener of this.listeners.get(type) || []) {listener(value);}
    }

    close() {
      this.closed = true;
      this.readyState = 'closed';
      this.emit('close');
    }

    send(message) {this.sent.push(message);}
  }

  class FakePeerConnection {
    constructor() {
      this.dataChannel = new FakeDataChannel();
      this.connectionState = 'connected';
      this.closed = false;
      this.listeners = new Map();
      FakePeerConnection.instances.push(this);
    }

    createDataChannel() {return this.dataChannel;}

    addEventListener(type, listener) {this.listeners.set(type, listener);}

    addTrack(addedTrack, addedStream) {
      this.addedTrack = addedTrack;
      this.addedStream = addedStream;
    }

    async createOffer() {return { type: 'offer', sdp: 'microphone-offer' };}

    async setLocalDescription(description) {this.localDescription = description;}

    async setRemoteDescription(description) {this.remoteDescription = description;}

    close() {this.closed = true;}
  }
  FakePeerConnection.instances = [];

  Object.defineProperty(globalThis, 'navigator', {
    configurable: true,
    value: {
      mediaDevices: {
        getSupportedConstraints: () => ({ voiceIsolation: true }),
        getUserMedia: async () => stream,
      },
    },
  });
  globalThis.RTCPeerConnection = FakePeerConnection;

  return {
    stream,
    track,
    peers: FakePeerConnection.instances,
    restore() {
      if (originalNavigatorDescriptor) {
        Object.defineProperty(globalThis, 'navigator', originalNavigatorDescriptor);
      } else {
        delete globalThis.navigator;
      }
      globalThis.RTCPeerConnection = originalPeerConnection;
    },
  };
}

function makeAgent(options = {}) {
  return new VoiceAgent({
    getInstructions: () => 'Current poker state.',
    prompts,
    ...options,
  });
}

test('fills dynamic values into voice instructions', () => {
  assert.equal(
    fillPrompt('Player {{PLAYER}} owes {{AMOUNT}}.', { PLAYER: 'Sam', AMOUNT: 5 }),
    'Player Sam owes 5.',
  );
});

test('microphone constraints request supported voice isolation', () => {
  assert.deepEqual(microphoneAudioConstraints({ voiceIsolation: true }), {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
    voiceIsolation: true,
  });
  assert.equal('voiceIsolation' in microphoneAudioConstraints(), false);
});

test('connect selects a TTS voice without opening a Realtime connection', async () => {
  const statuses = [];
  const agent = makeAgent({ onStatus: (status) => statuses.push(status) });

  await agent.connect('coral');

  assert.equal(agent.connected, true);
  assert.equal(agent.voice, 'coral');
  assert.deepEqual(statuses, ['AI connected.']);
});

test('microphone continuously streams, acknowledges speech, and processes VAD turns', async () => {
  const originalFetch = globalThis.fetch;
  const microphone = installRealtimeMicrophone();
  const requestBodies = [];
  const statuses = [];
  const transcripts = [];
  const toolCalls = [];
  globalThis.fetch = async (url, options) => {
    requestBodies.push({ url, options });
    if (url === '/api/realtime-call') {
      return jsonResponse({ value: 'temporary-key' });
    }
    if (url === 'https://api.openai.com/v1/realtime/calls') {
      return new Response('microphone-answer', { status: 200, headers: { 'Content-Type': 'application/sdp' } });
    }
    return jsonResponse({
      id: 'response-1',
      output: [{ type: 'function_call', name: 'call', arguments: '{}', call_id: 'call-1' }],
    });
  };
  const agent = makeAgent({
    executeTool: async (name, args) => {
      toolCalls.push({ name, args });
      return { ok: true, silent: true };
    },
    onStatus: (status) => statuses.push(status),
    onTranscript: (transcript) => transcripts.push(transcript),
  });
  await agent.connect('coral');

  try {
    await agent.startMicrophone();
    const dataChannel = microphone.peers[0].dataChannel;
    dataChannel.emit('message', { data: JSON.stringify({ type: 'input_audio_buffer.speech_started' }) });
    dataChannel.emit('message', { data: JSON.stringify({
      type: 'conversation.item.input_audio_transcription.delta',
      item_id: 'turn-1',
      delta: 'I ',
    }) });
    dataChannel.emit('message', { data: JSON.stringify({
      type: 'conversation.item.input_audio_transcription.delta',
      item_id: 'turn-1',
      delta: 'call.',
    }) });
    dataChannel.emit('message', { data: JSON.stringify({ type: 'input_audio_buffer.speech_stopped' }) });
    dataChannel.emit('message', { data: JSON.stringify({
      type: 'conversation.item.input_audio_transcription.completed',
      item_id: 'turn-1',
      transcript: 'I call.',
    }) });
    await agent.transcriptQueue;

    assert.equal(agent.recording, true);
    assert.equal(microphone.track.enabled, true);
    assert.equal(microphone.peers[0].addedTrack, microphone.track);
    assert.deepEqual(microphone.peers[0].remoteDescription, {
      type: 'answer',
      sdp: 'microphone-answer',
    });
    assert.deepEqual(requestBodies.map(({ url }) => url), [
      '/api/realtime-call',
      'https://api.openai.com/v1/realtime/calls',
    ]);
    assert.equal(requestBodies[1].options.body, 'microphone-offer');
    assert.equal(requestBodies[1].options.headers.Authorization, 'Bearer temporary-key');
    assert.equal(requestBodies[1].options.headers['Content-Type'], 'application/sdp');
    assert.deepEqual(toolCalls, [{ name: 'call', args: {} }]);
    assert.ok(statuses.includes('Hearing speech…'));
    assert.ok(statuses.includes('Transcribing…'));
    assert.equal(statuses.at(-1), 'Listening');
    assert.ok(transcripts.some((text) => text.includes('I call.')));
    let inputLevel = 0.03;
    agent.vadSamples = new Float32Array(4);
    agent.vadAnalyser = {
      getFloatTimeDomainData(samples) {samples.fill(inputLevel);},
    };
    agent.sampleVoiceActivity(1000);
    agent.sampleVoiceActivity(1300);
    inputLevel = 0;
    agent.sampleVoiceActivity(2100);
    assert.deepEqual(JSON.parse(dataChannel.sent.at(-1)), { type: 'input_audio_buffer.commit' });

    await agent.stopMicrophone();
    assert.equal(agent.recording, false);
    assert.equal(microphone.track.stopped, true);
    assert.equal(microphone.peers[0].closed, true);
  } finally {
    globalThis.fetch = originalFetch;
    microphone.restore();
    agent.disconnect();
  }
});

test('speak sends exact text to TTS and plays the returned audio', async () => {
  const originalFetch = globalThis.fetch;
  const audio = installAudioPlayer();
  const requests = [];
  globalThis.fetch = async (url, options) => {
    requests.push({ url, body: JSON.parse(options.body) });
    return audioResponse();
  };
  const transcripts = [];
  const agent = makeAgent({ onTranscript: (text) => transcripts.push(text) });
  await agent.connect('coral');

  try {
    await agent.speak('Deal two cards.');
  } finally {
    globalThis.fetch = originalFetch;
    audio.restore();
    agent.disconnect();
  }

  assert.deepEqual(requests, [{
    url: '/api/voice',
    body: { action: 'speech', text: 'Deal two cards.', voice: 'coral' },
  }]);
  assert.equal(audio.played.length, 1);
  assert.match(transcripts.at(-1), /Deal two cards/);
});

test('recognized audio runs through transcription, one local tool, and TTS', async () => {
  const originalFetch = globalThis.fetch;
  const audio = installAudioPlayer();
  const requestBodies = [];
  const responses = [
    jsonResponse({ text: 'I call.' }),
    audioResponse(),
  ];
  globalThis.fetch = async (_url, options) => {
    requestBodies.push(JSON.parse(options.body));
    return responses.shift();
  };
  const toolCalls = [];
  const transcripts = [];
  const agent = makeAgent({
    tools: [{ type: 'function', name: 'call', parameters: { type: 'object', properties: {} } }],
    executeTool: async (name, args) => {
      toolCalls.push({ name, args });
      return { ok: true, message: 'Sam calls 5.' };
    },
    onTranscript: (text) => transcripts.push(text),
  });
  await agent.connect('coral');

  try {
    await agent.playAudioFile(new Blob(['voice'], { type: 'audio/wav' }));
  } finally {
    globalThis.fetch = originalFetch;
    audio.restore();
    agent.disconnect();
  }

  assert.deepEqual(toolCalls, [{ name: 'call', args: {} }]);
  assert.deepEqual(requestBodies.map(({ action }) => action), [
    'transcribe',
    'speech',
  ]);
  assert.match(transcripts[0], /I call/);
  assert.match(transcripts[1], /Sam calls 5/);
  assert.equal(audio.played.length, 1);
});

test('a silent tool result performs the function without requesting speech', async () => {
  const originalFetch = globalThis.fetch;
  const requestBodies = [];
  const responses = [
    jsonResponse({ text: 'background conversation' }),
    jsonResponse({
      id: 'response-1',
      output: [{ type: 'function_call', name: 'ignoreSpeech', arguments: '{}', call_id: 'ignore-1' }],
    }),
  ];
  globalThis.fetch = async (_url, options) => {
    requestBodies.push(JSON.parse(options.body));
    return responses.shift();
  };
  let toolWasCalled = false;
  const agent = makeAgent({
    executeTool: async () => {
      toolWasCalled = true;
      return { ok: true, silent: true };
    },
  });
  await agent.connect();

  try {
    await agent.playAudioFile(new Blob(['voice'], { type: 'audio/wav' }));
  } finally {
    globalThis.fetch = originalFetch;
    agent.disconnect();
  }

  assert.equal(toolWasCalled, true);
  assert.deepEqual(requestBodies.map(({ action }) => action), ['transcribe', 'respond']);
});

test('the deal-page cancellation events abort work and stop playing audio', async () => {
  const agent = makeAgent();
  await agent.connect();
  let aborted = false;
  agent.activeRequest = { abort: () => { aborted = true; } };
  agent.audio = { pause() { this.paused = true; } };
  const playingAudio = agent.audio;
  agent.pendingResponseCount = 1;

  agent.send({ type: 'response.cancel' });

  assert.equal(aborted, true);
  assert.equal(playingAudio.paused, true);
  assert.equal(agent.pendingResponseCount, 0);
});

test('server transcription always uses gpt-transcribe', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return jsonResponse({ text: 'I call.' });
  };

  try {
    const result = await handleVoiceApi({
      action: 'transcribe',
      audio: Buffer.from('audio').toString('base64'),
      mimeType: 'audio/wav',
      fileName: 'call.wav',
    }, 'test-key');
    assert.equal(result.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(request.url, 'https://api.openai.com/v1/audio/transcriptions');
  assert.equal(request.options.body.get('model'), 'gpt-transcribe');
});

test('live microphone mints a transcription-only temporary key for browser VAD', async () => {
  const originalFetch = globalThis.fetch;
  let request;
  globalThis.fetch = async (url, options) => {
    request = { url, options };
    return jsonResponse({ value: 'temporary-key' });
  };

  try {
    const result = await createRealtimeTranscriptionClientSecret('test-key');
    assert.equal(result.status, 200);
    assert.deepEqual(JSON.parse(result.body), { value: 'temporary-key' });
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(request.url, 'https://api.openai.com/v1/realtime/client_secrets');
  assert.equal(request.options.headers.Authorization, 'Bearer test-key');
  const { session } = JSON.parse(request.options.body);
  assert.equal(session.type, 'transcription');
  assert.equal(session.audio.input.transcription.model, 'gpt-live-transcribe');
  assert.equal(session.audio.input.turn_detection, null);
});

test('server thinking uses low-latency gpt-4o-mini with function tools', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return jsonResponse({ id: 'response-1', output: [] });
  };
  const tools = [{ type: 'function', name: 'call', parameters: { type: 'object', properties: {} } }];

  try {
    const result = await handleVoiceApi({
      action: 'respond',
      input: 'I call.',
      instructions: 'Operate the poker game.',
      tools,
    }, 'test-key');
    assert.equal(result.status, 200);
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requestBody.model, 'gpt-4o-mini');
  assert.equal(requestBody.reasoning, undefined);
  assert.deepEqual(requestBody.tools, tools);
  assert.equal(requestBody.tool_choice, 'auto');
});

test('server speech uses gpt-4o-mini-tts and preserves supported voices', async () => {
  const originalFetch = globalThis.fetch;
  let requestBody;
  globalThis.fetch = async (_url, options) => {
    requestBody = JSON.parse(options.body);
    return audioResponse();
  };

  try {
    const result = await handleVoiceApi({
      action: 'speech',
      text: 'Sam calls 5.',
      voice: 'marin',
    }, 'test-key');
    assert.equal(result.status, 200);
    assert.equal(result.contentType, 'audio/mpeg');
  } finally {
    globalThis.fetch = originalFetch;
  }

  assert.equal(requestBody.model, 'gpt-4o-mini-tts');
  assert.equal(requestBody.voice, 'marin');
  assert.equal(requestBody.input, 'Sam calls 5.');
  assert.equal(requestBody.response_format, 'mp3');
});
