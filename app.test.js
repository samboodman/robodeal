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

test("other is a large right-side control that replaces the action menu", () => {
  assert.match(
    indexSource,
    /id="other-button"[^>]*class="other-button"[^>]*>\s*Other\s*<\/button>[\s\S]*?id="other-action-menu"[^>]*hidden[\s\S]*?id="other-buy-back-button"[^>]*>\s*Buy back[\s\S]*?id="other-add-player-button"[^>]*>\s*Add player/,
  );
  assert.match(
    stylesSource,
    /#other-button \{[\s\S]*?position: fixed;[\s\S]*?right: 0;[\s\S]*?width: 84px;[\s\S]*?min-height: 92px/,
  );
  assert.match(
    stylesSource,
    /#other-action-menu \{[\s\S]*?grid-template-columns: 1fr;[\s\S]*?grid-template-rows: repeat\(4, 1fr\)/,
  );
  assert.match(
    appSource,
    /otherButton\.addEventListener\("click"[\s\S]*?otherPage\.hidden = true;[\s\S]*?openOtherMenu\(\)/,
  );
  assert.match(
    appSource,
    /function openOtherMenu\(\)[\s\S]*?otherButton\.textContent = "Back";[\s\S]*?actionMenu\.hidden = true;[\s\S]*?otherActionMenu\.hidden = false/,
  );
});

test("help is in the other menu and other becomes back while it is open", () => {
  assert.match(
    indexSource,
    /id="other-action-menu"[\s\S]*?id="other-add-player-button"[^>]*>\s*Add player\s*<\/button>[\s\S]*?id="help-button"[^>]*>\s*Help\s*<\/button>/,
  );
  assert.match(
    stylesSource,
    /\.action-menu \.help-button \{[\s\S]*?background: #2875c7/,
  );
  assert.match(
    appSource,
    /function closeOtherMenu\(\)[\s\S]*?otherButton\.textContent = "Other"/,
  );
});

test("timed turns store zero while disabled and seconds while enabled", () => {
  assert.match(
    indexSource,
    /id="use-timed-turns"[^>]*type="checkbox"[\s\S]*?Use timed turns[\s\S]*?id="turn-timer"[^>]*min="1"[^>]*value="30"/,
  );
  assert.match(
    appSource,
    /function updateTimedTurnsSetting\(\)[\s\S]*?timedTurnsSetting\.hidden = !useTimedTurnsCheckbox\.checked;[\s\S]*?turnTimerInput\.disabled = !useTimedTurnsCheckbox\.checked/,
  );
  assert.match(
    appSource,
    /timer: useTimedTurnsCheckbox\.checked \? Number\(turnTimerInput\.value\) : 0/,
  );
  assert.match(appSource, /timer: gameSettings\.timer/);
});

test("timed turns show a top-left hourglass and floored seconds", () => {
  assert.match(
    indexSource,
    /id="turn-timer-display"[\s\S]*?id="turn-timer-hourglass"[\s\S]*?id="turn-timer-seconds"[\s\S]*?id="turn-timer-action"/,
  );
  assert.match(
    stylesSource,
    /\.turn-timer-display \{[\s\S]*?position: fixed;[\s\S]*?top: 0;[\s\S]*?left: 0;/,
  );
  assert.match(
    stylesSource,
    /\.turn-timer-hourglass \{[\s\S]*?aspect-ratio: 1;[\s\S]*?background-size: contain/,
  );
  assert.match(
    appSource,
    /const hourglassImagePaths = Object\.freeze\([\s\S]*?ChatGPT Image Sep 6, 2026, 08_21_13 AM \(10\)\.png[\s\S]*?function updateTurnTimerDisplay\(\)[\s\S]*?Math\.floor\(millisecondsLeft \/ 1000\)[\s\S]*?Math\.floor\(\(1 - timerProgress\) \* 10\)[\s\S]*?hourglassImagePaths\[hourglassFrame\]/,
  );
  assert.match(
    appSource,
    /const colorProgress = Math\.max\([\s\S]*?millisecondsLeft - 5000[\s\S]*?turnTimerSeconds\.style\.color = `hsl\(\$\{Math\.round\(colorProgress \* 120\)\}deg 85% 48%\)`[\s\S]*?millisecondsLeft <= 5000/,
  );
  assert.match(
    appSource,
    /turnTimerAction\.textContent =\s*player && amountToCallForView\(player\) > 0 \? "FOLD" : "CHECK"/,
  );
  assert.match(
    stylesSource,
    /\.turn-timer-seconds\.is-expiring \{[\s\S]*?animation: turn-timer-seconds-flash 0\.3s[\s\S]*?@keyframes turn-timer-seconds-flash[\s\S]*?color: #e31b23[\s\S]*?color: #fffdf6/,
  );
});

test("the game table shows a live hand, blinds, and pot summary", () => {
  assert.match(
    indexSource,
    /id="game-summary"[^>]*class="game-summary"[^>]*aria-label="Game summary"/,
  );
  assert.match(
    stylesSource,
    /\.game-summary \{[\s\S]*?position: absolute;[\s\S]*?top: max\(10px, env\(safe-area-inset-top\)\);[\s\S]*?left: 50%/,
  );
  assert.match(
    appSource,
    /function updateGameSummary\(\)[\s\S]*?Hand \$\{gameState\.handNumber\}[\s\S]*?Blinds \$\{blindSummary\}[\s\S]*?Pot \$\{totalPotAmount\(\)\}/,
  );
  assert.match(
    appSource,
    /function renderGameState\(\)[\s\S]*?const phase = gameState\.phase;[\s\S]*?updateGameSummary\(\)/,
  );
});

test("the buy back controls open and cancel without changing chips", () => {
  assert.match(
    indexSource,
    /id="buy-back-button"[^>]*>\s*Buy back[\s\S]*?id="buy-back-panel"[^>]*hidden[\s\S]*?id="buy-back-amount"[^>]*type="number"[\s\S]*?id="cancel-buy-back-button"[^>]*>\s*Cancel buy back/,
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
    /joinGameStatus\.textContent\s*=\s*[\s\S]*?sitting out this hand[\s\S]*?look folded/,
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
    /id="cancel-buy-back-button"[^>]*>\s*Cancel buy back[\s\S]*?id="confirm-buy-back-button"[^>]*disabled[^>]*>\s*Confirm buy back/,
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

test("default seats place due left between two equally close players", () => {
  assert.match(
    appSource,
    /function initializeSeatAngles\(\) \{[\s\S]*?const seatStep = \(Math\.PI \* 2\) \/ players\.length;[\s\S]*?const seatJustBeforeLeft = Math\.floor\(\(players\.length - 2\) \/ 4\);[\s\S]*?Math\.PI - \(seatJustBeforeLeft \+ 0\.5\) \* seatStep/,
  );
});

test("dealer and blind markers use the engine's table roles", () => {
  assert.match(
    indexSource,
    /id="dealer-marker"[^>]*class="table-marker dealer-marker"[^>]*>\s*D\s*<\/div>[\s\S]*?id="small-blind-marker"[^>]*>\s*SB\s*<\/div>[\s\S]*?id="big-blind-marker"[^>]*>\s*BB\s*<\/div>/,
  );
  assert.match(
    appSource,
    /function updateTableMarkers\(\)[\s\S]*?playerId: gameState\.dealerId[\s\S]*?playerId: gameState\.smallBlindPlayerId[\s\S]*?playerId: gameState\.bigBlindPlayerId/,
  );
  assert.match(
    appSource,
    /const markersAtSeat = markers\.filter\([\s\S]*?otherEntry\.playerId === entry\.playerId[\s\S]*?markersAtSeat\.length === 1[\s\S]*?-42[\s\S]*?\(markerIndex - \(markersAtSeat\.length - 1\) \/ 2\) \* 84/,
  );
  assert.match(stylesSource, /\.dealer-marker \{[\s\S]*?background: #fffdf6/);
  assert.match(
    stylesSource,
    /\.small-blind-marker \{[\s\S]*?background: #2875c7/,
  );
  assert.match(
    stylesSource,
    /\.big-blind-marker \{[\s\S]*?background: #e5ba22/,
  );
});

test("markers follow each player's rotation and names clear their chip piles", () => {
  assert.match(
    appSource,
    /const markerPositionAtAngle = \(angle\) => \{[\s\S]*?const seatX = centerX \+ Math\.cos\(angle\) \* seatRadiusX;[\s\S]*?const seatY = centerY \+ Math\.sin\(angle\) \* seatRadiusY;[\s\S]*?x: seatX - Math\.cos\(angle\) \* 58,[\s\S]*?y: seatY - Math\.sin\(angle\) \* 58\s*\}[\s\S]*?x: seatX \+ Math\.sin\(angle\) \* sideOffset,[\s\S]*?y: seatY - Math\.cos\(angle\) \* sideOffset/,
  );
  assert.match(
    appSource,
    /marker\.style\.transform = `translate\(-50%, -50%\) rotate\(\$\{seatRotation\}rad\)`/,
  );
  assert.match(
    appSource,
    /const tallestChipStack = Math\.max\([\s\S]*?chipStack\.children\.length[\s\S]*?"--name-bottom"/,
  );
  assert.match(
    stylesSource,
    /bottom: var\(--name-bottom, calc\(100% \+ 2px\)\)/,
  );
  assert.match(
    appSource,
    /const clockwiseTravelAngle =[\s\S]*?const counterclockwiseTravelAngle =[\s\S]*?const travelAngle = markerMovesCounterclockwise[\s\S]*?\? -counterclockwiseTravelAngle[\s\S]*?const position = markerPositionAtAngle\(angle\)/,
  );
});

test("the current-player marker stays above the current player", () => {
  assert.match(
    indexSource,
    /id="current-player-marker"[^>]*class="table-marker current-player-marker"[^>]*>\s*TURN\s*<\/div>/,
  );
  assert.match(
    stylesSource,
    /\.current-player-marker \{[\s\S]*?width: 48px;[\s\S]*?background: #e34d2f/,
  );
  assert.match(
    appSource,
    /updateTableMarker\([\s\S]*?currentPlayerMarker,[\s\S]*?"currentPlayer",[\s\S]*?gameState\.actionPlayerId,[\s\S]*?true,/,
  );
  assert.match(
    appSource,
    /function updateTableMarker\(\s*marker,\s*role,\s*playerId,\s*sideOffset,\s*abovePlayer = false,?\s*\)/,
  );
});

test("undo reverses marker travel only when it restores a different player", () => {
  assert.match(
    appSource,
    /function undoLastTurn\(fromShowdown = false\) \{[\s\S]*?const actionPlayerIdBeforeUndo = gameState\.actionPlayerId;[\s\S]*?markerMovesCounterclockwise =[\s\S]*?actionPlayerIdBeforeUndo !== gameState\.actionPlayerId/,
  );
  assert.match(
    appSource,
    /function updateTableMarkers\(\)[\s\S]*?markerMovesCounterclockwise = false/,
  );
});

test("undo saves each engine state and can leave the winner screen", () => {
  assert.match(
    appSource,
    /function invokeGame\(action\) \{[\s\S]*?undoStack\.push\([\s\S]*?returnToSetup: gameState\.phase === GamePhase\.SETUP/,
  );
  assert.match(
    appSource,
    /const snapshot = undoStack\.pop\(\);[\s\S]*?if \(snapshot\.returnToSetup\)[\s\S]*?setupScreen\.hidden = false;[\s\S]*?gameWinnerScreen\.hidden = true;[\s\S]*?gameScreen\.hidden = false/,
  );
  assert.match(
    indexSource,
    /id="game-winner-undo-button"[^>]*>\s*Undo\s*<\/button>/,
  );
  assert.match(
    indexSource,
    /id="game-winner-setup-button"[^>]*>\s*Back to setup\s*<\/button>/,
  );
});

test("winner and setup exits stop microphone recording", () => {
  assert.match(
    appSource,
    /function stopRecordingForSetupOrWinner\(\) \{[\s\S]*?voiceAgent\?\.stopMicrophone\(\)\.finally\(updateRecordingButton\)/,
  );
  assert.match(
    appSource,
    /function showGameWinner\(winner\) \{[\s\S]*?stopRecordingForSetupOrWinner\(\)/,
  );
  assert.match(
    appSource,
    /if \(snapshot\.returnToSetup\) \{[\s\S]*?stopRecordingForSetupOrWinner\(\)/,
  );
});

test("undo is a large left-side control outside the action menu", () => {
  assert.match(
    indexSource,
    /id="undo-button"[^>]*class="undo-button"[^>]*disabled>\s*Undo\s*<\/button>[\s\S]*?<div id="turn-control"/,
  );
  assert.doesNotMatch(
    indexSource,
    /<div id="action-menu"[\s\S]*?id="undo-button"/,
  );
  assert.match(
    stylesSource,
    /#undo-button \{[\s\S]*?position: fixed;[\s\S]*?left: 0;[\s\S]*?width: 84px;[\s\S]*?min-height: 92px;[\s\S]*?border-left: 0/,
  );
  assert.match(
    appSource,
    /undoButton\.addEventListener\("click", \(\) => undoLastTurn\(\)\)/,
  );
});

test("one primary button changes between check and call", () => {
  assert.match(indexSource, /id="primary-action-button"[^>]*>Check<\/button>/);
  assert.doesNotMatch(
    indexSource,
    /id="call-action-button"|id="check-action-button"/,
  );
  assert.match(
    appSource,
    /primaryActionButton\.textContent = callIsAllIn[\s\S]*?minimumAllowedBet > 0[\s\S]*?"Check"/,
  );
  assert.match(
    appSource,
    /primaryActionButton\.addEventListener\("click"[\s\S]*?pendingBet = amountToCallForView\(player\)[\s\S]*?confirm\(\)/,
  );
});

test("raise panel has a red all-in button above the white panel", () => {
  assert.match(
    indexSource,
    /id="raise-panel"[\s\S]*?id="raise-total-value"[\s\S]*?<button[\s\S]*?id="all-in-raise-button"[^>]*hidden\s*>\s*All in\s*<\/button>/,
  );
  assert.match(
    stylesSource,
    /\.turn-indicator \{[\s\S]*?overflow: visible;[\s\S]*?\.all-in-raise-button \{[\s\S]*?position: absolute;[\s\S]*?top: -54px;[\s\S]*?background: #d9272e/,
  );
  assert.match(
    appSource,
    /allInRaiseButton\.addEventListener\("click", \(\) => \{[\s\S]*?pendingBet = player\.chips;[\s\S]*?confirm\(\)/,
  );
  assert.match(appSource, /allInRaiseButton\.hidden = !raiseMode/);
});

test("raise amount can be typed directly", () => {
  assert.match(
    indexSource,
    /<input[\s\S]*?id="raise-total-value"[\s\S]*?type="number"[\s\S]*?inputmode="numeric"/,
  );
  assert.match(
    appSource,
    /raiseTotalValue\.addEventListener\("change", \(\) => \{[\s\S]*?setRaiseTotal\(Number\(raiseTotalValue\.value\)\)/,
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
    /id="resume-game-button"[^>]*hidden\s*>\s*Resume saved game/,
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
