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

test('executes one JavaScript tool and returns its raw result to the same Terra response', async () => {
  const requests = [];
  const toolCalls = [];
  const responses = [
    {
      type: 'tool_calls',
      responseId: 'resp_1',
      calls: [{ callId: 'call_1', name: 'fold', arguments: '{}' }],
    },
    {
      type: 'result',
      responseId: 'resp_2',
      result: { speak: true, kind: 'action_result', utterance: 'Sam slides them into the muck.' },
    },
  ];
  const agent = new DealerAgent({
    getGameState: () => ({ phase: 'BETTING_PREFLOP' }),
    tools: [{ type: 'function', name: 'fold' }],
    executeTool: async (name, args) => {
      toolCalls.push({ name, args });
      return { ok: true, action: { type: 'fold', actor: { name: 'Sam' } } };
    },
    fetchImplementation: async (_url, options) => {
      requests.push(JSON.parse(options.body));
      return jsonResponse(responses.shift());
    },
  });

  const result = await agent.run({ type: 'voice_utterance', transcript: "I'm out" });

  assert.deepEqual(toolCalls, [{ name: 'fold', args: {} }]);
  assert.equal(requests[1].previousResponseId, 'resp_1');
  assert.deepEqual(requests[1].toolOutputs, [{
    callId: 'call_1',
    output: { ok: true, action: { type: 'fold', actor: { name: 'Sam' } } },
  }]);
  assert.equal(result.utterance, 'Sam slides them into the muck.');
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
