import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { addRequiredVoiceKeywords, audioBufferToPcm16, microphoneAudioConstraints, VoiceAgent } from './voice-agent.js';

const prompts = JSON.parse(readFileSync(new URL('./Prompts', import.meta.url), 'utf8'));

function testAgent(options = {}) {
  const sent = [];
  const agent = new VoiceAgent({ getInstructions: () => 'Current game state', prompts, ...options });
  agent.channel = {
    readyState: 'open',
    send: (event) => sent.push(JSON.parse(event)),
  };
  return { agent, sent };
}

test('every utterance is sent directly to the AI', async () => {
  const statuses = [];
  const { agent, sent } = testAgent({ onStatus: (status) => statuses.push(status) });

  await agent.handleEvent({
    type: 'conversation.item.input_audio_transcription.completed',
    transcript: 'What should we order for dinner?',
    item_id: 'audio-item-1',
  });

  assert.equal(sent[0].type, 'session.update');
  assert.deepEqual(sent[1], { type: 'response.create' });
  assert.equal(sent.some(({ type }) => type === 'conversation.item.delete'), false);
  assert.equal(statuses.at(-1), 'Thinking…');
});

test('the session exposes supplied tools with automatic tool choice', () => {
  const tools = [{ type: 'function', name: 'call', parameters: { type: 'object', properties: {} } }];
  const { agent } = testAgent({ tools });

  const session = agent.sessionConfiguration('marin');

  assert.equal(session.tool_choice, 'auto');
  assert.deepEqual(session.tools, tools);
});

test('required voice keywords are added once', () => {
  assert.deepEqual(addRequiredVoiceKeywords(['call', 'undo'], ['undo']), ['call', 'undo']);
  assert.deepEqual(addRequiredVoiceKeywords(['call'], ['undo']), ['call', 'undo']);
});

test('the session is configured for noisy restaurant speech', () => {
  const { agent } = testAgent();

  const input = agent.sessionConfiguration('marin').audio.input;

  assert.equal(input.noise_reduction.type, 'far_field');
  assert.equal(input.transcription.model, 'gpt-live-transcribe');
  assert.equal(input.transcription.delay, 'medium');
  assert.deepEqual(input.transcription.languages, ['en']);
  assert.match(input.transcription.prompt, /noisy restaurant poker table/);
  assert.ok(input.transcription.keywords.includes('all in'));
  assert.ok(input.transcription.keywords.includes('dealer'));
  assert.equal(input.turn_detection.type, 'semantic_vad');
  assert.equal(input.turn_detection.create_response, false);
});

test('microphone constraints enable supported browser voice isolation', () => {
  assert.deepEqual(microphoneAudioConstraints({ voiceIsolation: true }), {
    echoCancellation: true,
    noiseSuppression: true,
    autoGainControl: true,
    channelCount: 1,
    voiceIsolation: true,
  });
  assert.equal('voiceIsolation' in microphoneAudioConstraints(), false);
});

test('an AI tool call is executed and returned to the conversation', async () => {
  const calls = [];
  const { agent, sent } = testAgent({
    executeTool: async (name, args) => {
      calls.push({ name, args });
      return { ok: true, message: 'Player 1 calls 5.' };
    },
  });

  await agent.handleEvent({
    type: 'response.function_call_arguments.done',
    name: 'call',
    arguments: '{}',
    call_id: 'call-1',
  });

  assert.deepEqual(calls, [{ name: 'call', args: {} }]);
  assert.equal(sent[0].type, 'conversation.item.create');
  assert.match(sent[0].item.output, /Player 1 calls 5/);
  assert.equal(sent[1].type, 'session.update');
  assert.equal(sent[2].type, 'response.create');
});

test('an AI-selected silent tool call produces no follow-up response', async () => {
  const statuses = [];
  const { agent, sent } = testAgent({
    executeTool: async () => ({ ok: true, silent: true }),
    onStatus: (status) => statuses.push(status),
  });

  await agent.handleEvent({
    type: 'response.function_call_arguments.done',
    name: 'ignoreSpeech',
    arguments: '{}',
    call_id: 'ignore-1',
  });

  assert.deepEqual(sent.map(({ type }) => type), ['conversation.item.create']);
  assert.match(sent[0].item.output, /\"silent\":true/);
  assert.deepEqual(statuses, ['Applying action…', 'Microphone off']);
});

test('voice status follows thinking, speaking, and idle response states', async () => {
  const statuses = [];
  const { agent } = testAgent({ onStatus: (status) => statuses.push(status) });
  agent.microphoneStream = { getTracks: () => [] };

  await agent.handleEvent({
    type: 'conversation.item.input_audio_transcription.completed',
    transcript: 'Dealer, call.',
  });
  await agent.handleEvent({ type: 'response.output_audio.delta', delta: 'audio' });
  await agent.handleEvent({ type: 'response.done' });

  assert.deepEqual(statuses, ['Thinking…', 'Speaking…', 'Listening']);
});

test('converts decoded audio to 24 kHz mono PCM16', () => {
  const pcm = audioBufferToPcm16({
    sampleRate: 12_000,
    length: 2,
    numberOfChannels: 1,
    getChannelData: () => new Float32Array([-1, 1]),
  });

  assert.equal(pcm.length, 8);
  assert.equal(new DataView(pcm.buffer).getInt16(0, true), -32_768);
});

test('an audio file is appended and committed through the Realtime input buffer', async () => {
  const { agent, sent } = testAgent();
  const microphoneTrack = { kind: 'microphone' };
  const replacedTracks = [];
  agent.sender = {
    track: microphoneTrack,
    async replaceTrack(track) { replacedTracks.push(track); },
  };

  class FakeAudioContext {
    async resume() {}
    async decodeAudioData() {
      return {
        sampleRate: 24_000,
        length: 2_400,
        numberOfChannels: 1,
        getChannelData: () => new Float32Array(2_400).fill(0.25),
      };
    }
    async close() {}
  }

  const originalWindow = globalThis.window;
  globalThis.window = { AudioContext: FakeAudioContext };
  try {
    await agent.playAudioFile({ name: 'call.wav', arrayBuffer: async () => new ArrayBuffer(1) });
  } finally {
    globalThis.window = originalWindow;
  }

  assert.deepEqual(replacedTracks, [null, microphoneTrack]);
  assert.deepEqual(sent.map(({ type }) => type), [
    'input_audio_buffer.clear',
    'input_audio_buffer.append',
    'input_audio_buffer.commit',
  ]);
  assert.equal(agent.audioTestRunning, false);
});
