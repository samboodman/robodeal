import test from 'node:test';
import assert from 'node:assert/strict';
import { VoiceAgent } from './voice-agent.js';

function testAgent() {
  const sent = [];
  const agent = new VoiceAgent({ getInstructions: () => 'Current game state' });
  agent.channel = {
    readyState: 'open',
    send: (event) => sent.push(JSON.parse(event)),
  };
  return { agent, sent };
}

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
  agent.pendingRelevanceChecks.set('utterance-1', { itemId: 'audio-item-1' });

  agent.approveGameUtterance(JSON.stringify({ utteranceId: 'utterance-1' }));

  assert.equal(sent[0].type, 'session.update');
  assert.deepEqual(sent[1], { type: 'response.create' });
});
