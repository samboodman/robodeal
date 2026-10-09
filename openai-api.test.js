import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  buildDecisionsRequest,
  buildLiveSessionRequest,
  parseDecisionsResponse,
} from './openai-api.js';
import { DECISIONS_MODEL } from './decisions.js';

const prompts = JSON.parse(readFileSync(new URL('./Prompts.json', import.meta.url), 'utf8'));

test('creates a native GPT-Live client-delegation session without a separate transcriber', () => {
  const request = buildLiveSessionRequest({
    sdp: 'offer-sdp',
    voice: 'marin',
    accent: 'Vegas',
    pace: 'brisk',
  });

  assert.equal(request.session.model, 'gpt-live-1');
  assert.deepEqual(request.session.delegation, { type: 'client' });
  assert.deepEqual(request.session.audio, { output: { voice: 'marin' } });
  assert.equal(JSON.stringify(request).includes('gpt-live-transcribe'), false);
  assert.match(request.session.instructions, /Vegas/);
  assert.match(request.session.instructions, /brisk/);
  assert.match(request.session.instructions, /DEALER FACTS/);
  assert.deepEqual(request.transport, { type: 'webrtc', sdp: 'offer-sdp' });
});

test('builds a Decisions request from an input and questions', () => {
  const request = buildDecisionsRequest({
    input: 'state and transcript',
    questions: [{ type: 'choice', name: 'action', instructions: 'pick', choices: [{ value: 'call' }] }],
  });

  assert.equal(request.model, DECISIONS_MODEL);
  assert.equal(request.input, 'state and transcript');
  assert.equal(request.questions.length, 1);
  assert.deepEqual(request.questions[0].choices, [{ value: 'call' }]);
  assert.throws(() => buildDecisionsRequest({ input: '', questions: [{}] }), /input/);
  assert.throws(() => buildDecisionsRequest({ input: 'x', questions: [] }), /question/);
});

test('parses Decisions answers and rejects malformed responses', () => {
  const answers = [{ type: 'choice', name: 'action', choice: 'call' }];
  assert.deepEqual(parseDecisionsResponse({ answers }), { answers });
  assert.throws(() => parseDecisionsResponse({}), /no answers/);
  assert.throws(() => parseDecisionsResponse(null), /no answers/);
});

test('the Decisions prompt describes the classification job', () => {
  assert.match(prompts.decisionsInstructions, /narrateValues/);
  assert.match(prompts.decisionsInstructions, /raiseTo/);
  assert.match(prompts.decisionsInstructions, /raiseBy/);
  assert.match(prompts.decisionsInstructions, /digit/);
});
