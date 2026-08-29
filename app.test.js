import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('./app.js', import.meta.url), 'utf8');

test('community-card instructions tell the dealer to burn a card first', () => {
  assert.match(appSource, /Burn one card, then deal the flop/i);
  assert.match(appSource, /Burn one card, then deal the turn/i);
  assert.match(appSource, /Burn one card, then deal the river/i);
});

test('dismissing a deal prompt stops active narration and clears buffered audio', () => {
  assert.match(appSource, /voiceAgent\.send\(\{ type: 'response\.cancel' \}\)/);
  assert.match(appSource, /voiceAgent\.send\(\{ type: 'output_audio_buffer\.clear' \}\)/);
  assert.match(appSource, /function cardsAreDealt\(\)[\s\S]*?stopDealNarration\(\);[\s\S]*?Transition\.CARDS_DEALT/);
});

test('the raise panel starts at the engine-provided minimum raise', () => {
  assert.match(appSource, /const minimumRaiseBet = bounds\.minRaiseAdditionalChips/);
  assert.match(appSource, /pendingBet = minimumRaiseBet/);
});
