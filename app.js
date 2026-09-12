import { potsForBettingDisplay } from './pot-logic.js';
import {
  BettingLimit,
  createDebugGameState,
  createGameState,
  executeTransition,
  GamePhase,
  getAvailableActions,
  getBettingBounds,
  Transition,
} from './game-state.js';
import { DealerAgent } from './dealer-agent.js';
import { VoiceAgent } from './voice-agent.js';
import { restoredPlayerName } from './game-settings.js';
import { clockwisePlayerIds, normalizeSeatAngle, snapSeatAngle } from './seat-order.js';
import promptsText from './Prompts.json?raw';

const prompts = JSON.parse(promptsText);
const playerCount = document.querySelector('#player-count');
const playerNames = document.querySelector('#player-names');
const form = document.querySelector('#setup-form');
const message = document.querySelector('#message');
const dealerSelect = document.querySelector('#dealer');
const debugFeaturesSetting = document.querySelector('#debug-features-setting');
const debugFeaturesCheckbox = document.querySelector('#debug-features');
const debugOptions = document.querySelector('#debug-options');
const debugPresetSelect = document.querySelector('#debug-preset');
const enableAudioFileInputCheckbox = document.querySelector('#enable-audio-file-input');
const useBigBlindCheckbox = document.querySelector('#use-big-blind');
const useAnteCheckbox = document.querySelector('#use-ante');
const anteSetting = document.querySelector('#ante-setting');
const anteInput = document.querySelector('#ante');
const bettingLimitSelect = document.querySelector('#betting-limit');
const fixedLimitSetting = document.querySelector('#fixed-limit-setting');
const fixedLimitBetInput = document.querySelector('#fixed-limit-bet');
const setupScreen = document.querySelector('#setup-screen');
const voiceCustomizationScreen = document.querySelector('#voice-customization-screen');
const chipDenominationsScreen = document.querySelector('#chip-denominations-screen');
const gameScreen = document.querySelector('#game-screen');
const gameWinnerScreen = document.querySelector('#game-winner-screen');
const gameWinnerMessage = document.querySelector('#game-winner-message');
const playerSeats = document.querySelector('#player-seats');
const lockSeatsButton = document.querySelector('#lock-seats-button');
const turnControl = document.querySelector('#turn-control');
const turnIndicator = document.querySelector('#turn-indicator');
const undoButton = document.querySelector('#undo-button');
const actionMenu = document.querySelector('#action-menu');
const callActionButton = document.querySelector('#call-action-button');
const checkActionButton = document.querySelector('#check-action-button');
const foldActionButton = document.querySelector('#fold-action-button');
const allInActionButton = document.querySelector('#all-in-action-button');
const raiseActionButton = document.querySelector('#raise-action-button');
const raisePanel = document.querySelector('#raise-panel');
const raiseDecreaseButton = document.querySelector('#raise-decrease-button');
const raiseIncreaseButton = document.querySelector('#raise-increase-button');
const raiseTotalValue = document.querySelector('#raise-total-value');
const raiseShortcutButtons = [...document.querySelectorAll('[data-raise-adjustment]')];
const confirmRaiseButton = document.querySelector('#confirm-raise-button');
const cancelRaiseButton = document.querySelector('#cancel-raise-button');
const helpButton = document.querySelector('#help-button');
const buttonHelp = document.querySelector('#button-help');
const closeHelpButton = document.querySelector('#close-help-button');
const potValue = document.querySelector('#pot-value');
const sidePotValue = document.querySelector('#side-pot-value');
const winnerPicker = document.querySelector('#winner-picker');
const winnerQuestion = document.querySelector('#winner-question');
const winnerOptions = document.querySelector('#winner-options');
const showdownUndoButton = document.querySelector('#showdown-undo-button');
const dealPrompt = document.querySelector('#deal-prompt');
const dealMessage = document.querySelector('#deal-message');
const dealOkButton = document.querySelector('#deal-ok-button');
const recordingButton = document.querySelector('#recording-button');
const voiceStatus = document.querySelector('#voice-status');
const voiceTranscript = document.querySelector('#voice-transcript');
const startMicrophoneAutomaticallyCheckbox = document.querySelector('#start-microphone-automatically');
const showVoiceTranscriptCheckbox = document.querySelector('#show-voice-transcript');
const voiceCustomizationButton = document.querySelector('#voice-customization-button');
const voiceCustomizationBack = document.querySelector('#voice-customization-back');
const testVoiceButton = document.querySelector('#test-voice-button');
const voiceChoice = document.querySelector('#voice-choice');
const voiceAccent = document.querySelector('#voice-accent');
const voicePace = document.querySelector('#voice-pace');
const voicePreviewStatus = document.querySelector('#voice-preview-status');
const voiceAudioTest = document.querySelector('#voice-audio-test');
const voiceAudioFile = document.querySelector('#voice-audio-file');
const voiceAudioTestButton = document.querySelector('#voice-audio-test-button');
const voiceAudioTestStatus = document.querySelector('#voice-audio-test-status');
const chipDenominationsButton = document.querySelector('#chip-denominations-button');
const chipDenominationsBack = document.querySelector('#chip-denominations-back');
const chipDisplayModeButton = document.querySelector('#chip-display-mode');
const chipDenominationInputs = [...document.querySelectorAll('[data-chip-color]')];
const chipEnabledCheckboxes = [...document.querySelectorAll('[data-chip-enabled]')];
let gameSettings = null;
let gameState = null;
let pendingBet = 0;
let pendingFold = false;
let renderedPotLayerCount = 0;
let potAnimationTimer = null;
let lastTurnState = null;
let lastTurnEndedHandByFold = false;
let chipDisplayMode = 'value';
let screenWakeLock = null;
let voiceAgent = null;
let voicePreviewAgent = null;
let voiceConnectionPromise = null;
let dealerAgent = null;
let startMicrophoneAfterSpeech = false;
let raiseMode = false;
let seatingMode = false;
let seatAngles = {};
const lastGameSettingsKey = 'robodeal-last-game-settings';
const isLocalDebugEnvironment = ['localhost', '127.0.0.1'].includes(window.location.hostname);
const bettingLimitLabels = Object.freeze({
  [BettingLimit.NO_LIMIT]: 'No-Limit',
  [BettingLimit.POT_LIMIT]: 'Pot-Limit',
  [BettingLimit.FIXED_LIMIT]: 'Fixed-Limit',
});
const seatSnapDistance = Math.PI / 36;

function updateFixedLimitSetting() {
  fixedLimitSetting.hidden = bettingLimitSelect.value !== BettingLimit.FIXED_LIMIT;
}

function updateAnteSetting() {
  anteSetting.hidden = !useAnteCheckbox.checked;
  anteInput.disabled = !useAnteCheckbox.checked;
}

function updateDebugFeatures() {
  const debugFeaturesEnabled = isLocalDebugEnvironment && debugFeaturesCheckbox.checked;
  debugFeaturesSetting.hidden = !isLocalDebugEnvironment;
  debugOptions.hidden = !debugFeaturesEnabled;
  voiceAudioTest.hidden = !(debugFeaturesEnabled && enableAudioFileInputCheckbox.checked);

  if (!debugFeaturesEnabled) {
    debugPresetSelect.value = 'normal';
    enableAudioFileInputCheckbox.checked = false;
    voiceAudioFile.value = '';
    voiceAudioTestButton.disabled = true;
    voiceAudioTestStatus.textContent = '';
  }
}

const debugPresetPlayerCounts = Object.freeze({
  'two-pots': 3,
  'three-pots': 4,
  'all-in-runout': 3,
  'deal-flop': 3,
  showdown: 3,
  'hand-won': 3,
  'game-won': 2,
});

function selectDebugPreset() {
  const requiredPlayerCount = debugPresetPlayerCounts[debugPresetSelect.value];
  if (!requiredPlayerCount) return;
  playerCount.value = String(requiredPlayerCount);
  drawPlayerNames();
  useBigBlindCheckbox.checked = requiredPlayerCount >= 6;
}

function roundNumberFromGamePhase(phase) {
  if ([GamePhase.BETTING_PREFLOP, GamePhase.DEAL_FLOP].includes(phase)) return 1;
  if ([GamePhase.BETTING_FLOP, GamePhase.DEAL_TURN].includes(phase)) return 2;
  if ([GamePhase.BETTING_TURN, GamePhase.DEAL_RIVER].includes(phase)) return 3;
  return 4;
}

function viewPlayers() {
  return gameState?.players || [];
}

function viewPlayer(playerNumber) {
  return gameState?.players.find((player) => player.id === playerNumber);
}

function viewPlayerNumber(player) {
  return player.id;
}

function viewActionPlayerNumber() {
  return gameState?.actionPlayerId ?? null;
}

function viewRoundNumber() {
  return gameState ? gameState.round || roundNumberFromGamePhase(gameState.phase) : 1;
}

function viewHighestRoundBet() {
  return gameState?.highestRoundBet || 0;
}

function viewPots() {
  const pots = gameState?.pots || [];
  const betting = gameState && [
    GamePhase.BETTING_PREFLOP,
    GamePhase.BETTING_FLOP,
    GamePhase.BETTING_TURN,
    GamePhase.BETTING_RIVER,
  ].includes(gameState.phase);
  return betting ? potsForBettingDisplay(pots) : pots;
}

