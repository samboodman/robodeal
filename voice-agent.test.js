import test from 'node:test';
import assert from 'node:assert/strict';
import { microphoneAudioConstraints, VoiceAgent } from './voice-agent.js';

function testAgent(options = {}) {
  const sent = [];
  const agent = new VoiceAgent({ delegationDelayMs: 0, ...options });
  agent.channel = {
    readyState: 'open',
    send: (event) => sent.push(JSON.parse(event)),
  };
  agent.sessionStarted = true;
  return { agent, sent };
}

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

test('collects native GPT-Live transcript deltas and sends client delegation to Terra', async () => {
  const delegations = [];
  const { agent, sent } = testAgent({
    onDelegation: async (delegation) => {
      delegations.push(delegation);
      return { speak: true, kind: 'action_result', utterance: 'Sam calls five.' };
    },
  });

  await agent.handleEvent({ type: 'session.input_transcript.delta', delta: 'I ' });
  await agent.handleEvent({ type: 'session.input_transcript.delta', delta: 'call' });
  await agent.handleEvent({
    type: 'session.delegation.created',
    offset_ms: 1_200,
    delegation: { id: 'item_1', target: 'client' },
  });
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(delegations.length, 1);
  assert.equal(delegations[0].delegationId, 'item_1');
  assert.equal(delegations[0].transcript, 'I call');
  assert.deepEqual(sent[0], {
    type: 'session.commentary.append',
    event_id: sent[0].event_id,
    delegation_id: 'item_1',
    content: 'Sam calls five.',
  });
});

test('a silent Terra result resolves the delegation without spoken commentary', async () => {
  const { agent, sent } = testAgent({
    onDelegation: async () => ({ speak: false, kind: 'ignored', utterance: '' }),
  });

  await agent.handleEvent({ type: 'session.input_transcript.delta', delta: 'background chatter' });
  await agent.handleEvent({
    type: 'session.delegation.created',
    delegation: { id: 'item_silent', target: 'client' },
  });
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'session.thinking.append');
  assert.equal(sent[0].delegation_id, 'item_silent');
  assert.match(sent[0].content, /Continue listening silently/);
});

test('a Terra failure stays silent and reports the problem in the UI', async () => {
  const statuses = [];
  const { agent, sent } = testAgent({
    onDelegation: async () => { throw new Error('backend offline'); },
    onStatus: (status) => statuses.push(status),
  });

  await agent.handleEvent({ type: 'session.input_transcript.delta', delta: 'I call' });
  await agent.handleEvent({
    type: 'session.delegation.created',
    delegation: { id: 'item_error', target: 'client' },
  });
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.deepEqual(sent.map(({ type }) => type), ['session.thinking.append']);
  assert.equal(statuses.at(-1), 'AI error: backend offline');
});

test('application narration uses commentary with a null delegation ID', () => {
  const { agent, sent } = testAgent();
  agent.audio = { muted: true };

  agent.speak('No-limit Texas Hold’em, five-chip ante.');

  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'session.commentary.append');
  assert.equal(sent[0].delegation_id, null);
  assert.equal(sent[0].content, 'No-limit Texas Hold’em, five-chip ante.');
  assert.equal(agent.audio.muted, false);
});

test('mutes any Live speech that was not opened by Terra-approved commentary', async () => {
  const { agent } = testAgent();
  agent.audio = { muted: true };

  await agent.handleEvent({ type: 'session.output_transcript.delta', delta: 'Let me check.' });

  assert.equal(agent.audio.muted, true);
  assert.equal(agent.outputTranscript, '');
  assert.deepEqual(agent.conversation, []);
});

test('output transcript deltas are retained as conversation history', async () => {
  const transcripts = [];
  const { agent } = testAgent({ onTranscript: (text) => transcripts.push(text) });
  agent.pendingSpeechCount = 1;

  await agent.handleEvent({ type: 'session.output_transcript.delta', delta: 'Sam ' });
  await agent.handleEvent({ type: 'session.output_transcript.delta', delta: 'calls.' });
  await agent.handleEvent({ type: 'session.output_transcript.done' });

  assert.deepEqual(agent.conversation, [{ role: 'assistant', text: 'Sam calls.' }]);
  assert.deepEqual(transcripts, ['RoboDeal: “Sam calls.”']);
});

test('session start is required before the agent reports connected', async () => {
  const { agent } = testAgent();
  agent.sessionStarted = false;
  let started = false;
  agent.sessionStartedResolve = () => { started = true; };

  assert.equal(agent.connected, false);
  await agent.handleEvent({ type: 'session.started' });

  assert.equal(started, true);
  assert.equal(agent.connected, true);
});

test('an audio file is played into the WebRTC sender track', async () => {
  const { agent } = testAgent();
  const microphoneTrack = { kind: 'microphone' };
  const fileTrack = { kind: 'file' };
  const replacedTracks = [];
  agent.sender = {
    track: microphoneTrack,
    async replaceTrack(track) {
      replacedTracks.push(track);
      this.track = track;
    },
  };

  class FakeAudioContext {
    async resume() {}
    async decodeAudioData() { return { duration: 1 }; }
    createMediaStreamDestination() {
      return { stream: { getAudioTracks: () => [fileTrack] } };
    }
    createBufferSource() {
      return {
        connect() {},
        start() { queueMicrotask(() => this.onended()); },
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

  assert.deepEqual(replacedTracks, [fileTrack, microphoneTrack]);
  assert.equal(agent.audioTestRunning, false);
});
