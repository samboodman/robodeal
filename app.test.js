import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appSource = readFileSync(new URL('./app.js', import.meta.url), 'utf8');
const indexSource = readFileSync(
  new URL('./index.html', import.meta.url),
  'utf8',
);
const stylesSource = readFileSync(
  new URL('./styles.css', import.meta.url),
  'utf8',
);

test('microphone controls stay outside the rotating turn control', () => {
  assert.match(
    indexSource,
    /id="recording-button"[\s\S]*?<div id="turn-control"/,
  );
  assert.doesNotMatch(
    indexSource,
    /<div id="turn-control"[\s\S]*?id="recording-button"[\s\S]*?id="turn-indicator"/,
  );
  assert.match(
    indexSource,
    /id="voice-status"[\s\S]*?class="voice-controls"[\s\S]*?id="recording-button"/,
  );
  assert.match(
    stylesSource,
    /\.voice-controls \{[\s\S]*?position: fixed;[\s\S]*?left: 50%;[\s\S]*?justify-items: center;[\s\S]*?transform: translateX\(-50%\)/,
  );
});

test('voice controls touch the top while transcript and AI status sit at the bottom', () => {
  assert.match(stylesSource, /\.voice-controls \{[\s\S]*?top: 0;/);
  assert.match(
    stylesSource,
    /\.voice-status \{[\s\S]*?position: fixed;[\s\S]*?bottom: max\(12px, env\(safe-area-inset-bottom\)\)/,
  );
  assert.match(
    stylesSource,
    /\.voice-transcript \{[\s\S]*?bottom: calc\(max\(12px, env\(safe-area-inset-bottom\)\) \+ 46px\)/,
  );
});

test('voice selection excludes Marin and defaults to Cedar', () => {
  assert.doesNotMatch(indexSource, /<option value="marin"/);
  assert.match(indexSource, /<option value="cedar" selected>Cedar<\/option>/);
  assert.match(
    appSource,
    /voiceChoice\.options[\s\S]*?option\.value === settings\.voice\.name/,
  );
});

test('in-game seat controls hide play controls and preserve the current game while reordering seats', () => {
  assert.match(
    indexSource,
    /id="recording-button"[\s\S]*?id="seat-order-button"/,
  );
  assert.match(
    appSource,
    /function beginInGameSeatPositioning\(\)[\s\S]*?turnControl\.hidden = true;[\s\S]*?drawPlayerSeats\(\)/,
  );
  assert.match(
    appSource,
    /function reorderStatePlayersClockwise\(state\)[\s\S]*?state\.players = clockwisePlayerIds/,
  );
  assert.match(
    appSource,
    /function lockInGameSeats\(\)[\s\S]*?reorderStatePlayersClockwise\(gameState\)[\s\S]*?renderGameState\(\)/,
  );
});

test('locking the initial seats stores the game start time', () => {
  assert.match(appSource, /gameStartedAt,[\s\S]*?setGameStartedAt,/);
  assert.match(appSource, /export \{ gameStartedAt \}/);
  assert.match(
    appSource,
    /function lockSeatsAndStartGame\(\)[\s\S]*?setGameStartedAt\(\)/,
  );
});

test('live games are saved and can be resumed from setup', () => {
  assert.match(
    indexSource,
    /id="resume-game-button"[^>]*hidden>Resume saved game/,
  );
  assert.match(appSource, /const currentGameKey = 'robodeal-current-game-v1'/);
  assert.match(
    appSource,
    /function saveCurrentGame\(\)[\s\S]*?gameSettings,[\s\S]*?gameState,[\s\S]*?seatAngles,[\s\S]*?lastTurnState/,
  );
  assert.match(
    appSource,
    /function renderGameState\(\)[\s\S]*?GamePhase\.GAME_COMPLETE\) \{\s*clearSavedCurrentGame\(\);\s*\}[\s\S]*?saveCurrentGame\(\)/,
  );
  assert.match(
    appSource,
    /function resumeSavedGame\(\)[\s\S]*?gameState = savedGame\.gameState[\s\S]*?renderGameState\(\)/,
  );
  assert.match(
    appSource,
    /resumeGameButton\.addEventListener\('click', resumeSavedGame\)/,
  );
});

test('community-card instructions tell the dealer to burn a card first', () => {
  assert.match(appSource, /Burn one card, then deal the flop/i);
  assert.match(appSource, /Burn one card, then deal the turn/i);
  assert.match(appSource, /Burn one card, then deal the river/i);
});

test('narrates every deal stage, showdown question, and winner result', () => {
  assert.match(
    appSource,
    /GamePhase\.DEAL_FLOP[\s\S]*?narrate\(dealMessage\.textContent\)/,
  );
  assert.match(
    appSource,
    /GamePhase\.ALL_IN_RUNOUT[\s\S]*?narrate\(dealMessage\.textContent\)/,
  );
  assert.match(
    appSource,
    /function showPotWinnerPicker[\s\S]*?narrate\(question\)/,
  );
  assert.match(
    appSource,
    /function showHandCompleteFromGameState[\s\S]*?narrate\(`\$\{winnerNames\} won the hand\.`\)/,
  );
  assert.match(
    appSource,
    /function showGameWinner[\s\S]*?narrate\(`\$\{winner\.name\} won the hand and the game!`\)/,
  );
});

test('voice can award or split the current showdown pot', () => {
  assert.match(appSource, /name: 'chooseWinner'/);
  assert.match(appSource, /name: 'splitPot'/);
  assert.match(
    appSource,
    /function currentShowdownPot\(\)[\s\S]*?eligiblePlayerNumbers/,
  );
  assert.match(
    appSource,
    /name === 'chooseWinner'[\s\S]*?awardPot\(showdown\.potIndex, requestedPlayerNumbers\[0\]\)/,
  );
  assert.match(
    appSource,
    /name === 'splitPot'[\s\S]*?awardSplitPot\(showdown\.potIndex, requestedPlayerNumbers\)/,
  );
});

test('voice can start the next hand from the completed-hand screen', () => {
  assert.match(appSource, /name: 'nextHand'/);
  assert.match(
    appSource,
    /name === 'nextHand'[\s\S]*?GamePhase\.HAND_COMPLETE[\s\S]*?startNewHand\(\)[\s\S]*?dealMessage\.textContent/,
  );
});

test('dismissing a deal prompt stops active narration and clears buffered audio', () => {
  assert.match(appSource, /voiceAgent\.send\(\{ type: 'response\.cancel' \}\)/);
  assert.match(
    appSource,
    /voiceAgent\.send\(\{ type: 'output_audio_buffer\.clear' \}\)/,
  );
  assert.match(
    appSource,
    /function cardsAreDealt\(\)[\s\S]*?stopDealNarration\(\);[\s\S]*?Transition\.CARDS_DEALT/,
  );
});

test('the raise panel starts at the engine-provided minimum raise', () => {
  assert.match(
    appSource,
    /const minimumRaiseBet = bounds\.minRaiseAdditionalChips/,
  );
  assert.match(appSource, /pendingBet = minimumRaiseBet/);
});