function viewIsGameWon() {
  return Boolean(gameState && [GamePhase.HAND_COMPLETE, GamePhase.GAME_COMPLETE].includes(gameState.phase));
}

function amountToCallForView(player) {
  return Math.min(Math.max(0, viewHighestRoundBet() - player.roundBet), player.chips);
}

function bettingBoundsForView(player) {
  return player && gameState
    ? getBettingBounds(gameState, viewPlayerNumber(player))
    : { callAmount: 0, minRaiseAdditionalChips: 0, maxAdditionalChips: 0 };
}

function isLegalPendingBet(player, amount) {
  const callAmount = amountToCallForView(player);
  if (amount === callAmount) return true;
  const actions = currentGameActions();
  if (amount === player.chips && actions.some(({ type }) => type === Transition.ALL_IN)) return true;
  const betAction = actions.find(({ type }) => type === Transition.BET);
  return Boolean(
    betAction
    && amount >= betAction.minAdditionalChips
    && amount <= betAction.maxAdditionalChips,
  );
}

function invokeGame(action, { narrate = false, origin = 'ui' } = {}) {
  if (!gameState) throw new Error('The game state has not been initialized.');
  const stateBefore = narrate ? getVoiceSnapshot() : null;
  gameState = executeTransition(gameState, action);
  if (narrate && voiceAgent?.connected) {
    const stateAfter = getVoiceSnapshot();
    queueMicrotask(() => {
      requestDealerNarration({
        type: 'state_transition',
        origin,
        action,
        stateBefore,
        stateAfter,
      }).catch((error) => {
        setVoiceStatus(`AI error: ${error.message}`);
      });
    });
  }
  return gameState;
}

function currentGameActions() {
  return gameState ? getAvailableActions(gameState) : [];
}

function selectedVoiceSettings() {
  return {
    name: voiceChoice.value,
    accent: voiceAccent.value,
    pace: voicePace.value,
  };
}

function updateChipDisplayModeButton() {
  const showsChipPile = chipDisplayMode === 'pile';
  chipDisplayModeButton.textContent = `Money display: ${showsChipPile ? 'Pile of chips' : 'Value'}`;
  chipDisplayModeButton.setAttribute('aria-pressed', String(showsChipPile));
}

function selectedChipDenominations() {
  return Object.fromEntries(chipDenominationInputs.map((input) => [
    input.dataset.chipColor,
    chipEnabledCheckboxes.find((checkbox) => checkbox.dataset.chipEnabled === input.dataset.chipColor)?.checked
      ? Math.max(1, Number(input.value) || 1)
      : null,
  ]));
}

function updateChipDenominationAvailability(checkbox) {
  const row = checkbox.closest('.chip-denomination-row');
  const valueInput = row.querySelector('[data-chip-color]');
  const status = checkbox.nextElementSibling;
  valueInput.disabled = !checkbox.checked;
  row.classList.toggle('unused', !checkbox.checked);
  status.textContent = checkbox.checked ? 'Use' : 'Do not use';
}

function restoreChipDenominations(savedDenominations) {
  if (!savedDenominations || typeof savedDenominations !== 'object') return;
  chipDenominationInputs.forEach((input) => {
    const color = input.dataset.chipColor;
    if (!Object.hasOwn(savedDenominations, color)) return;
    const savedDenomination = savedDenominations[color];
    const checkbox = chipEnabledCheckboxes.find((candidate) => candidate.dataset.chipEnabled === color);
    checkbox.checked = savedDenomination !== null && savedDenomination !== false;
    const savedValue = Number(savedDenomination);
    if (Number.isFinite(savedValue) && savedValue >= 1) input.value = savedValue;
    updateChipDenominationAvailability(checkbox);
  });
}

function getLastGameSettings() {
  try {
    const savedGame = JSON.parse(localStorage.getItem(lastGameSettingsKey));
    if (!savedGame || typeof savedGame !== 'object' || !savedGame.settings) return null;
    return savedGame;
  } catch {
    return null;
  }
}

function restoreLastGameSettings() {
  const savedGame = getLastGameSettings();
  const settings = savedGame?.settings;
  if (!settings || !Number.isInteger(settings.playerCount) || settings.playerCount < 2 || settings.playerCount > 8) return;

  const smallBlindInput = document.querySelector('#small-blind');
  const smallBlindIncreaseInput = document.querySelector('#small-blind-increase');
  const smallBlind = Number.isInteger(settings.smallBlind) && settings.smallBlind >= 0
    ? settings.smallBlind
    : Number(smallBlindInput.value);
  const smallBlindIncrease = Number.isInteger(settings.smallBlindIncrease) && settings.smallBlindIncrease >= 0
    ? settings.smallBlindIncrease
    : Number(smallBlindIncreaseInput.value);

  playerCount.value = settings.playerCount;
  document.querySelector('#starting-money').value = settings.startingMoney;
  smallBlindInput.value = smallBlind;
  smallBlindIncreaseInput.value = smallBlindIncrease;
  useBigBlindCheckbox.checked = settings.useBigBlind ?? settings.playerCount >= 6;
  useAnteCheckbox.checked = settings.useAnte === true;
  if (Number.isInteger(settings.ante) && settings.ante > 0) anteInput.value = settings.ante;
  updateAnteSetting();
  bettingLimitSelect.value = Object.values(BettingLimit).includes(settings.bettingLimit)
    ? settings.bettingLimit
    : BettingLimit.NO_LIMIT;
  fixedLimitBetInput.value = Number.isInteger(settings.fixedLimitBet) && settings.fixedLimitBet > 0
    ? settings.fixedLimitBet
    : Math.max(1, smallBlind * 2 || 1);
  updateFixedLimitSetting();
  drawPlayerNames();

  [...playerNames.querySelectorAll('input')].forEach((input, index) => {
    input.value = restoredPlayerName(settings.playerNames?.[index], index + 1);
  });
  drawDealerOptions(String(settings.dealerNumber));
  dealerSelect.value = String(settings.dealerNumber);
  chipDisplayMode = settings.chipDisplayMode === 'pile' ? 'pile' : 'value';
  updateChipDisplayModeButton();
  restoreChipDenominations(settings.chipDenominations);
  if (settings.voice) {
    voiceChoice.value = settings.voice.name || voiceChoice.value;
    voiceAccent.value = settings.voice.accent || voiceAccent.value;
    voicePace.value = settings.voice.pace || voicePace.value;
  }

  message.textContent = 'Last game settings restored.';
}

function saveLastGameSettings() {
  try {
    localStorage.setItem(lastGameSettingsKey, JSON.stringify({ settings: gameSettings }));
  } catch {}
}

async function keepScreenAwake() {
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;

  try {
    screenWakeLock = await navigator.wakeLock.request('screen');
    screenWakeLock.addEventListener('release', () => {
      screenWakeLock = null;
    }, { once: true });
  } catch (error) {
    console.info('Screen wake lock was not available:', error.message);
  }
}

async function allowScreenToSleep() {
  await screenWakeLock?.release();
  screenWakeLock = null;
}

function totalPotAmount() {
  return viewPots().reduce((total, potLayer) => total + potLayer.amount, 0);
}

function potLayerName(index) {
  return index === 0 ? 'Main pot' : `Side pot ${index}`;
}

function drawPotLayers(layerCount, animateNewLayer = false) {
  const visibleLayers = viewPots().slice(0, layerCount);
  const activeLayerIndex = visibleLayers.length - 1;
  const archivedLayerIndexes = visibleLayers
    .slice(0, -1)
    .map((_, index) => index)
    .reverse();
  const existingArchivedLayers = new Map(
    [...sidePotValue.children].map((element) => [Number(element.dataset.layerIndex), element]),
  );

  archivedLayerIndexes.forEach((layerIndex, stackIndex) => {
    let amount = existingArchivedLayers.get(layerIndex);
    const isNewArchivedLayer = !amount;
    if (!amount) {
      amount = document.createElement('span');
      amount.dataset.layerIndex = layerIndex;
      sidePotValue.append(amount);
    }

    amount.textContent = visibleLayers[layerIndex].amount;
    amount.setAttribute('aria-label', `${potLayerName(layerIndex)}: ${visibleLayers[layerIndex].amount}`);
    amount.style.setProperty('--stack-index', stackIndex);
    existingArchivedLayers.delete(layerIndex);

    if (animateNewLayer && isNewArchivedLayer && layerIndex === activeLayerIndex - 1) {
      amount.classList.add('pot-layer-archiving');
      requestAnimationFrame(() => {
        requestAnimationFrame(() => amount.classList.remove('pot-layer-archiving'));
      });
    }
  });

  existingArchivedLayers.forEach((element) => element.remove());
  sidePotValue.hidden = archivedLayerIndexes.length === 0;
  sidePotValue.setAttribute(
    'aria-label',
    archivedLayerIndexes.length === 0
      ? 'No completed pots'
      : `Completed pots: ${archivedLayerIndexes.map((index) => `${potLayerName(index)}, ${visibleLayers[index].amount}`).join('. ')}`,
  );

  const activeLayer = visibleLayers[activeLayerIndex];
  if (!activeLayer) {
    potValue.textContent = 0;
    potValue.setAttribute('aria-label', 'Pot: 0');
    return;
  }

  potValue.textContent = animateNewLayer ? 0 : activeLayer.amount;
  potValue.setAttribute('aria-label', `${potLayerName(activeLayerIndex)}: ${activeLayer.amount}`);
  if (animateNewLayer) {
    potValue.classList.remove('pot-value-entering');
    void potValue.offsetWidth;
    potValue.classList.add('pot-value-entering');
  } else {
    potValue.classList.remove('pot-value-entering');
  }
}

