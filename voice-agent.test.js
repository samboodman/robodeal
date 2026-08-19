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

test('the semantic gate receives the complete utterance and current game state', () => {
  const { agent, sent } = testAgent({
    getRelevanceContext: () => JSON.stringify({ currentPlayer: 'Sam', pot: 25 }),
  });

  agent.checkTranscriptRelevance('How much is in the pot?', 'audio-item-1');

  const relevanceRequest = sent[0].response;
  const classifierInput = relevanceRequest.input[0].content[0].text;
  assert.match(classifierInput, /"currentPlayer":"Sam"/);
  assert.match(classifierInput, /How much is in the pot\?/);
  assert.match(relevanceRequest.instructions, /semantic understanding/);
  assert.match(relevanceRequest.instructions, /Do not classify by matching/);
  assert.equal(relevanceRequest.tool_choice, 'required');
  assert.deepEqual(relevanceRequest.tools.map(({ name }) => name), [
    'approve_game_utterance',
    'reject_game_utterance',
  ]);
  agent.pendingRelevanceChecks.forEach(({ cleanupTimer }) => clearTimeout(cleanupTimer));
});

test('the semantic gate sees that a short player reply follows the dealer question', () => {
  const { agent, sent } = testAgent();
  agent.rememberSpeech('RoboDeal', 'How much would you like to raise?');

  agent.checkTranscriptRelevance('10', 'audio-item-1');

  const classifierInput = sent[0].response.input[0].content[0].text;
  assert.match(classifierInput, /RoboDeal: How much would you like to raise\?/);
  assert.match(classifierInput, /Newest player sentence:\n10/);
  agent.pendingRelevanceChecks.forEach(({ cleanupTimer }) => clearTimeout(cleanupTimer));
});

test('an unapproved relevance response deletes speech without creating audio', () => {
  const { agent, sent } = testAgent();
  agent.pendingRelevanceChecks.set('utterance-1', { itemId: 'audio-item-1' });

  agent.rejectUnapprovedUtterance({
    metadata: { utteranceId: 'utterance-1' },
  });

  assert.deepEqual(sent, [{ type: 'conversation.item.delete', item_id: 'audio-item-1' }]);
});

test('semantic approval updates context and creates the normal audible response', () => {
  const { agent, sent } = testAgent();
  agent.pendingRelevanceChecks.set('utterance-1', { itemId: 'audio-item-1', transcript: '10' });

  agent.approveGameUtterance(JSON.stringify({ utteranceId: 'utterance-1' }));

  assert.equal(sent[0].type, 'session.update');
  assert.deepEqual(sent[1], { type: 'response.create' });
  assert.deepEqual(agent.recentConversation, [{ role: 'Player', text: '10' }]);
});

test('semantic rejection deletes the unrelated audio item', () => {
  const { agent, sent } = testAgent();
  agent.pendingRelevanceChecks.set('utterance-1', { itemId: 'audio-item-1' });

  agent.rejectGameUtterance(JSON.stringify({ utteranceId: 'utterance-1' }));

  assert.deepEqual(sent, [{ type: 'conversation.item.delete', item_id: 'audio-item-1' }]);
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
