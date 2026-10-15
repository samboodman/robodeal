import test from 'node:test';
import assert from 'node:assert/strict';
import {
  isBackchannelOnly,
  isBackchannelPrefix,
  microphoneAudioConstraints,
  rootMeanSquare,
  VoiceAgent,
} from './voice-agent.js';

function testAgent(options = {}) {
  const sent = [];
  const requests = [];
  const audio = [];
  const agent = new VoiceAgent({
    delegationDelayMs: 0,
    silentAppend: 'Continue listening silently.',
    speechFetch: async (_path, request) => {
      requests.push(JSON.parse(request.body));
      return { ok: true, blob: async () => new Blob(['wave']) };
    },
    createPlaybackAudio: () => {
      const playback = {
        play: async () => { playback.onplay?.(); },
        pause: () => { playback.paused = true; },
        paused: false,
        src: '',
      };
      audio.push(playback);
      return playback;
    },
    ...options,
  });
  agent.channel = { readyState: 'open', send: (event) => sent.push(JSON.parse(event)) };
  agent.sessionStarted = true;
  agent.voice = 'marin';
  agent.accent = 'neutral';
  agent.pace = 'natural';
  return { agent, sent, requests, audio };
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

test('calculates audio signal RMS and recognizes backchannels', () => {
  assert.equal(rootMeanSquare(new Float32Array([0, 0, 0])), 0);
  assert.equal(rootMeanSquare(new Float32Array([1, -1])), 1);
  assert.equal(isBackchannelOnly('Uh-huh'), true);
  assert.equal(isBackchannelPrefix('Mh'), true);
  assert.equal(isBackchannelPrefix('Sam'), false);
});

test('delegated narration renders the exact application sentence instead of commentary', async () => {
  const { agent, sent, requests, audio } = testAgent({
    onDelegation: async () => ({ speak: true, kind: 'action_result', utterance: 'Abby checked.' }),
  });
  await agent.handleEvent({ type: 'session.input_transcript.delta', delta: 'check' });
  await agent.handleEvent({ type: 'session.delegation.created', delegation: { id: 'item_1', target: 'client' } });
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.deepEqual(sent, []);
  assert.deepEqual(requests, [{ text: 'Abby checked.', voice: 'marin', accent: 'neutral', pace: 'natural' }]);
  assert.equal(audio.length, 1);
});

test('a silent decision sends only silent context and renders no audio', async () => {
  const { agent, sent, requests } = testAgent({
    onDelegation: async () => ({ speak: false, kind: 'ignored', utterance: '' }),
  });
  await agent.handleEvent({ type: 'session.input_transcript.delta', delta: 'background chatter' });
  await agent.handleEvent({ type: 'session.delegation.created', delegation: { id: 'item_silent', target: 'client' } });
  await new Promise((resolve) => setTimeout(resolve, 5));

  assert.equal(sent.length, 1);
  assert.equal(sent[0].type, 'session.thinking.append');
  assert.deepEqual(requests, []);
});

test('GPT-Live output stays muted even while an exact clip is playing', async () => {
  const { agent } = testAgent();
  agent.audio = { muted: true };
  agent.speak('Abby checked.');
  await new Promise((resolve) => setTimeout(resolve, 0));
  await agent.handleEvent({ type: 'session.output_transcript.delta', delta: 'Abby check.' });

  assert.equal(agent.audio.muted, true);
  assert.equal(agent.outputTranscript, '');
  assert.deepEqual(agent.conversation, []);
});

test('new user speech cancels an in-progress exact clip', async () => {
  const { agent, audio } = testAgent();
  agent.speak('Abby checked.');
  await new Promise((resolve) => setTimeout(resolve, 0));
  await agent.handleEvent({ type: 'session.input_transcript.delta', delta: 'wait' });

  assert.equal(audio[0].paused, true);
  assert.equal(agent.pendingSpeechCount, 0);
});

test('speech rendering errors are shown in the UI and never open GPT-Live audio', async () => {
  const statuses = [];
  const { agent } = testAgent({
    speechFetch: async () => ({ ok: false, text: async () => 'speech failed' }),
    onStatus: (status) => statuses.push(status),
  });
  agent.audio = { muted: true };
  agent.speak('Abby checked.');
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(agent.audio.muted, true);
  assert.equal(statuses.at(-1), 'AI error: speech failed');
});