function continuePotLayerAnimation() {
  potAnimationTimer = null;
  if (viewPots().length <= renderedPotLayerCount) {
    drawPotLayers(renderedPotLayerCount);
    return;
  }

  renderedPotLayerCount += 1;
  drawPotLayers(renderedPotLayerCount, true);
  potAnimationTimer = setTimeout(() => {
    potAnimationTimer = null;
    drawPotLayers(renderedPotLayerCount);
    updatePotDisplay();
  }, 600);
}

function updatePotDisplay() {
  const targetLayerCount = viewPots().length;

  if (targetLayerCount < renderedPotLayerCount || targetLayerCount === 0) {
    clearTimeout(potAnimationTimer);
    potAnimationTimer = null;
    renderedPotLayerCount = targetLayerCount;
    drawPotLayers(renderedPotLayerCount);
    return;
  }

  if (renderedPotLayerCount === 0) {
    renderedPotLayerCount = 1;
    drawPotLayers(renderedPotLayerCount);
  }

  if (targetLayerCount > renderedPotLayerCount && potAnimationTimer === null) {
    potAnimationTimer = setTimeout(continuePotLayerAnimation, 120);
  } else if (targetLayerCount === renderedPotLayerCount && potAnimationTimer === null) {
    drawPotLayers(renderedPotLayerCount);
  }
}

function setVoiceTranscript(text) {
  const shouldShow = Boolean(gameSettings?.showVoiceTranscript);
  voiceTranscript.textContent = shouldShow ? text : '';
  voiceTranscript.hidden = !shouldShow || !text;
}

function setVoiceStatus(text) {
  const normalizedText = String(text || '').toLowerCase();
  let state = 'connected';
  if (normalizedText.includes('thinking') || normalizedText.includes('processing')) state = 'thinking';
  else if (normalizedText.includes('applying') || normalizedText.includes('action')) state = 'acting';
  else if (normalizedText.includes('speaking')) state = 'speaking';
  else if (normalizedText.includes('listening')) state = 'listening';
  else if (normalizedText.includes('error') || normalizedText.includes('could not') || normalizedText.includes('unavailable')) state = 'error';
  else if (normalizedText.includes('disconnect') || normalizedText.includes('ended')) state = 'disconnected';
  else if (normalizedText.includes('off')) state = 'off';

  voiceStatus.textContent = text;
  voiceStatus.dataset.state = state;
}

function recordVoiceLatency(timing) {
  const history = window.__robodealLatencyHistory || [];
  history.push(timing);
  window.__robodealLatencyHistory = history.slice(-20);
  console.info('[RoboDeal latency]', JSON.stringify(timing));
}

function updateRecordingButton() {
  const recording = Boolean(voiceAgent?.recording);
  recordingButton.setAttribute('aria-pressed', String(recording));
  recordingButton.textContent = recording ? 'Stop recording' : 'Start recording';
}

function getVoiceSnapshot() {
  const currentPlayerNumber = viewActionPlayerNumber();
  const player = viewPlayer(currentPlayerNumber) || null;
  const maximumBet = bettingBoundsForView(player).maxAdditionalChips;
  const undoFromShowdown = !winnerPicker.hidden;
  return {
    game: {
      variant: "Texas Hold'em",
      startingStack: gameSettings?.startingMoney ?? null,
      ante: {
        enabled: Boolean(gameSettings?.useAnte),
        amount: gameSettings?.useAnte ? gameSettings.ante : 0,
      },
      smallBlind: gameState?.smallBlind ?? gameSettings?.smallBlind ?? null,
      bigBlind: {
        enabled: Boolean(gameState?.useBigBlind ?? gameSettings?.useBigBlind),
        amount: (gameState?.useBigBlind ?? gameSettings?.useBigBlind)
          ? (gameState?.smallBlind ?? gameSettings?.smallBlind ?? 0) * 2
          : 0,
      },
      smallBlindIncrease: gameState?.smallBlindIncrease ?? gameSettings?.smallBlindIncrease ?? 0,
      handNumber: gameState?.handNumber ?? 0,
      dealer: viewPlayer(gameState?.dealerId) || null,
      smallBlindPlayer: viewPlayer(gameState?.smallBlindPlayerId) || null,
      bigBlindPlayer: viewPlayer(gameState?.bigBlindPlayerId) || null,
    },
    phase: gameState?.phase || (gameScreen.hidden ? 'setup' : !dealPrompt.hidden ? 'waiting for cards' : !winnerPicker.hidden ? 'choosing winner' : 'betting'),
    round: ['preflop', 'flop', 'turn', 'river'][viewRoundNumber() - 1] || 'between hands',
    bettingLimit: gameState?.bettingLimit || gameSettings?.bettingLimit || BettingLimit.NO_LIMIT,
    fixedLimitBet: gameState?.bettingLimit === BettingLimit.FIXED_LIMIT
      ? gameState.fixedLimitBet
      : null,
    currentPlayerNumber,
    currentPlayer: player ? {
      name: player.name,
      chips: player.chips,
      roundBet: player.roundBet,
      amountToCall: amountToCallForView(player),
      maximumAdditionalBet: maximumBet,
      canGoAllIn: maximumBet === player.chips,
    } : null,
    highestRoundBet: viewHighestRoundBet(),
    pendingBet,
    pendingFold,
    canUndo: !gameScreen.hidden
      && dealPrompt.hidden
      && gameWinnerScreen.hidden
      && !viewIsGameWon()
      && canUndoLastTurn(undoFromShowdown),
    pot: totalPotAmount(),
    availableActions: currentGameActions(),
    dealInstruction: dealPrompt.hidden ? null : dealMessage.textContent,
    players: viewPlayers().map((candidate) => ({
      number: viewPlayerNumber(candidate),
      name: candidate.name,
      chips: candidate.chips,
      folded: candidate.folded,
      eliminated: candidate.eliminated,
    })),
  };
}

function voiceTool(name, description, properties = {}, required = []) {
  return {
    type: 'function',
    name,
    description,
    parameters: {
      type: 'object',
      properties: {
        ...properties,
        narration: { type: 'string', description: prompts.toolDescriptions.narration },
      },
      required: [...required, 'narration'],
      additionalProperties: false,
    },
  };
}

const voiceTools = [
  voiceTool('check', prompts.toolDescriptions.check),
  voiceTool('call', prompts.toolDescriptions.call),
  voiceTool('bet', prompts.toolDescriptions.bet, { total: { type: 'number', description: prompts.toolDescriptions.betTotal } }, ['total']),
  voiceTool('raise', prompts.toolDescriptions.raise, { amount: { type: 'number', description: prompts.toolDescriptions.raiseAmount } }, ['amount']),
  voiceTool('fold', prompts.toolDescriptions.fold),
  voiceTool('allIn', prompts.toolDescriptions.allIn),
  voiceTool('cardsDealt', prompts.toolDescriptions.cardsDealt),
  voiceTool('undo', prompts.toolDescriptions.undo),
];

