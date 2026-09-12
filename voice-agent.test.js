import test from 'node:test';
import assert from 'node:assert/strict';
import { microphoneAudioConstraints, rootMeanSquare, VoiceAgent } from './voice-agent.js';

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

test('calculates an audio signal root mean square', () => {
  assert.equal(rootMeanSquare(new Float32Array([0, 0, 0])), 0);
  assert.equal(rootMeanSquare(new Float32Array([1, -1])), 1);
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

test('starts speculative reasoning from stable transcript text without executing the turn', async () => {
  const preparedTurn = { id: 'prepared_1' };
  const speculativeCalls = [];
  const delegations = [];
  const { agent } = testAgent({
    speculationDelayMs: 0,
    onSpeculativeDelegation: (input) => {
      speculativeCalls.push(input);
      return preparedTurn;
    },
    onDelegation: async (delegation) => {
      delegations.push(delegation);
      return { speak: false, kind: 'ignored', utterance: '' };
    },
  });

  await agent.handleEvent({
    type: 'session.input_transcript.delta',
    delta: "I'll check",
    start_ms: 1_000,
    end_ms: 1_400,
  });
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(speculativeCalls.length, 1);
  assert.equal(delegations.length, 0);
  assert.equal(speculativeCalls[0].transcript, "I'll check");

  await agent.handleEvent({
    type: 'session.delegation.created',
    offset_ms: 2_000,
    delegation: { id: 'item_prepared', target: 'client' },
  });
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(delegations.length, 1);
  assert.equal(delegations[0].preparedTurn, preparedTurn);
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

test('reports backend and GPT-Live speech-start latency', async () => {
  const samples = [];
  const { agent } = testAgent({ onLatency: (timing) => samples.push(timing) });
  agent.audio = { muted: true };

  agent.speak('Sam checks.', null, { initialTerraMs: 12, javascriptMs: 1 });
  await agent.handleEvent({ type: 'session.output_transcript.delta', delta: 'Sam ' });
  await agent.handleEvent({ type: 'session.output_transcript.done' });

  assert.equal(samples.length, 1);
  assert.equal(samples[0].initialTerraMs, 12);
  assert.equal(samples[0].javascriptMs, 1);
  assert.ok(samples[0].gptLiveSpeechStartMs >= 0);
  assert.ok(samples[0].estimatedEndOfSpeechToAudioMs >= 12);
});

test('mutes any Live speech that was not opened by Terra-approved commentary', async () => {
  const { agent } = testAgent();
  agent.audio = { muted: true };

  await agent.handleEvent({ type: 'session.output_transcript.delta', delta: 'Let me check.' });

  assert.equal(agent.audio.muted, true);
  assert.equal(agent.outputTranscript, '');
  assert.deepEqual(agent.conversation, []);
});

test('incoming user speech immediately closes a previously open output gate', async () => {
  const { agent } = testAgent();
  agent.audio = { muted: false };
  agent.pendingSpeechCount = 1;
  agent.pendingSpeechTelemetry = [{ speechStarted: true }];
  agent.outputCompletionsAwaitingDrain = 1;
  agent.outputTranscript = 'Mm-hmm.';

  await agent.handleEvent({
    type: 'session.input_transcript.delta',
    delta: "I'll check",
    start_ms: 1_000,
    end_ms: 1_400,
  });

  assert.equal(agent.audio.muted, true);
  assert.equal(agent.pendingSpeechCount, 0);
  assert.deepEqual(agent.pendingSpeechTelemetry, []);
  assert.equal(agent.outputCompletionsAwaitingDrain, 0);
  assert.equal(agent.outputTranscript, '');
  assert.equal(agent.inputTranscript, "I'll check");
});

test('output transcript deltas are retained as conversation history', async () => {
  const transcripts = [];
  const { agent } = testAgent({ onTranscript: (text) => transcripts.push(text) });
  agent.pendingSpeechCount = 1;
  agent.audio = { muted: false };

  await agent.handleEvent({ type: 'session.output_transcript.delta', delta: 'Sam ' });
  await agent.handleEvent({ type: 'session.output_transcript.delta', delta: 'calls.' });
  await agent.handleEvent({ type: 'session.output_transcript.done' });

  assert.deepEqual(agent.conversation, [{ role: 'assistant', text: 'Sam calls.' }]);
  assert.deepEqual(transcripts, ['RoboDeal: “Sam calls.”']);
  assert.equal(agent.pendingSpeechCount, 1);
  assert.equal(agent.audio.muted, false);
});

test('audio completion waits for a local drain before closing the output gate', async () => {
  const statuses = [];
  const { agent } = testAgent({
    onStatus: (status) => statuses.push(status),
    outputDrainFallbackMs: 8,
    outputDrainPollMs: 2,
  });
  agent.pendingSpeechCount = 1;
  agent.audio = { muted: false };

  await agent.handleEvent({ type: 'session.output_audio.done' });

  assert.equal(agent.audio.muted, false);
  assert.equal(agent.pendingSpeechCount, 1);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(agent.audio.muted, true);
  assert.equal(agent.pendingSpeechCount, 0);
  assert.equal(statuses.at(-1), 'Microphone off');
});

test('local audio activity resets the silence drain window', async () => {
  const { agent } = testAgent({
    outputSilenceMs: 6,
    outputDrainMinMs: 0,
    outputDrainMaxMs: 100,
    outputDrainPollMs: 2,
  });
  agent.pendingSpeechCount = 1;
  agent.audio = { muted: false };
  let polls = 0;
  agent.outputAnalyserSamples = new Float32Array(2);
  agent.outputAnalyser = {
    getFloatTimeDomainData(samples) {
      polls += 1;
      samples.fill(polls <= 2 ? 0.1 : 0);
    },
  };

  await agent.handleEvent({ type: 'session.output_audio.done' });

  await new Promise((resolve) => setTimeout(resolve, 5));
  assert.equal(agent.audio.muted, false);
  await new Promise((resolve) => setTimeout(resolve, 15));
  assert.equal(agent.audio.muted, true);
  assert.ok(polls >= 3);
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
