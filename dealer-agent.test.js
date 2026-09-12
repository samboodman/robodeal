import assert from 'node:assert/strict';
import test from 'node:test';
import { DealerAgent } from './dealer-agent.js';

function jsonResponse(value, ok = true) {
  return { ok, text: async () => JSON.stringify(value) };
}

test('sends voice text, current state, and conversation to Terra', async () => {
  const requests = [];
  const agent = new DealerAgent({
    getGameState: () => ({ currentPlayer: { name: 'Sam' } }),
    tools: [],
    executeTool: async () => {},
    fetchImplementation: async (url, options) => {
      requests.push({ url, body: JSON.parse(options.body) });
      return jsonResponse({
        type: 'result',
        responseId: 'resp_1',
        result: { speak: true, kind: 'answer', utterance: "It's Sam's turn." },
      });
    },
  });

  const result = await agent.run(
    { type: 'voice_utterance', transcript: "Who's up?" },
    [{ role: 'assistant', text: 'Maya calls.' }],
  );

  assert.equal(requests[0].url, '/api/dealer-turn');
  assert.equal(requests[0].body.envelope.gameState.currentPlayer.name, 'Sam');
  assert.equal(requests[0].body.envelope.sourceEvent.transcript, "Who's up?");
  assert.deepEqual(requests[0].body.envelope.recentConversation, [{ role: 'assistant', text: 'Maya calls.' }]);
  assert.equal(result.utterance, "It's Sam's turn.");
});

test('releases optimistic narration only after JavaScript accepts the action', async () => {
  const requests = [];
  const toolCalls = [];
  const timings = [];
  const agent = new DealerAgent({
    getGameState: () => ({ phase: 'BETTING_PREFLOP' }),
    tools: [{ type: 'function', name: 'fold' }],
    executeTool: async (name, args) => {
      toolCalls.push({ name, args });
      return { ok: true, action: { type: 'fold', actor: { name: 'Sam' } } };
    },
    onTiming: (timing) => timings.push(timing),
    fetchImplementation: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return jsonResponse({
        type: 'tool_calls',
        responseId: 'resp_1',
        calls: [{
          callId: 'call_1',
          name: 'fold',
          arguments: '{"narration":"Sam slides them into the muck."}',
        }],
      });
    },
  });

  const result = await agent.run({ type: 'voice_utterance', transcript: "I'm out" });

  assert.deepEqual(toolCalls, [{ name: 'fold', args: {} }]);
  assert.equal(requests.length, 1);
  assert.equal(result.utterance, 'Sam slides them into the muck.');
  assert.equal(timings.length, 1);
  assert.equal(result.timing, timings[0]);
  assert.equal(result.timing.optimisticNarration, true);
  assert.ok(result.timing.initialTerraMs >= 0);
  assert.ok(result.timing.javascriptMs >= 0);
  assert.equal(result.timing.postToolTerraMs, 0);
  assert.ok(result.timing.totalBackendMs >= 0);
});

test('uses a second reasoning pass when JavaScript rejects the action', async () => {
  const requests = [];
  const responses = [
    {
      type: 'tool_calls',
      responseId: 'resp_1',
      calls: [{
        callId: 'call_1',
        name: 'check',
        arguments: '{"narration":"Sam taps the table."}',
      }],
    },
    {
      type: 'result',
      responseId: 'resp_2',
      result: { speak: true, kind: 'error', utterance: 'Sam owes ten; call, raise, or fold.' },
    },
  ];
  const agent = new DealerAgent({
    getGameState: () => ({ currentPlayer: { name: 'Sam' }, amountToCall: 10 }),
    tools: [{ type: 'function', name: 'check' }],
    executeTool: async () => ({ ok: false, errorCode: 'CHIPS_OWED' }),
    fetchImplementation: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return jsonResponse(responses.shift());
    },
  });

  const result = await agent.run({ type: 'voice_utterance', transcript: 'check' });

  assert.equal(requests.length, 2);
  assert.equal(requests[1].previousResponseId, 'resp_1');
  assert.deepEqual(requests[1].toolOutputs, [{
    callId: 'call_1',
    output: { ok: false, errorCode: 'CHIPS_OWED' },
  }]);
  assert.equal(result.utterance, 'Sam owes ten; call, raise, or fold.');
  assert.equal(result.timing.optimisticNarration, undefined);
});

test('does not execute or narrate a tool call based on stale game state', async () => {
  let state = { currentPlayer: { name: 'Sam' }, pot: 10 };
  let toolExecutions = 0;
  const requests = [];
  const agent = new DealerAgent({
    getGameState: () => state,
    tools: [{ type: 'function', name: 'call' }],
    executeTool: async () => {
      toolExecutions += 1;
      return { ok: true };
    },
    fetchImplementation: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      state = { currentPlayer: { name: 'Maya' }, pot: 20 };
      return jsonResponse({
        type: 'tool_calls',
        responseId: 'resp_1',
        calls: [{
          callId: 'call_1',
          name: 'call',
          arguments: '{"narration":"Sam calls ten."}',
        }],
      });
    },
  });

  const result = await agent.run({ type: 'voice_utterance', transcript: 'call' });

  assert.equal(toolExecutions, 0);
  assert.equal(requests.length, 1);
  assert.deepEqual(result, {
    speak: false,
    kind: 'ignored',
    utterance: '',
    timing: result.timing,
  });
  assert.equal(result.timing.staleStateIgnored, true);
  assert.equal(result.timing.postToolTerraMs, 0);
});

test('serializes turns so concurrent speech cannot race the state machine', async () => {
  const order = [];
  let releaseFirst;
  const firstBlocked = new Promise((resolve) => { releaseFirst = resolve; });
  let requestCount = 0;
  const agent = new DealerAgent({
    getGameState: () => ({}),
    tools: [],
    executeTool: async () => {},
    fetchImplementation: async () => {
      requestCount += 1;
      const current = requestCount;
      order.push(`start-${current}`);
      if (current === 1) await firstBlocked;
      order.push(`end-${current}`);
      return jsonResponse({
        type: 'result',
        responseId: `resp_${current}`,
        result: { speak: false, kind: 'ignored', utterance: '' },
      });
    },
  });

  const first = agent.run({ type: 'voice_utterance', transcript: 'first' });
  const second = agent.run({ type: 'voice_utterance', transcript: 'second' });
  await Promise.resolve();
  assert.deepEqual(order, ['start-1']);
  releaseFirst();
  await Promise.all([first, second]);
  assert.deepEqual(order, ['start-1', 'end-1', 'start-2', 'end-2']);
});