function executeVoiceTool(name, args) {
  const finish = (result) => ({ ...result, stateAfter: getVoiceSnapshot() });
  const actor = (player) => ({ id: player.id, name: player.name });

  if (name === 'undo') {
    const fromShowdown = !winnerPicker.hidden;
    if (gameScreen.hidden || !dealPrompt.hidden || !gameWinnerScreen.hidden || viewIsGameWon() || !canUndoLastTurn(fromShowdown)) {
      return finish({ ok: false, errorCode: 'NOTHING_TO_UNDO' });
    }
    const restoredPlayer = lastTurnState.players
      .find((player) => player.id === lastTurnState.actionPlayerId) || null;
    undoLastTurn(fromShowdown, false);
    return finish({
      ok: true,
      action: { type: 'undo', restoredActionPlayer: restoredPlayer ? actor(restoredPlayer) : null },
    });
  }

  if (name === 'cardsDealt') {
    const phaseBefore = gameState?.phase || null;
    if (!cardsAreDealt(false)) return finish({ ok: false, errorCode: 'NOT_WAITING_FOR_CARDS' });
    return finish({ ok: true, action: { type: 'cards_dealt', phaseBefore, phaseAfter: gameState.phase } });
  }

  const currentPlayerNumber = viewActionPlayerNumber();
  const player = viewPlayer(currentPlayerNumber);
  if (!player) return finish({ ok: false, errorCode: 'NO_CURRENT_PLAYER' });

  if (gameScreen.hidden || !dealPrompt.hidden || !winnerPicker.hidden || !gameWinnerScreen.hidden) {
    return finish({ ok: false, errorCode: 'BETTING_ACTION_UNAVAILABLE' });
  }

  const amountToCall = amountToCallForView(player);
  const maximumBet = bettingBoundsForView(player).maxAdditionalChips;
  const legalActions = currentGameActions();
  if (name === 'fold') {
    foldCurrentPlayer();
    confirm(false);
    return finish({ ok: true, action: { type: 'fold', actor: actor(player) } });
  }
  if (name === 'check') {
    if (amountToCall > 0) {
      return finish({
        ok: false,
        errorCode: 'CHIPS_OWED',
        details: { actor: actor(player), amountToCall },
      });
    }
    betCurrentPlayer(0);
    confirm(false);
    return finish({ ok: true, action: { type: 'check', actor: actor(player) } });
  }
  if (name === 'call') {
    if (amountToCall <= 0) {
      return finish({ ok: false, errorCode: 'NOTHING_TO_CALL', details: { actor: actor(player) } });
    }
    betCurrentPlayer(amountToCall);
    confirm(false);
    return finish({
      ok: true,
      action: { type: 'call', actor: actor(player), chipsMoved: amountToCall },
    });
  }
  if (name === 'allIn') {
    if (!legalActions.some(({ type }) => type === Transition.ALL_IN)) {
      return finish({
        ok: false,
        errorCode: 'ALL_IN_NOT_LEGAL',
        details: {
          actor: actor(player),
          bettingLimit: gameState.bettingLimit,
          maximumAdditionalBet: maximumBet,
        },
      });
    }
    pendingFold = false;
    const amount = player.chips;
    betCurrentPlayer(amount);
    confirm(false);
    return finish({
      ok: true,
      action: { type: 'all_in', actor: actor(player), chipsMoved: amount },
    });
  }
  if (name === 'bet') {
    const total = Number(args.total);
    const amount = total - player.roundBet;
    if (!Number.isInteger(total) || !isLegalPendingBet(player, amount)) {
      return finish({
        ok: false,
        errorCode: 'ILLEGAL_BET_TOTAL',
        details: {
          requestedTotal: args.total,
          currentRoundBet: player.roundBet,
          minimumAdditionalBet: bettingBoundsForView(player).minRaiseAdditionalChips,
          maximumTotal: player.roundBet + maximumBet,
          bettingLimit: gameState.bettingLimit,
        },
      });
    }
    if (amount === player.chips) {
      betCurrentPlayer(amount);
      confirm(false);
      return finish({
        ok: true,
        action: { type: 'all_in', actor: actor(player), chipsMoved: amount, requestedAs: 'bet', total },
      });
    }
    betCurrentPlayer(amount);
    confirm(false);
    return finish({
      ok: true,
      action: { type: 'bet', actor: actor(player), chipsMoved: amount, totalRoundBet: total },
    });
  }
  if (name === 'raise') {
    const raiseAmount = Number(args.amount);
    const amount = amountToCall + raiseAmount;
    if (!Number.isInteger(raiseAmount) || raiseAmount <= 0 || !isLegalPendingBet(player, amount)) {
      return finish({
        ok: false,
        errorCode: 'ILLEGAL_RAISE',
        details: {
          requestedRaise: args.amount,
          amountToCall,
          minimumRaise: Math.max(0, bettingBoundsForView(player).minRaiseAdditionalChips - amountToCall),
          maximumRaise: Math.max(0, maximumBet - amountToCall),
          bettingLimit: gameState.bettingLimit,
        },
      });
    }
    if (amount === player.chips) {
      betCurrentPlayer(amount);
      confirm(false);
      return finish({
        ok: true,
        action: { type: 'all_in', actor: actor(player), chipsMoved: amount, requestedAs: 'raise', raiseAmount },
      });
    }
    const total = player.roundBet + amount;
    betCurrentPlayer(amount);
    confirm(false);
    return finish({
      ok: true,
      action: {
        type: 'raise',
        actor: actor(player),
        chipsMoved: amount,
        callAmount: amountToCall,
        raiseAmount,
        totalRoundBet: total,
      },
    });
  }
  return finish({ ok: false, errorCode: 'UNKNOWN_ACTION', details: { requestedTool: name } });
}

function getDealerAgent() {
  if (!dealerAgent) {
    dealerAgent = new DealerAgent({
      getGameState: getVoiceSnapshot,
      tools: voiceTools,
      executeTool: executeVoiceTool,
      onStatus: setVoiceStatus,
    });
  }
  return dealerAgent;
}

async function requestDealerNarration(sourceEvent, recentConversation = []) {
  const result = await getDealerAgent().run(sourceEvent, recentConversation);
  if (result.speak && result.utterance) voiceAgent?.speak(result.utterance, null, result.timing);
  else setVoiceStatus(voiceAgent?.idleStatus() || 'Microphone off');
  return result;
}

async function connectVoiceAgent() {
  if (voiceAgent?.connected) return voiceAgent;
  if (voiceConnectionPromise) return voiceConnectionPromise;

  voiceAgent?.disconnect();
  voiceAgent = new VoiceAgent({
    onSpeculativeDelegation: ({ transcript, recentConversation }) => getDealerAgent().prepare({
      type: 'voice_utterance',
      transcript,
    }, recentConversation),
    onDelegation: ({ transcript, recentConversation, preparedTurn }) => getDealerAgent().run({
      type: 'voice_utterance',
      transcript,
    }, recentConversation, preparedTurn),
    onTranscript: setVoiceTranscript,
    onLatency: recordVoiceLatency,
    onStatus: (status) => {
      setVoiceStatus(status);
      if (!startMicrophoneAfterSpeech || status !== 'Microphone off') return;

      startMicrophoneAfterSpeech = false;
      voiceAgent.startMicrophone()
        .then(updateRecordingButton)
        .catch((error) => {
          const errorMessage = `Voice unavailable: ${error.message}`;
          setVoiceStatus(errorMessage);
          setVoiceTranscript(errorMessage);
      });
    },
  });
  const voice = gameSettings?.voice || selectedVoiceSettings();
  voiceConnectionPromise = voiceAgent.connect(voice.name || voiceChoice.value, {
    accent: voice.accent,
    pace: voice.pace,
  })
    .then(() => voiceAgent)
    .finally(() => { voiceConnectionPromise = null; });
  return voiceConnectionPromise;
}

async function toggleRecording() {
  startMicrophoneAfterSpeech = false;
  try {
    const agent = await connectVoiceAgent();
    if (agent.recording) await agent.stopMicrophone();
    else await agent.startMicrophone();
  } catch (error) {
    const errorMessage = `Voice unavailable: ${error.message}`;
    setVoiceStatus(errorMessage);
    setVoiceTranscript(errorMessage);
  }
  updateRecordingButton();
}

async function previewVoice() {
  testVoiceButton.disabled = true;
  voicePreviewStatus.textContent = 'Loading voice…';
  voicePreviewAgent?.disconnect();
  voicePreviewAgent = new VoiceAgent({
    onStatus: (status) => { voicePreviewStatus.textContent = status; },
  });
  try {
    await voicePreviewAgent.connect(voiceChoice.value, { preview: true });
    voicePreviewAgent.speak(prompts.voicePreviewText);
    window.setTimeout(() => {
      voicePreviewAgent?.disconnect();
      voicePreviewStatus.textContent = '';
      testVoiceButton.disabled = false;
    }, 5_000);
  } catch (error) {
    voicePreviewStatus.textContent = `Voice preview could not start: ${error.message}`;
    testVoiceButton.disabled = false;
  }
}

async function testVoiceWithAudioFile() {
  const file = voiceAudioFile.files[0];
  if (!file) return;
  voiceAudioTestButton.disabled = true;
  voiceAudioTestStatus.textContent = 'Sending audio…';
  try {
    const agent = await connectVoiceAgent();
    await agent.playAudioFile(file);
    voiceAudioTestStatus.textContent = 'Audio sent through the Realtime input path.';
  } catch (error) {
    voiceAudioTestStatus.textContent = `Audio test failed: ${error.message}`;
  } finally {
    voiceAudioTestButton.disabled = !voiceAudioFile.files[0];
  }
}

function drawPlayerNames() {
  const existingNames = [...playerNames.querySelectorAll('input')].map((input) => input.value);
  const selectedDealer = dealerSelect.value || '1';
  playerNames.replaceChildren();

  for (let number = 1; number <= Number(playerCount.value); number += 1) {
    const row = document.createElement('div');
    row.className = 'player-row';
    const seat = document.createElement('span');
    seat.className = 'seat';
    seat.textContent = `${number}.`;
    const input = document.createElement('input');
    input.type = 'text';
    input.placeholder = `Player ${number}`;
    input.value = existingNames[number - 1] || '';
    input.setAttribute('aria-label', `Name for player ${number}`);
    input.addEventListener('input', () => drawDealerOptions());
    row.append(seat, input);
    playerNames.append(row);
  }

  drawDealerOptions(selectedDealer);
}

function drawDealerOptions(selectedDealer = dealerSelect.value || '1') {
  dealerSelect.replaceChildren();
  const names = [...playerNames.querySelectorAll('input')];

  names.forEach((input, index) => {
    const number = index + 1;
    const option = document.createElement('option');
    option.value = number;
    option.textContent = input.value || `Player ${number}`;
    dealerSelect.append(option);
  });

  dealerSelect.value = selectedDealer;
}

