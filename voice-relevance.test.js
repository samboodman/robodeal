import test from 'node:test';
import assert from 'node:assert/strict';

import { isGameRelatedTranscript } from './voice-relevance.js';

test('accepts poker actions and questions', () => {
  assert.equal(isGameRelatedTranscript('raise five'), true);
  assert.equal(isGameRelatedTranscript('whose turn is it?'), true);
  assert.equal(isGameRelatedTranscript('how much is in the pot?'), true);
});

test('does not treat a player name as game-related by itself', () => {
  assert.equal(isGameRelatedTranscript('Sam, what do you want to eat?', { playerNames: ['Sam'] }), false);
  assert.equal(isGameRelatedTranscript('Sam, raise five', { playerNames: ['Sam'] }), true);
  assert.equal(isGameRelatedTranscript('raise five, Sam', { playerNames: ['Sam'] }), true);
});

test('ignores unrelated table conversation', () => {
  assert.equal(isGameRelatedTranscript('that movie was really funny'), false);
  assert.equal(isGameRelatedTranscript('can you hear me AI?'), false);
  assert.equal(isGameRelatedTranscript('what should we order for dinner?'), false);
  assert.equal(isGameRelatedTranscript('turn the light down and call the waiter'), false);
});

test('accepts completion words only while waiting for cards', () => {
  assert.equal(isGameRelatedTranscript('done', { waitingForCards: true }), true);
  assert.equal(isGameRelatedTranscript('done', { waitingForCards: false }), false);
});
