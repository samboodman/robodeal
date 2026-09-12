import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  buildDealerResponseRequest,
  buildLiveSessionRequest,
  parseDealerResponse,
} from './openai-api.js';

const prompts = JSON.parse(readFileSync(new URL('./Prompts.json', import.meta.url), 'utf8'));
const callTool = {
  type: 'function',
  name: 'call',
  description: 'Call now.',
  parameters: {
    type: 'object',
    properties: { narration: { type: 'string' } },
    required: ['narration'],
    additionalProperties: false,
  },
};

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
  assert.deepEqual(request.transport, { type: 'webrtc', sdp: 'offer-sdp' });
});

test('builds a Terra Responses request with tools and strict dealer output', () => {
  const request = buildDealerResponseRequest({
    envelope: { sourceEvent: { type: 'voice_utterance', transcript: 'I call' }, gameState: {} },
    tools: [callTool, { type: 'function', name: 'confirmAction' }],
  });

  assert.equal(request.model, 'gpt-5.6-terra');
  assert.equal(request.service_tier, 'priority');
  assert.equal(request.reasoning.effort, 'none');
  assert.equal(request.parallel_tool_calls, false);
  assert.equal(request.max_output_tokens, 800);
  assert.deepEqual(request.tools.map(({ name }) => name), ['call']);
  assert.equal(request.tools[0].strict, true);
  assert.deepEqual(request.tools[0].parameters.required, ['narration']);
  assert.deepEqual(request.text.format.schema, prompts.dealerResponseSchema);
  assert.match(request.instructions, /Too rich for me/);
  assert.match(request.instructions, /You need to say/);
  assert.match(request.instructions, /stand-alone or turn-responsive declarations/);
  assert.match(request.instructions, /Sam, you need to say check/);
  assert.match(request.instructions, /allIn: execute immediately/);
  assert.match(request.instructions, /tool's narration argument/);
  assert.doesNotMatch(request.instructions, /all-in confirmation/);
});

test('continues the same Terra response with raw JavaScript tool output', () => {
  const request = buildDealerResponseRequest({
    previousResponseId: 'resp_1',
    toolOutputs: [{ callId: 'call_1', output: { ok: true, action: { type: 'call', chipsMoved: 5 } } }],
    tools: [callTool],
  });

  assert.equal(request.previous_response_id, 'resp_1');
  assert.deepEqual(request.input, [{
    type: 'function_call_output',
    call_id: 'call_1',
    output: '{"ok":true,"action":{"type":"call","chipsMoved":5}}',
  }]);
  assert.equal(request.instructions, prompts.terraInstructions);
  assert.deepEqual(request.tools, []);
  assert.equal(request.tool_choice, 'none');
  assert.equal(request.parallel_tool_calls, false);
  assert.equal(request.max_output_tokens, 300);
});

test('parses Terra tool calls and final structured dealer speech', () => {
  assert.deepEqual(parseDealerResponse({
    id: 'resp_tools',
    status: 'completed',
    service_tier: 'priority',
    output: [{ type: 'function_call', call_id: 'call_1', name: 'fold', arguments: '{}' }],
  }), {
    type: 'tool_calls',
    responseId: 'resp_tools',
    serviceTier: 'priority',
    calls: [{ callId: 'call_1', name: 'fold', arguments: '{}' }],
  });

  assert.deepEqual(parseDealerResponse({
    id: 'resp_done',
    status: 'completed',
    output: [{
      type: 'message',
      content: [{ type: 'output_text', text: '{"speak":true,"kind":"action_result","utterance":"Sam lets it go."}' }],
    }],
  }), {
    type: 'result',
    responseId: 'resp_done',
    serviceTier: null,
    result: { speak: true, kind: 'action_result', utterance: 'Sam lets it go.' },
  });
});

test('the opening-announcement prompt includes all authoritative settings', () => {
  assert.match(prompts.terraInstructions, /sourceEvent\.type 'game_started'/);
  assert.match(prompts.terraInstructions, /starting stack/);
  assert.match(prompts.terraInstructions, /ante and amount/);
  assert.match(prompts.terraInstructions, /small blind/);
  assert.match(prompts.terraInstructions, /big blind/);
  assert.match(prompts.terraInstructions, /immediate deal instruction/);
});