function makePlayers() {
  const names = [...playerNames.querySelectorAll('input')];
  const players = names.map((input, index) => ({
    id: index + 1,
    name: input.value || `Player ${index + 1}`,
    chips: Number(document.querySelector('#starting-money').value),
  }));

  gameState = createGameState({
    players,
    smallBlind: gameSettings.smallBlind,
    smallBlindIncrease: gameSettings.smallBlindIncrease,
    dealerId: gameSettings.dealerNumber,
    useBigBlind: gameSettings.useBigBlind,
    bettingLimit: gameSettings.bettingLimit,
    fixedLimitBet: gameSettings.fixedLimitBet,
  });
}

function makePlayerChipPiles(amount) {
  const container = document.createElement('div');
  container.className = 'player-chip-piles';
  container.setAttribute('aria-hidden', 'true');
  const allowedColors = new Set(chipDenominationInputs.map((input) => input.dataset.chipColor));
  const denominations = Object.entries(gameSettings.chipDenominations || {})
    .filter(([color, value]) => allowedColors.has(color) && Number.isFinite(Number(value)) && Number(value) > 0)
    .map(([color, value]) => ({ color, value: Number(value) }))
    .sort((first, second) => second.value - first.value);
  let remaining = Math.max(0, Math.floor(amount));

  denominations.forEach(({ color, value }) => {
    const chipCount = Math.floor(remaining / value);
    remaining %= value;
    if (chipCount === 0) return;
    const visibleChipCount = Math.min(chipCount, 100);
    for (let firstChip = 0; firstChip < visibleChipCount; firstChip += 10) {
      const stack = document.createElement('span');
      stack.className = 'player-chip-stack';
      const chipsInStack = Math.min(10, visibleChipCount - firstChip);
      for (let index = 0; index < chipsInStack; index += 1) {
        const chip = document.createElement('i');
        chip.className = `player-chip-rectangle chip-${color}`;
        stack.append(chip);
      }
      container.append(stack);
    }
  });

  if (remaining > 0 || denominations.length === 0) {
    const remainder = document.createElement('span');
    remainder.className = 'player-chip-remainder';
    remainder.textContent = denominations.length === 0 ? amount : `+${remaining}`;
    container.append(remainder);
  }

  return container;
}

function initializeSeatAngles() {
  seatAngles = Object.fromEntries(viewPlayers().map((player, index, players) => [
    player.id,
    (index / players.length) * Math.PI * 2 + Math.PI / 2,
  ]));
}

function positionSeatElement(seat, playerId) {
  const angle = seatAngles[playerId] ?? 0;
  seat.style.setProperty('--x', `${50 + Math.cos(angle) * 40}%`);
  seat.style.setProperty('--y', `${50 + Math.sin(angle) * 40}%`);
  seat.style.setProperty('--rotation', `${angle - Math.PI / 2}rad`);
}

function pointerSeatAngle(event) {
  const bounds = gameScreen.getBoundingClientRect();
  const horizontal = (event.clientX - (bounds.left + bounds.width / 2)) / Math.max(1, bounds.width);
  const vertical = (event.clientY - (bounds.top + bounds.height / 2)) / Math.max(1, bounds.height);
  return normalizeSeatAngle(Math.atan2(vertical, horizontal));
}

function moveSeatToSnappedAngle(seat, playerId, requestedAngle) {
  const currentAngle = seatAngles[playerId];
  const targetAngle = snapSeatAngle(
    requestedAngle,
    viewPlayers().length,
    Math.PI / 2,
    seatSnapDistance,
  );
  if (Math.abs(normalizeSeatAngle(targetAngle - currentAngle)) < 0.0001) return;

  const occupiedSeat = Object.entries(seatAngles).find(([candidateId, candidateAngle]) => (
    String(candidateId) !== String(playerId)
    && Math.abs(normalizeSeatAngle(targetAngle - candidateAngle)) < 0.0001
  ));
  if (occupiedSeat) {
    const [occupiedPlayerId] = occupiedSeat;
    seatAngles[occupiedPlayerId] = currentAngle;
    const occupiedElement = [...playerSeats.children]
      .find((candidate) => candidate.dataset.playerId === String(occupiedPlayerId));
    if (occupiedElement) positionSeatElement(occupiedElement, occupiedPlayerId);
  }

  seatAngles[playerId] = targetAngle;
  positionSeatElement(seat, playerId);
}

