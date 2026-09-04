import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const appSource = readFileSync(new URL("./app.js", import.meta.url), "utf8");
const indexSource = readFileSync(
  new URL("./index.html", import.meta.url),
  "utf8",
);
const stylesSource = readFileSync(
  new URL("./styles.css", import.meta.url),
  "utf8",
);

test("microphone controls stay outside the rotating turn control", () => {
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

test("voice controls touch the top while transcript and AI status sit at the bottom", () => {
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

test("voice selection excludes Marin and defaults to Cedar", () => {
  assert.doesNotMatch(indexSource, /<option value="marin"/);
  assert.match(indexSource, /<option value="cedar" selected>Cedar<\/option>/);
  assert.match(
    appSource,
    /voiceChoice\.options[\s\S]*?option\.value === settings\.voice\.name/,
  );
});

test("help and other share a row and other returns to the game", () => {
  assert.match(
    indexSource,
    /id="help-button"[\s\S]*?id="other-button"[\s\S]*?id="other-page"[\s\S]*?id="close-other-button"[^>]*>Back to game/,
  );
  assert.match(
    stylesSource,
    /\.action-menu \.help-button,[\s\S]*?\.action-menu \.other-button/,
  );
  assert.match(
    appSource,
    /otherButton\.addEventListener\("click"[\s\S]*?otherPage\.hidden = false[\s\S]*?closeOtherButton\.focus\(\)/,
  );
  assert.match(
    appSource,
    /closeOtherButton\.addEventListener\("click", closeOtherPage\)/,
  );
});

test("the buy back controls open and cancel without changing chips", () => {
  assert.match(
    indexSource,
    /id="buy-back-button"[^>]*>Buy back[\s\S]*?id="buy-back-panel"[^>]*hidden[\s\S]*?id="buy-back-amount"[^>]*type="number"[\s\S]*?id="cancel-buy-back-button"[^>]*>Cancel buy back/,
  );
  assert.match(
    appSource,
    /buyBackButton\.addEventListener\("click"[\s\S]*?openOtherPlayerPicker\("buy-back"\)/,
  );
  assert.match(
    appSource,
    /cancelBuyBackButton\.addEventListener\("click"[\s\S]*?cancelBuyBack\(\)[\s\S]*?buyBackButton\.focus\(\)/,
  );
});

test("other asks which player should leave the game", () => {
  assert.match(indexSource, /id="leave-game-button"[^>]*>Leave game/);
  assert.match(
    appSource,
    /leaveGameButton\.addEventListener\("click"[\s\S]*?openOtherPlayerPicker\("leave-game"\)/,
  );
  assert.match(appSource, /function viewPlayers\(\)[\s\S]*?!player\.leftGame/);
  assert.match(
    appSource,
    /function leaveGameForPlayer\(player\)[\s\S]*?Transition\.LEAVE_GAME[\s\S]*?animatePlayerLeaving\(player\.id\)/,
  );
});

test("other can add a named player with chosen starting chips", () => {
  assert.match(indexSource, /id="join-game-button"[^>]*>Add player/);
  assert.match(
    indexSource,
    /id="join-game-name"[^>]*type="text"[\s\S]*?id="join-game-chips"[^>]*type="number"[\s\S]*?During a hand, the new player looks folded/,
  );
  assert.match(
    appSource,
    /confirmJoinGameButton\.addEventListener\("click"[\s\S]*?Transition\.JOIN_GAME[\s\S]*?name,[\s\S]*?amount,/,
  );
  assert.match(
    appSource,
    /joinGameStatus\.textContent = .*sitting out this hand.*look folded/,
  );
  assert.match(appSource, /joiningPlayerAnimationId = playerId/);
});

test("setup accepts any whole player count of at least two", () => {
  assert.match(
    indexSource,
    /id="player-count"[^>]*type="number"[^>]*min="2"[^>]*step="1"/,
  );
  assert.doesNotMatch(indexSource, /id="player-count"[^>]*max=/);
  assert.doesNotMatch(appSource, /gameState\.players\.length >= 8/);
});

test("pressing Enter in setup does not start the game", () => {
  assert.match(
    appSource,
    /form\.addEventListener\("keydown"[\s\S]*?event\.key === "Enter"[\s\S]*?event\.preventDefault\(\)/,
  );
});

test("buy back confirmation requires a positive amount and restores an eliminated player", () => {
  assert.match(
    indexSource,
    /id="cancel-buy-back-button"[^>]*>Cancel buy back[\s\S]*?id="confirm-buy-back-button"[^>]*disabled[^>]*>Confirm buy back/,
  );
  assert.match(
    stylesSource,
    /\.other-page button:disabled[\s\S]*?background: #c8cbc9/,
  );
  assert.match(
    appSource,
    /confirmBuyBackButton\.disabled = !\(Number\(buyBackAmount\.value\) > 0\)/,
  );
  assert.match(
    appSource,
    /buyBackAmount\.addEventListener\("input", updateBuyBackConfirmButton\)/,
  );
  assert.match(
    appSource,
    /confirmBuyBackButton\.addEventListener\("click"[\s\S]*?viewPlayer\(buyBackPlayerId\)[\s\S]*?Transition\.REBUY[\s\S]*?renderGameState\(\)/,
  );
});

test("an eliminated player is automatically asked about buying back", () => {
  assert.match(indexSource, /id="buy-back-question"[^>]*hidden/);
  assert.match(
    appSource,
    /function playerNeedingBuyBackDecision\(\)[\s\S]*?player\.eliminated/,
  );
  assert.match(
    appSource,
    /function playerNeedingBuyBackDecision\(\)[\s\S]*?!player\.leftGame[\s\S]*?player\.eliminatedHandNumber === gameState\.handNumber/,
  );
  assert.match(
    appSource,
    /function openBuyBackPage\(player, automatically = false\)[\s\S]*?do you want to buy back into the game\?/,
  );
  assert.match(
    appSource,
    /playerNeedingBuyBack[\s\S]*?openBuyBackPage\(playerNeedingBuyBack, true\)/,
  );
});

test("in-game seat controls hide play controls and preserve the current game while reordering seats", () => {
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

test("locking the initial seats stores the game start time", () => {
  assert.match(appSource, /gameStartedAt,[\s\S]*?setGameStartedAt,/);
  assert.match(appSource, /export \{ gameStartedAt \}/);
  assert.match(
    appSource,
    /function lockSeatsAndStartGame\(\)[\s\S]*?setGameStartedAt\(\)/,
  );
});

test("live games are saved and can be resumed from setup", () => {
  assert.match(
    indexSource,
    /id="resume-game-button"[^>]*hidden>Resume saved game/,
  );
  assert.match(appSource, /const currentGameKey = "robodeal-current-game-v1"/);
  assert.match(
    appSource,
    /function saveCurrentGame\(\)[\s\S]*?gameSettings,[\s\S]*?gameState,[\s\S]*?seatAngles,[\s\S]*?lastTurnState/,
  );
  assert.match(
    appSource,
    /function renderGameState\(\)[\s\S]*?const playerNeedingBuyBack = playerNeedingBuyBackDecision\(\)[\s\S]*?GamePhase\.GAME_COMPLETE &&\s*!playerNeedingBuyBack[\s\S]*?clearSavedCurrentGame\(\);[\s\S]*?saveCurrentGame\(\)/,
  );
  assert.match(
    appSource,
    /function resumeSavedGame\(\)[\s\S]*?gameState = savedGame\.gameState[\s\S]*?renderGameState\(\)/,
  );
  assert.match(
    appSource,
    /resumeGameButton\.addEventListener\("click", resumeSavedGame\)/,
  );
});

test("community-card instructions tell the dealer to burn a card first", () => {
  assert.match(appSource, /Burn one card, then deal the flop/i);
  assert.match(appSource, /Burn one card, then deal the turn/i);
  assert.match(appSource, /Burn one card, then deal the river/i);
});

test("narrates every deal stage, showdown question, and winner result", () => {
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

test("voice can award or split the current showdown pot", () => {
  assert.match(appSource, /name: "chooseWinner"/);
  assert.match(appSource, /name: "splitPot"/);
  assert.match(
    appSource,
    /function currentShowdownPot\(\)[\s\S]*?eligiblePlayerNumbers/,
  );
  assert.match(
    appSource,
    /name === "chooseWinner"[\s\S]*?awardPot\(showdown\.potIndex, requestedPlayerNumbers\[0\]\)/,
  );
  assert.match(
    appSource,
    /name === "splitPot"[\s\S]*?awardSplitPot\(showdown\.potIndex, requestedPlayerNumbers\)/,
  );
});

test("voice can start the next hand from the completed-hand screen", () => {
  assert.match(appSource, /name: "nextHand"/);
  assert.match(
    appSource,
    /name === "nextHand"[\s\S]*?GamePhase\.HAND_COMPLETE[\s\S]*?startNewHand\(\)[\s\S]*?dealMessage\.textContent/,
  );
});

test("dismissing a deal prompt stops active narration and clears buffered audio", () => {
  assert.match(appSource, /voiceAgent\.send\(\{ type: "response\.cancel" \}\)/);
  assert.match(
    appSource,
    /voiceAgent\.send\(\{ type: "output_audio_buffer\.clear" \}\)/,
  );
  assert.match(
    appSource,
    /function cardsAreDealt\(\)[\s\S]*?stopDealNarration\(\);[\s\S]*?Transition\.CARDS_DEALT/,
  );
});

test("the raise panel starts at the engine-provided minimum raise", () => {
  assert.match(
    appSource,
    /const minimumRaiseBet = bounds\.minRaiseAdditionalChips/,
  );
  assert.match(appSource, /pendingBet = minimumRaiseBet/);
});
