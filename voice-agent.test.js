import test from 'node:test';
import assert from 'node:assert/strict';
import { realtimeResponseText, VoiceAgent } from './voice-agent.js';

test('reads a text-only Realtime classification response', () => {
  const response = {
    output: [{
      type: 'message',
      content: [{ type: 'output_text', text: 'UNRELATED' }],
    }],
  };

  assert.equal(realtimeResponseText(response), 'UNRELATED');
});

test('joins classification text split across content entries', () => {
  const response = {
    output: [{ content: [{ text: 'GA' }, { text: 'ME' }] }],
  };

  assert.equal(realtimeResponseText(response), 'GAME');
});

function testAgent() {
  const sent = [];
  const agent = new VoiceAgent({ getInstructions: () => 'Current game state' });
  agent.channel = {
    readyState: 'open',
    send: (event) => sent.push(JSON.parse(event)),
  };
  return { agent, sent };
}

test('unrelated speech is deleted without creating an audible response', () => {
  const { agent, sent } = testAgent();
  agent.pendingRelevanceChecks.set('utterance-1', { itemId: 'audio-item-1' });

  agent.handleRelevanceResult({
    metadata: { utteranceId: 'utterance-1' },
    output: [{ content: [{ text: 'UNRELATED' }] }],
  });

  assert.deepEqual(sent, [{ type: 'conversation.item.delete', item_id: 'audio-item-1' }]);
});

test('game speech updates context and creates the normal audible response', () => {
  const { agent, sent } = testAgent();
  agent.pendingRelevanceChecks.set('utterance-1', { itemId: 'audio-item-1' });

  agent.handleRelevanceResult({
    metadata: { utteranceId: 'utterance-1' },
    output: [{ content: [{ text: 'GAME' }] }],
  });

  assert.equal(sent[0].type, 'session.update');
  assert.deepEqual(sent[1], { type: 'response.create' });
});