function makeSeatDraggable(seat, playerId) {
  let dragging = false;
  const moveSeat = (event) => {
    moveSeatToSnappedAngle(seat, playerId, pointerSeatAngle(event));
  };

  seat.addEventListener('pointerdown', (event) => {
    if (!seatingMode) return;
    dragging = true;
    seat.setPointerCapture(event.pointerId);
    seat.classList.add('dragging');
    moveSeat(event);
  });
  seat.addEventListener('pointermove', (event) => {
    if (dragging) moveSeat(event);
  });
  const stopDragging = (event) => {
    if (!dragging) return;
    dragging = false;
    if (seat.hasPointerCapture(event.pointerId)) seat.releasePointerCapture(event.pointerId);
    seat.classList.remove('dragging');
  };
  seat.addEventListener('pointerup', stopDragging);
  seat.addEventListener('pointercancel', stopDragging);
  seat.addEventListener('keydown', (event) => {
    if (!seatingMode || !['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
    event.preventDefault();
    const direction = event.key === 'ArrowRight' ? 1 : -1;
    moveSeatToSnappedAngle(
      seat,
      playerId,
      seatAngles[playerId] + direction * Math.PI * 2 / viewPlayers().length,
    );
  });
}

function lockClockwiseSeatOrder() {
  const playersById = new Map(viewPlayers().map((player) => [player.id, player]));
  const players = clockwisePlayerIds(viewPlayers(), seatAngles).map((playerId) => playersById.get(playerId));
  gameState = createGameState({
    players,
    smallBlind: gameSettings.smallBlind,
    smallBlindIncrease: gameSettings.smallBlindIncrease,
    dealerId: gameSettings.dealerNumber,
    useBigBlind: gameSettings.useBigBlind,
    bettingLimit: gameSettings.bettingLimit,
    fixedLimitBet: gameSettings.fixedLimitBet,
  });
}

function drawPlayerSeats() {
  playerSeats.replaceChildren();
  const players = viewPlayers();
  const currentPlayerNumber = viewActionPlayerNumber();

  players.forEach((player) => {
    const seat = document.createElement('div');
    seat.className = 'player-seat';
    seat.dataset.playerId = String(player.id);
    const playerNumber = viewPlayerNumber(player);
    const isCurrentPlayer = playerNumber === currentPlayerNumber;
    if (isCurrentPlayer) seat.classList.add('current-player');
    if (!seatingMode && player.id === gameState.dealerId) seat.classList.add('dealer');
    if (player.folded) seat.classList.add('folded');
    if (player.eliminated) seat.classList.add('eliminated');
    positionSeatElement(seat, playerNumber);
    const name = document.createElement('span');
    name.className = 'player-seat-name';
    name.textContent = player.name;
    seat.append(name);

    if (!seatingMode && !player.eliminated) {
      if (gameSettings.chipDisplayMode === 'pile') {
        seat.append(makePlayerChipPiles(player.chips));
      } else {
        const chips = document.createElement('span');
        chips.className = 'player-seat-chips';
        chips.textContent = player.chips;
        seat.append(chips);
      }
    }
    const isDealer = player.id === gameState.dealerId;
    seat.setAttribute('aria-label', seatingMode
      ? `${player.name}, drag around the table to choose this seat`
      : `${player.name}${player.eliminated ? ', out of the game' : `: ${player.chips} chips`}${isDealer ? ', dealer' : ''}${isCurrentPlayer ? ', current turn' : ''}${player.folded ? ', folded' : ''}`);
    seat.setAttribute('role', seatingMode ? 'button' : 'status');
    seat.tabIndex = seatingMode ? 0 : -1;
    if (seatingMode) makeSeatDraggable(seat, playerNumber);
    playerSeats.append(seat);
  });

  const activeAngle = seatAngles[currentPlayerNumber];
  if (Number.isFinite(activeAngle)) {
    turnControl.style.setProperty('--rotation', `${activeAngle - Math.PI / 2}rad`);
  }
  if (seatingMode) return;
  updatePotDisplay();
  turnIndicator.setAttribute('aria-label', `Your bet: ${pendingBet}. Total pot: ${totalPotAmount()}`);
  updateBetControls();
  voiceAgent?.updateContext();
}

function updateBetControls() {
  const currentPlayerNumber = viewActionPlayerNumber();
  const player = viewPlayer(currentPlayerNumber);
  if (!player) return;
  const minimumBet = amountToCallForView(player);
  const maximumBet = bettingBoundsForView(player).maxAdditionalChips;
  const legalActions = currentGameActions();
  const betAction = legalActions.find(({ type }) => type === Transition.BET);
  const allInAction = legalActions.find(({ type }) => type === Transition.ALL_IN);
  const minimumAllowedBet = Math.min(minimumBet, maximumBet);
  const minimumRaiseBet = minimumAllowedBet;
  const canRaise = Boolean(betAction);
  const callIsAllIn = minimumAllowedBet > 0 && minimumAllowedBet === player.chips;
  pendingBet = Math.max(minimumAllowedBet, Math.min(pendingBet, maximumBet));
  callActionButton.textContent = callIsAllIn
    ? `Call ${minimumAllowedBet} (all in)`
    : minimumAllowedBet > 0 ? `Call ${minimumAllowedBet}` : 'Call';
  callActionButton.disabled = minimumAllowedBet === 0;
  checkActionButton.disabled = minimumBet > 0;
  allInActionButton.disabled = callIsAllIn || !allInAction;
  allInActionButton.title = callIsAllIn
    ? 'Calling already uses all your remaining chips.'
    : !allInAction && player.chips > maximumBet
      ? `${bettingLimitLabels[gameState.bettingLimit]} limits this bet to ${maximumBet}.`
      : '';
  raiseActionButton.disabled = callIsAllIn || !canRaise;
  raiseTotalValue.value = String(player.roundBet + pendingBet);
  raiseTotalValue.min = String(player.roundBet + minimumRaiseBet);
  raiseTotalValue.max = String(player.roundBet + maximumBet);
  raiseDecreaseButton.disabled = pendingBet <= minimumRaiseBet;
  raiseIncreaseButton.disabled = pendingBet >= maximumBet;
  raiseShortcutButtons.forEach((button) => {
    const adjustment = Number(button.dataset.raiseAdjustment);
    button.disabled = adjustment < 0 ? pendingBet <= minimumRaiseBet : pendingBet >= maximumBet;
  });
  confirmRaiseButton.disabled = !isLegalPendingBet(player, pendingBet);
  actionMenu.hidden = raiseMode;
  raisePanel.hidden = !raiseMode;
  const undoIsAvailable = canUndoLastTurn();
  undoButton.disabled = !undoIsAvailable;
}

function enterRaiseMode() {
  const currentPlayerNumber = viewActionPlayerNumber();
  const player = viewPlayer(currentPlayerNumber);
  if (!player) return;
  const maximumBet = bettingBoundsForView(player).maxAdditionalChips;
  const minimumBet = amountToCallForView(player);
  const minimumRaiseBet = Math.min(minimumBet, maximumBet);
  if (minimumRaiseBet > maximumBet) return;
  raiseMode = true;
  pendingBet = minimumRaiseBet;
  updateBetControls();
}

function cancelRaiseMode() {
  const player = viewPlayer(viewActionPlayerNumber());
  if (!player) return;
  raiseMode = false;
  pendingBet = amountToCallForView(player);
  updateBetControls();
}

function setRaiseTotal(total) {
  const currentPlayerNumber = viewActionPlayerNumber();
  const player = viewPlayer(currentPlayerNumber);
  if (!player) return;
  const bounds = bettingBoundsForView(player);
  const maximumBet = bounds.maxAdditionalChips;
  const minimumBet = amountToCallForView(player);
  const minimumRaiseBet = Math.min(minimumBet, maximumBet);
  const requestedTotal = Number(total);

  if (!Number.isFinite(requestedTotal)) {
    updateBetControls();
    return;
  }

  const requestedAdditional = Math.max(
    minimumRaiseBet,
    Math.min(requestedTotal - player.roundBet, maximumBet),
  );
  if (gameState.bettingLimit === BettingLimit.FIXED_LIMIT && requestedAdditional > minimumBet) {
    const fixedBet = currentGameActions().find(({ type }) => type === Transition.BET);
    pendingBet = fixedBet?.maxAdditionalChips ?? minimumBet;
  } else {
    pendingBet = requestedAdditional;
  }
  updateBetControls();
}

function adjustRaiseBy(amount) {
  const player = viewPlayer(viewActionPlayerNumber());
  if (!player) return;
  if (gameState.bettingLimit === BettingLimit.FIXED_LIMIT) {
    const callAmount = amountToCallForView(player);
    const fixedBet = currentGameActions().find(({ type }) => type === Transition.BET);
    pendingBet = amount < 0 ? callAmount : fixedBet?.maxAdditionalChips ?? callAmount;
    updateBetControls();
    return;
  }
  setRaiseTotal(player.roundBet + pendingBet + amount);
}

function closeButtonHelp() {
  buttonHelp.hidden = true;
}

function captureTurnState() {
  return structuredClone(gameState);
}

function canUndoLastTurn(fromShowdown = false) {
  return lastTurnState !== null && (fromShowdown || gameState.actionPlayerId !== lastTurnState.actionPlayerId);
}

function undoLastTurn(fromShowdown = false, narrate = true) {
  if (!canUndoLastTurn(fromShowdown)) return;

  const stateBefore = narrate ? getVoiceSnapshot() : null;
  raiseMode = false;
  gameState = structuredClone(lastTurnState);
  const player = viewPlayer(viewActionPlayerNumber());
  pendingBet = player ? amountToCallForView(player) : 0;
  pendingFold = false;
  lastTurnState = null;
  lastTurnEndedHandByFold = false;
  renderGameState();
  if (narrate && voiceAgent?.connected) {
    requestDealerNarration({
      type: 'state_transition',
      origin: 'ui',
      action: { type: 'UNDO' },
      stateBefore,
      stateAfter: getVoiceSnapshot(),
    }).catch((error) => setVoiceStatus(`AI error: ${error.message}`));
  }
}

function showHandCompleteFromGameState() {
  turnIndicator.hidden = true;
  winnerPicker.hidden = false;
  const winners = gameState.handWinnerIds.map((id) => viewPlayer(id)).filter(Boolean);
  const winnerNames = formatNameList(winners.map((winner) => winner.name));
  winnerQuestion.textContent = `${winnerNames} ${winners.length === 1 ? 'wins' : 'win'} the hand!`;
  winnerOptions.replaceChildren();
  const nextHandButton = document.createElement('button');
  nextHandButton.type = 'button';
  nextHandButton.textContent = 'Next hand';
  nextHandButton.addEventListener('click', startNewHand);
  showdownUndoButton.hidden = false;
  showdownUndoButton.disabled = !lastTurnEndedHandByFold || !canUndoLastTurn(true);
  winnerOptions.append(nextHandButton, showdownUndoButton);
  drawPlayerSeats();
}

function renderGameState() {
  if (!gameState) return;
  const phase = gameState.phase;
  const betting = [GamePhase.BETTING_PREFLOP, GamePhase.BETTING_FLOP, GamePhase.BETTING_TURN, GamePhase.BETTING_RIVER].includes(phase);

  if (betting) {
    dealPrompt.hidden = true;
    winnerPicker.hidden = true;
    turnIndicator.hidden = false;
    const player = viewPlayer(gameState.actionPlayerId);
    pendingBet = player ? amountToCallForView(player) : 0;
    pendingFold = false;
    drawPlayerSeats();
    return;
  }

  turnIndicator.hidden = true;
  if (phase === GamePhase.DEAL_HOLE_CARDS) {
    const dealer = viewPlayer(gameState.dealerId);
    const smallBlindPlayer = viewPlayer(gameState.smallBlindPlayerId);
    const bigBlindPlayer = viewPlayer(gameState.bigBlindPlayerId);
    const bettingLimit = bettingLimitLabels[gameState.bettingLimit];
    const fixedLimit = gameState.bettingLimit === BettingLimit.FIXED_LIMIT
      ? ` Limits are ${gameState.fixedLimitBet}/${gameState.fixedLimitBet * 2}.`
      : '';
    const blindPlayers = bigBlindPlayer
      ? `${smallBlindPlayer.name} is the small blind, and ${bigBlindPlayer.name} is the big blind.`
      : `${smallBlindPlayer.name} is the small blind.`;
    dealMessage.textContent = `Game is ${bettingLimit} Texas Hold'em.${fixedLimit} Small blind is ${gameState.smallBlind}. ${blindPlayers} ${dealer.name}, you're the dealer. Deal two cards face down to each player. Press OK or say "cards are dealt" when done.`;
    dealPrompt.hidden = false;
    drawPlayerSeats();
    return;
  }

  if ([GamePhase.DEAL_FLOP, GamePhase.DEAL_TURN, GamePhase.DEAL_RIVER].includes(phase)) {
    const card = {
      [GamePhase.DEAL_FLOP]: 'the flop',
      [GamePhase.DEAL_TURN]: 'the turn',
      [GamePhase.DEAL_RIVER]: 'the river',
    }[phase];
    dealMessage.textContent = `Deal ${card}. Press OK to continue.`;
    dealPrompt.hidden = false;
    drawPlayerSeats();
    return;
  }

  if (phase === GamePhase.ALL_IN_RUNOUT) {
    const cards = remainingCommunityCards();
    dealMessage.textContent = `Deal ${formatCardList(cards)}. Press OK for showdown.`;
    dealPrompt.hidden = false;
    drawPlayerSeats();
    return;
  }

  dealPrompt.hidden = true;
  if (phase === GamePhase.SHOWDOWN) {
    showWinnerPicker();
  } else if (phase === GamePhase.HAND_COMPLETE) {
    showHandCompleteFromGameState();
  } else if (phase === GamePhase.GAME_COMPLETE) {
    showGameWinner(viewPlayer(gameState.handWinnerIds[0]) || gameState.players.find((player) => player.chips > 0));
  }
}

function remainingCommunityCards() {
  return ['the flop', 'the turn', 'the river'].slice(viewRoundNumber() - 1);
}

function formatCardList(cards) {
  if (cards.length <= 1) return cards[0] || '';
  if (cards.length === 2) return `${cards[0]} and ${cards[1]}`;
  return `${cards.slice(0, -1).join(', ')}, and ${cards.at(-1)}`;
}

function formatNameList(names) {
  if (names.length <= 1) return names[0] || '';
  if (names.length === 2) return `${names[0]} and ${names[1]}`;
  return `${names.slice(0, -1).join(', ')}, and ${names.at(-1)}`;
}

function showWinnerPicker() {
  if (gameState.phase === GamePhase.SHOWDOWN) showGameStatePotWinnerPicker();
}

function showGameStatePotWinnerPicker() {
  const potIndex = gameState.potAwardIndex;
  const pot = gameState.pots[potIndex];
  if (!pot || pot.amount <= 0) return;
  const eligiblePlayers = pot.eligiblePlayerNumbers
    .map((playerId) => viewPlayer(playerId))
    .filter((player) => player && !player.folded && !player.eliminated);

  if (eligiblePlayers.length === 1) {
    awardPot(potIndex, eligiblePlayers[0].id);
    return;
  }

  showPotWinnerPicker(
    potIndex === 0 ? 'Who had the best cards?' : `Who wins side pot ${potIndex}?`,
    eligiblePlayers.map((player) => ({ ...player, number: player.id })),
    (winnerNumber) => awardPot(potIndex, winnerNumber),
    (winnerNumbers) => awardSplitPot(potIndex, winnerNumbers),
  );
}

function showPotWinnerPicker(question, players, awardFunction, splitFunction = null) {
  turnIndicator.hidden = true;
  winnerQuestion.textContent = question;
  winnerOptions.replaceChildren();
  let splitMode = false;
  const selectedWinnerNumbers = new Set();
  const playerButtons = [];
  let confirmSplitButton = null;

  players.forEach((player) => {
    const winnerButton = document.createElement('button');
    winnerButton.type = 'button';
    winnerButton.textContent = player.name;
    winnerButton.setAttribute('aria-pressed', 'false');
    winnerButton.addEventListener('click', () => {
      if (!splitMode) {
        awardFunction(player.number);
        return;
      }

      if (selectedWinnerNumbers.has(player.number)) {
        selectedWinnerNumbers.delete(player.number);
      } else {
        selectedWinnerNumbers.add(player.number);
      }
      const isSelected = selectedWinnerNumbers.has(player.number);
      winnerButton.classList.toggle('selected', isSelected);
      winnerButton.setAttribute('aria-pressed', String(isSelected));
      if (confirmSplitButton) confirmSplitButton.disabled = selectedWinnerNumbers.size < 2;
    });
    playerButtons.push(winnerButton);
    winnerOptions.append(winnerButton);
  });

  if (splitFunction && players.length > 1) {
    const splitButton = document.createElement('button');
    splitButton.type = 'button';
    splitButton.className = 'split-pot-button';
    splitButton.textContent = 'Split pot';

    confirmSplitButton = document.createElement('button');
    confirmSplitButton.type = 'button';
    confirmSplitButton.className = 'confirm-split-button';
    confirmSplitButton.textContent = 'Confirm split';
    confirmSplitButton.disabled = true;
    confirmSplitButton.hidden = true;

    splitButton.addEventListener('click', () => {
      splitMode = !splitMode;
      selectedWinnerNumbers.clear();
      playerButtons.forEach((button) => {
        button.classList.remove('selected');
        button.setAttribute('aria-pressed', 'false');
      });
      winnerQuestion.textContent = splitMode ? 'Who tied for this pot?' : question;
      splitButton.textContent = splitMode ? 'Cancel split' : 'Split pot';
      confirmSplitButton.hidden = !splitMode;
      confirmSplitButton.disabled = true;
    });
    confirmSplitButton.addEventListener('click', () => splitFunction([...selectedWinnerNumbers]));
    winnerOptions.append(splitButton, confirmSplitButton);
  }

  showdownUndoButton.hidden = false;
  showdownUndoButton.disabled = !canUndoLastTurn(true);
  winnerOptions.append(showdownUndoButton);
  winnerPicker.hidden = false;
}

function awardPot(potIndex, winnerNumber) {
  invokeGame({ type: Transition.AWARD_POT, potIndex, winnerId: winnerNumber }, { narrate: true });
  renderGameState();
}

function awardSplitPot(potIndex, winnerNumbers) {
  invokeGame({ type: Transition.SPLIT_POT, potIndex, winnerIds: winnerNumbers }, { narrate: true });
  renderGameState();
}

function showGameWinner(winner) {
  allowScreenToSleep();
  gameScreen.hidden = true;
  gameWinnerMessage.textContent = `${winner.name} wins!`;
  gameWinnerScreen.hidden = false;
}

function takeAnte() {
  for (let i = 0; i < gameState.players.length; i++) {
    gameState.players[i].chips -= gameSettings.ante;
    gameState.players[i].handContribution += gameSettings.ante;
  }
  gameState.pots[0].amount += gameState.players.length * gameSettings.ante;
}

function startHand() {
  lastTurnState = null;
  lastTurnEndedHandByFold = false;
  pendingBet = 0;
  pendingFold = false;
  invokeGame({ type: Transition.START_HAND });
  takeAnte();
  renderGameState();
}

function startNewHand() {
  lastTurnState = null;
  lastTurnEndedHandByFold = false;
  pendingBet = 0;
  pendingFold = false;
  invokeGame({ type: Transition.START_NEXT_HAND });
  takeAnte();
  renderGameState();
  if (voiceAgent?.connected) {
    requestDealerNarration({
      type: 'new_hand_started',
      handNumber: gameState.handNumber,
      setup: getVoiceSnapshot().game,
      dealInstruction: dealMessage.textContent,
    }).catch((error) => setVoiceStatus(`AI error: ${error.message}`));
  }
}

function connectVoiceForCurrentGame() {
  connectVoiceAgent()
    .then(async (agent) => {
      const shouldAnnounceDeal = !dealPrompt.hidden && gameState.phase === GamePhase.DEAL_HOLE_CARDS;
      if (shouldAnnounceDeal) {
        startMicrophoneAfterSpeech = gameSettings.startMicrophoneAutomatically;
        const result = await requestDealerNarration({
          type: 'game_started',
          setup: getVoiceSnapshot().game,
          dealInstruction: dealMessage.textContent,
        });
        if (gameSettings.startMicrophoneAutomatically && !result.speak) {
          startMicrophoneAfterSpeech = false;
          await agent.startMicrophone();
        }
      } else if (gameSettings.startMicrophoneAutomatically) {
        await agent.startMicrophone();
      }
      updateRecordingButton();
    })
    .catch((error) => {
      const errorMessage = `Voice unavailable: ${error.message}`;
      setVoiceStatus(errorMessage);
      setVoiceTranscript(errorMessage);
    });
}

function beginSeatPositioning() {
  seatingMode = true;
  initializeSeatAngles();
  gameScreen.classList.add('seating-mode');
  turnControl.hidden = true;
  winnerPicker.hidden = true;
  dealPrompt.hidden = true;
  voiceTranscript.hidden = true;
  voiceAudioTest.hidden = true;
  lockSeatsButton.hidden = false;
  drawPlayerSeats();
}

function createGameStartDissolve() {
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;

  gameScreen.querySelector('.game-start-transition')?.remove();
  const screenBounds = gameScreen.getBoundingClientRect();
  const transition = document.createElement('div');
  transition.className = 'game-start-transition';
  transition.setAttribute('aria-hidden', 'true');

  const colors = ['#fffdf6', '#f1c565', '#b63f29', '#2875c7', '#63d69a'];
  [...playerSeats.querySelectorAll('.player-seat')].forEach((seat, seatIndex) => {
    const bounds = seat.getBoundingClientRect();
    const centerX = bounds.left - screenBounds.left + bounds.width / 2;
    const centerY = bounds.top - screenBounds.top + bounds.height / 2;
    const ghost = seat.cloneNode(true);
    ghost.classList.add('game-start-seat-ghost');
    ghost.removeAttribute('role');
    ghost.removeAttribute('tabindex');
    ghost.style.left = `${centerX}px`;
    ghost.style.top = `${centerY}px`;
    ghost.style.setProperty('--dissolve-delay', `${seatIndex * 20}ms`);
    transition.append(ghost);

    const particleCount = 18;
    for (let particleIndex = 0; particleIndex < particleCount; particleIndex += 1) {
      const particle = document.createElement('i');
      particle.className = 'game-start-particle';
      const seed = seatIndex * particleCount + particleIndex;
      const angle = particleIndex / particleCount * Math.PI * 2 + seatIndex * 0.47;
      const distance = 34 + (seed * 29 % 70);
      const startRadius = 8 + (seed * 13 % 21);
      const size = 3 + (seed * 7 % 6);
      particle.style.left = `${centerX + Math.cos(angle) * startRadius}px`;
      particle.style.top = `${centerY + Math.sin(angle) * startRadius}px`;
      particle.style.width = `${size}px`;
      particle.style.height = `${Math.max(2, size - seed % 3)}px`;
      particle.style.setProperty('--particle-color', colors[seed % colors.length]);
      particle.style.setProperty('--particle-x', `${Math.cos(angle) * distance}px`);
      particle.style.setProperty('--particle-y', `${Math.sin(angle) * distance - 18}px`);
      particle.style.setProperty('--particle-turn', `${seed % 2 ? 190 : -190}deg`);
      particle.style.setProperty('--dissolve-delay', `${80 + seatIndex * 20 + particleIndex * 6}ms`);
      transition.append(particle);
    }
  });

  const pulse = document.createElement('div');
  pulse.className = 'game-start-pulse';
  transition.append(pulse);
  gameScreen.append(transition);
  gameScreen.classList.add('game-starting');

  window.setTimeout(() => {
    transition.remove();
    gameScreen.classList.remove('game-starting');
  }, 1100);
}

function lockSeatsAndStartGame() {
  if (!seatingMode || gameScreen.classList.contains('game-starting')) return;
  lockClockwiseSeatOrder();
  createGameStartDissolve();
  seatingMode = false;
  gameScreen.classList.remove('seating-mode');
  lockSeatsButton.hidden = true;
  turnControl.hidden = false;
  updateDebugFeatures();
  if (gameSettings.debugPreset === 'normal') {
    startHand();
  } else {
    gameState = createDebugGameState(gameState, gameSettings.debugPreset);
    renderGameState();
  }
  connectVoiceForCurrentGame();
}

function confirmTurn(narrate = true) {
  const currentPlayerNumber = gameState.actionPlayerId;
  const player = viewPlayer(currentPlayerNumber);
  lastTurnState = captureTurnState();
  const amountToCall = amountToCallForView(player);
  const legalActions = currentGameActions();
  let action;
  if (pendingFold) {
    action = { type: Transition.FOLD, playerId: currentPlayerNumber };
  } else if (pendingBet === 0) {
    action = { type: Transition.CHECK, playerId: currentPlayerNumber };
  } else if (pendingBet === amountToCall) {
    action = { type: Transition.CALL, playerId: currentPlayerNumber };
  } else if (legalActions.some(({ type }) => type === Transition.ALL_IN) && pendingBet === player.chips) {
    action = { type: Transition.ALL_IN, playerId: currentPlayerNumber };
  } else {
    action = { type: Transition.BET, playerId: currentPlayerNumber, additionalChips: pendingBet };
  }
  invokeGame(action, { narrate });
  lastTurnEndedHandByFold = action.type === Transition.FOLD && gameState.phase === GamePhase.HAND_COMPLETE;
  pendingFold = false;
  renderGameState();
}

function foldCurrentPlayer() {
  pendingFold = true;
  updateBetControls();

}

function betCurrentPlayer(amount) {
  const currentPlayerNumber = viewActionPlayerNumber();
  const player = viewPlayer(currentPlayerNumber);
  const requestedAmount = Number(amount);

  if (!Number.isFinite(requestedAmount) || requestedAmount < 0) return false;

  pendingFold = false;
  const maximumBet = bettingBoundsForView(player).maxAdditionalChips;
  pendingBet = Math.min(requestedAmount, maximumBet);
  updateBetControls();
  return true;
}

function confirm(narrate = true) {
  confirmTurn(narrate);
}

function cardsAreDealt(narrate = true) {
  if (!currentGameActions().some(({ type }) => type === Transition.CARDS_DEALT)) return false;
  invokeGame({ type: Transition.CARDS_DEALT }, { narrate });
  renderGameState();
  return true;
}

playerCount.addEventListener('change', () => {
  drawPlayerNames();
  useBigBlindCheckbox.checked = Number(playerCount.value) >= 6;
});
bettingLimitSelect.addEventListener('change', updateFixedLimitSetting);
useAnteCheckbox.addEventListener('change', updateAnteSetting);
debugFeaturesCheckbox.addEventListener('change', updateDebugFeatures);
debugPresetSelect.addEventListener('change', selectDebugPreset);
enableAudioFileInputCheckbox.addEventListener('change', updateDebugFeatures);
voiceCustomizationButton.addEventListener('click', () => {
  setupScreen.hidden = true;
  voiceCustomizationScreen.hidden = false;
});
voiceCustomizationBack.addEventListener('click', () => {
  voiceCustomizationScreen.hidden = true;
  setupScreen.hidden = false;
});
chipDenominationsButton.addEventListener('click', () => {
  setupScreen.hidden = true;
  chipDenominationsScreen.hidden = false;
});
chipDenominationsBack.addEventListener('click', () => {
  chipDenominationsScreen.hidden = true;
  setupScreen.hidden = false;
});
chipDisplayModeButton.addEventListener('click', () => {
  chipDisplayMode = chipDisplayMode === 'value' ? 'pile' : 'value';
  updateChipDisplayModeButton();
});
chipEnabledCheckboxes.forEach((checkbox) => {
  checkbox.addEventListener('change', () => updateChipDenominationAvailability(checkbox));
  updateChipDenominationAvailability(checkbox);
});
testVoiceButton.addEventListener('click', previewVoice);
voiceAudioFile.addEventListener('change', () => {
  voiceAudioTestButton.disabled = !voiceAudioFile.files[0];
  voiceAudioTestStatus.textContent = '';
});
voiceAudioTestButton.addEventListener('click', testVoiceWithAudioFile);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !gameScreen.hidden && !viewIsGameWon()) {
    keepScreenAwake();
  }
});
callActionButton.addEventListener('click', () => {
  if (callActionButton.disabled) return;
  const player = viewPlayer(viewActionPlayerNumber());
  if (!player) return;
  raiseMode = false;
  pendingBet = amountToCallForView(player);
  confirm();
});
checkActionButton.addEventListener('click', () => {
  if (checkActionButton.disabled) return;
  raiseMode = false;
  pendingBet = 0;
  pendingFold = false;
  confirm();
});
foldActionButton.addEventListener('click', () => {
  raiseMode = false;
  pendingFold = true;
  confirm();
});
allInActionButton.addEventListener('click', () => {
  if (allInActionButton.disabled) return;
  const player = viewPlayer(viewActionPlayerNumber());
  if (!player) return;
  raiseMode = false;
  betCurrentPlayer(player.chips);
  confirm();
});
raiseActionButton.addEventListener('click', enterRaiseMode);
raiseDecreaseButton.addEventListener('click', () => {
  if (!raiseDecreaseButton.disabled) adjustRaiseBy(-1);
});
raiseIncreaseButton.addEventListener('click', () => {
  if (!raiseIncreaseButton.disabled) adjustRaiseBy(1);
});
raiseShortcutButtons.forEach((button) => {
  button.addEventListener('click', () => {
    if (!button.disabled) adjustRaiseBy(Number(button.dataset.raiseAdjustment));
  });
});
raiseTotalValue.addEventListener('change', () => setRaiseTotal(raiseTotalValue.value));
raiseTotalValue.addEventListener('keydown', (event) => {
  if (event.key !== 'Enter') return;
  event.preventDefault();
  setRaiseTotal(raiseTotalValue.value);
  raiseTotalValue.blur();
});
confirmRaiseButton.addEventListener('click', () => {
  if (confirmRaiseButton.disabled) return;
  raiseMode = false;
  confirm();
});
cancelRaiseButton.addEventListener('click', cancelRaiseMode);
helpButton.addEventListener('click', () => {
  buttonHelp.hidden = false;
  closeHelpButton.focus();
});
closeHelpButton.addEventListener('click', closeButtonHelp);
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && !buttonHelp.hidden) closeButtonHelp();
});
undoButton.addEventListener('click', () => undoLastTurn());
showdownUndoButton.addEventListener('click', () => undoLastTurn(true));
dealOkButton.addEventListener('click', cardsAreDealt);
recordingButton.addEventListener('click', toggleRecording);
lockSeatsButton.addEventListener('click', lockSeatsAndStartGame);
form.addEventListener('submit', (event) => {
  event.preventDefault();
  gameSettings = {
    playerCount: Number(playerCount.value),
    startingMoney: Number(document.querySelector('#starting-money').value),
    smallBlind: Number(document.querySelector('#small-blind').value),
    smallBlindIncrease: Number(document.querySelector('#small-blind-increase').value),
    useBigBlind: useBigBlindCheckbox.checked,
    useAnte: useAnteCheckbox.checked,
    ante: useAnteCheckbox.checked ? Number(anteInput.value) : 0,
    bettingLimit: bettingLimitSelect.value,
    fixedLimitBet: Number(fixedLimitBetInput.value),
    dealerNumber: Number(dealerSelect.value),
    playerNames: [...playerNames.querySelectorAll('input')].map((input) => input.value),
    startMicrophoneAutomatically: startMicrophoneAutomaticallyCheckbox.checked,
    showVoiceTranscript: showVoiceTranscriptCheckbox.checked,
    chipDisplayMode,
    chipDenominations: selectedChipDenominations(),
    voice: selectedVoiceSettings(),
    debugPreset: debugFeaturesCheckbox.checked ? debugPresetSelect.value : 'normal',
    enableAudioFileInput: debugFeaturesCheckbox.checked && enableAudioFileInputCheckbox.checked,
  };
  saveLastGameSettings();
  makePlayers();
  setupScreen.hidden = true;
  voiceCustomizationScreen.hidden = true;
  chipDenominationsScreen.hidden = true;
  gameScreen.hidden = false;
  gameWinnerScreen.hidden = true;
  winnerPicker.hidden = true;
  dealPrompt.hidden = true;
  keepScreenAwake();
  beginSeatPositioning();
});

drawPlayerNames();
updateChipDisplayModeButton();
restoreLastGameSettings();
updateFixedLimitSetting();
updateAnteSetting();
updateDebugFeatures();
