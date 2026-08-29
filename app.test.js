import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const indexSource = readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const stylesSource = readFileSync(new URL('./styles.css', import.meta.url), 'utf8');

test('microphone controls stay outside the rotating turn control', () => {
  assert.match(indexSource, /id="recording-button"[\s\S]*?<div id="turn-control"/);
  assert.doesNotMatch(indexSource, /<div id="turn-control"[\s\S]*?id="recording-button"[\s\S]*?id="turn-indicator"/);
  assert.match(indexSource, /class="voice-controls"[\s\S]*?id="voice-status"[\s\S]*?id="recording-button"/);
  assert.match(stylesSource, /\.voice-controls \{[\s\S]*?position: fixed;[\s\S]*?left: 50%;[\s\S]*?justify-items: center;[\s\S]*?transform: translateX\(-50%\)/);
});

test('community-card instructions tell the dealer to burn a card first', () => {
  assert.match(appSource, /Burn one card, then deal the flop/i);
  assert.match(appSource, /Burn one card, then deal the turn/i);
  assert.match(appSource, /Burn one card, then deal the river/i);
});

test('narrates every deal stage, showdown question, and winner result', () => {
  assert.match(appSource, /GamePhase\.DEAL_FLOP[\s\S]*?narrate\(dealMessage\.textContent\)/);
  assert.match(appSource, /GamePhase\.ALL_IN_RUNOUT[\s\S]*?narrate\(dealMessage\.textContent\)/);
  assert.match(appSource, /function showPotWinnerPicker[\s\S]*?narrate\(question\)/);
  assert.match(appSource, /function showHandCompleteFromGameState[\s\S]*?narrate\(`\$\{winnerNames\} won the hand\.`\)/);
  assert.match(appSource, /function showGameWinner[\s\S]*?narrate\(`\$\{winner\.name\} won the hand and the game!`\)/);
});

test('voice can award or split the current showdown pot', () => {
  assert.match(appSource, /name: 'chooseWinner'/);
  assert.match(appSource, /name: 'splitPot'/);
  assert.match(appSource, /function currentShowdownPot\(\)[\s\S]*?eligiblePlayerNumbers/);
  assert.match(appSource, /name === 'chooseWinner'[\s\S]*?awardPot\(showdown\.potIndex, requestedPlayerNumbers\[0\]\)/);
  assert.match(appSource, /name === 'splitPot'[\s\S]*?awardSplitPot\(showdown\.potIndex, requestedPlayerNumbers\)/);
});

test('voice can start the next hand from the completed-hand screen', () => {
  assert.match(appSource, /name: 'nextHand'/);
  assert.match(appSource, /name === 'nextHand'[\s\S]*?GamePhase\.HAND_COMPLETE[\s\S]*?startNewHand\(\)[\s\S]*?dealMessage\.textContent/);
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
