import test from 'node:test';
import assert from 'node:assert/strict';
import { audioBufferToPcm16, VoiceAgent } from './voice-agent.js';

function testAgent(options = {}) {
  const sent = [];
  const agent = new VoiceAgent({ getInstructions: () => 'Current game state', ...options });
  agent.channel = {
    readyState: 'open',
    send: (event) => sent.push(JSON.parse(event)),
  };
  return { agent, sent };
}

test('a deterministic command speaks its validated result', async () => {
  const { agent, sent } = testAgent({
    handleTranscript: async () => ({ handled: true, message: 'Player 1 calls 5.' }),
  });

  await agent.handleEvent({
    type: 'conversation.item.input_audio_transcription.completed',
    transcript: 'Call',
    item_id: 'audio-item-1',
  });

  assert.equal(sent[0].type, 'session.update');
  assert.equal(sent[1].type, 'response.create');
  assert.match(sent[1].response.input[0].content[0].text, /Player 1 calls 5/);
});

test('every unmatched utterance is sent directly to the AI', async () => {
  const { agent, sent } = testAgent();

  await agent.handleEvent({
    type: 'conversation.item.input_audio_transcription.completed',
    transcript: 'What should we order for dinner?',
    item_id: 'audio-item-1',
  });

  assert.equal(sent[0].type, 'session.update');
  assert.deepEqual(sent[1], { type: 'response.create', response: { tool_choice: 'none' } });
  assert.equal(sent.some(({ type }) => type === 'conversation.item.delete'), false);
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
