import { calculatePots, hasBettingRoundFinished, maximumAdditionalBet, splitPotAmount } from './pot-logic.js';
import { addRequiredVoiceKeywords, fillPrompt, VoiceAgent } from './voice-agent.js';
import promptsText from './Prompts?raw';

const prompts = JSON.parse(promptsText);
const gameVoicePrompts = {
  ...prompts,
  transcription: {
    ...prompts.transcription,
    keywords: addRequiredVoiceKeywords(prompts.transcription.keywords, ['undo']),
  },
};

const playerCount = document.querySelector('#player-count');
const playerNames = document.querySelector('#player-names');
const form = document.querySelector('#setup-form');
const message = document.querySelector('#message');
const dealerSelect = document.querySelector('#dealer');
const debugPresetSelect = document.querySelector('#debug-preset');
const useBigBlindCheckbox = document.querySelector('#use-big-blind');
const setupScreen = document.querySelector('#setup-screen');
const voiceCustomizationScreen = document.querySelector('#voice-customization-screen');
const chipDenominationsScreen = document.querySelector('#chip-denominations-screen');
const gameScreen = document.querySelector('#game-screen');
const gameWinnerScreen = document.querySelector('#game-winner-screen');
const gameWinnerMessage = document.querySelector('#game-winner-message');
const playerSeats = document.querySelector('#player-seats');
const turnControl = document.querySelector('#turn-control');
const turnIndicator = document.querySelector('#turn-indicator');
const betInput = document.querySelector('#current-bet');
const betIncrease = document.querySelector('#bet-increase');
const betDecrease = document.querySelector('#bet-decrease');
const foldButton = document.querySelector('#fold-button');
const confirmButton = document.querySelector('#confirm-button');
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
const roundLabel = document.querySelector('#round-label');
const actionButtons = document.querySelector('.action-buttons');
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
const voicePersonality = document.querySelector('#voice-personality');
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
let playersByNumber = {};
let currentPlayerNumber = 1;
let antePlayerNumber = null;
let bigBlindPlayerNumber = null;
let highestRoundBet = 0;
let pendingBet = 0;
let pendingFold = false;
let isGameWon = false;
let roundNumber = 1;
let pots = [];
let renderedPotLayerCount = 0;
let potAnimationTimer = null;
let potAwardIndex = 0;
let lastPotWinnerNumber = null;
let handWinnerNumbers = [];
let lastTurnState = null;
let gameHandNumber = 0;
let dealPromptKind = null;
let chipDisplayMode = 'value';
let screenWakeLock = null;
let voiceAgent = null;
let voicePreviewAgent = null;
let voiceConnectionPromise = null;
let pendingVoiceAction = null;
let raiseMode = false;
const lastGameSettingsKey = 'robodeal-last-game-settings';

function selectedVoiceSettings() {
  return {
    name: voiceChoice.value,
    accent: voiceAccent.value,
    personality: voicePersonality.value,
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

  playerCount.value = settings.playerCount;
  document.querySelector('#starting-money').value = settings.startingMoney;
  document.querySelector('#ante').value = settings.ante;
  document.querySelector('#ante-increase').value = settings.anteIncrease;
  useBigBlindCheckbox.checked = settings.useBigBlind ?? settings.playerCount >= 6;
  drawPlayerNames();

  [...playerNames.querySelectorAll('input')].forEach((input, index) => {
    input.value = settings.playerNames?.[index] || '';
  });
  drawDealerOptions(String(settings.dealerNumber));
  dealerSelect.value = String(settings.dealerNumber);
  startMicrophoneAutomaticallyCheckbox.checked = settings.startMicrophoneAutomatically !== false;
  showVoiceTranscriptCheckbox.checked = Boolean(settings.showVoiceTranscript);
  chipDisplayMode = settings.chipDisplayMode === 'pile' ? 'pile' : 'value';
  updateChipDisplayModeButton();
  restoreChipDenominations(settings.chipDenominations);
  if (settings.voice) {
    voiceChoice.value = settings.voice.name || voiceChoice.value;
    voiceAccent.value = settings.voice.accent || voiceAccent.value;
    voicePersonality.value = settings.voice.personality || voicePersonality.value;
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

function copyPots() {
  return pots.map((potLayer) => ({
    ...potLayer,
    eligiblePlayerNumbers: [...potLayer.eligiblePlayerNumbers],
  }));
}

function mainPotAmount() {
  return pots[0]?.amount || 0;
}

function sidePots() {
  return pots.slice(1);
}

function totalPotAmount() {
  return pots.reduce((total, potLayer) => total + potLayer.amount, 0);
}

function syncPotsToGameSettings() {
  if (!gameSettings) return;
  gameSettings.pot = mainPotAmount();
  gameSettings.pots = copyPots();
}

function recalculatePots() {
  pots = calculatePots(Object.values(playersByNumber));
  syncPotsToGameSettings();
}

function potLayerName(index) {
  return index === 0 ? 'Main pot' : `Side pot ${index}`;
}

function drawPotLayers(layerCount, animateNewLayer = false) {
  const visibleLayers = pots.slice(0, layerCount);
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
  if (pots.length <= renderedPotLayerCount) {
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
  const targetLayerCount = pots.length;

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
  if (normalizedText.includes('thinking')) state = 'thinking';
  else if (normalizedText.includes('applying') || normalizedText.includes('action')) state = 'acting';
  else if (normalizedText.includes('speaking')) state = 'speaking';
  else if (normalizedText.includes('listening')) state = 'listening';
  else if (normalizedText.includes('error') || normalizedText.includes('could not') || normalizedText.includes('unavailable')) state = 'error';
  else if (normalizedText.includes('disconnect') || normalizedText.includes('ended')) state = 'disconnected';
  else if (normalizedText.includes('off')) state = 'off';

  voiceStatus.textContent = text;
  voiceStatus.dataset.state = state;
}

function updateRecordingButton() {
  const recording = Boolean(voiceAgent?.recording);
  recordingButton.setAttribute('aria-pressed', String(recording));
  recordingButton.textContent = recording ? 'Stop recording' : 'Start recording';
}

function getVoiceSnapshot() {
  const player = playersByNumber[currentPlayerNumber] || null;
  const maximumBet = player ? maximumAdditionalBet(Object.values(playersByNumber), currentPlayerNumber) : 0;
  const undoFromShowdown = !winnerPicker.hidden;
  return {
    phase: gameScreen.hidden ? 'setup' : !dealPrompt.hidden ? 'waiting for cards' : !winnerPicker.hidden ? 'choosing winner' : 'betting',
    round: ['preflop', 'flop', 'turn', 'river'][roundNumber - 1] || 'between hands',
    currentPlayerNumber,
    currentPlayer: player ? {
      name: player.name,
      chips: player.chips,
      roundBet: player.roundBet,
      amountToCall: Math.min(Math.max(0, highestRoundBet - player.roundBet), player.chips),
      maximumAdditionalBet: maximumBet,
      canGoAllIn: maximumBet === player.chips,
    } : null,
    highestRoundBet,
    pendingBet,
    pendingFold,
    pendingVoiceAction,
    canUndo: !gameScreen.hidden
      && dealPrompt.hidden
      && gameWinnerScreen.hidden
      && !isGameWon
      && canUndoLastTurn(undoFromShowdown),
    pot: totalPotAmount(),
    dealInstruction: dealPrompt.hidden ? null : dealMessage.textContent,
    players: Object.values(playersByNumber).map((candidate) => ({
      number: candidate.number,
      name: candidate.name,
      chips: candidate.chips,
      folded: candidate.folded,
      eliminated: candidate.eliminated,
    })),
  };
}

function getVoiceInstructions() {
  const voice = gameSettings?.voice || selectedVoiceSettings();
  const instructions = fillPrompt(gameVoicePrompts.mainVoiceInstructions, {
    GAME_STATE: JSON.stringify(getVoiceSnapshot()),
    PERSONALITY: voice.personality,
    ACCENT: voice.accent,
    PACE: voice.pace,
    ACTIVATION_KEYWORDS: gameVoicePrompts.transcription.keywords.join(', '),
  });
  return `${instructions}\n\n"Undo" is an activation keyword and an undo request is always related to this poker game. When the foreground speaker says "undo," "undo that," or "undo the last turn," call the undo tool. Never classify a clear undo request as unrelated speech.`;
}

const voiceTools = [
  { type: 'function', name: 'ignoreSpeech', description: prompts.toolDescriptions.ignoreSpeech, parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'check', description: prompts.toolDescriptions.check, parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'call', description: prompts.toolDescriptions.call, parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'bet', description: prompts.toolDescriptions.bet, parameters: { type: 'object', properties: { total: { type: 'number', description: prompts.toolDescriptions.betTotal } }, required: ['total'], additionalProperties: false } },
  { type: 'function', name: 'raise', description: prompts.toolDescriptions.raise, parameters: { type: 'object', properties: { amount: { type: 'number', description: prompts.toolDescriptions.raiseAmount } }, required: ['amount'], additionalProperties: false } },
  { type: 'function', name: 'fold', description: prompts.toolDescriptions.fold, parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'allIn', description: prompts.toolDescriptions.allIn, parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'confirmAction', description: prompts.toolDescriptions.confirmAction, parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'cancelAction', description: prompts.toolDescriptions.cancelAction, parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'cardsDealt', description: prompts.toolDescriptions.cardsDealt, parameters: { type: 'object', properties: {}, additionalProperties: false } },
  { type: 'function', name: 'undo', description: 'Poker action for a clear request containing "undo," including "undo," "undo that," and "undo the last turn." Call this tool instead of ignoreSpeech. It restores the most recently confirmed poker turn when available.', parameters: { type: 'object', properties: {}, additionalProperties: false } },
];

function executeVoiceTool(name, args) {
  if (name === 'ignoreSpeech') return { ok: true, silent: true };

  if (name === 'undo') {
    const fromShowdown = !winnerPicker.hidden;
    if (gameScreen.hidden || !dealPrompt.hidden || !gameWinnerScreen.hidden || isGameWon || !canUndoLastTurn(fromShowdown)) {
      return { ok: false, message: 'There is no turn available to undo.' };
    }
    const restoredPlayerName = playersByNumber[lastTurnState.currentPlayerNumber]?.name;
    undoLastTurn(fromShowdown);
    return {
      ok: true,
      message: restoredPlayerName
        ? `The last turn was undone. It is ${restoredPlayerName}'s turn again.`
        : 'The last turn was undone.',
    };
  }

  if (name === 'cardsDealt') {
    if (!cardsAreDealt()) return { ok: false, message: 'The game is not waiting for cards.' };
    return { ok: true, message: 'Cards confirmed.' };
  }

  const player = playersByNumber[currentPlayerNumber];
  if (!player) return { ok: false, message: 'There is no active player.' };

  if (name === 'cancelAction') {
    if (!pendingFold && !pendingVoiceAction) return { ok: false, message: 'There is no action waiting for confirmation.' };
    const cancelledFold = pendingFold;
    pendingFold = false;
    pendingVoiceAction = null;
    updateBetControls();
    return { ok: true, message: cancelledFold ? 'The pending fold was cancelled.' : 'The pending action was cancelled.' };
  }

  if (name === 'confirmAction') {
    if (!pendingFold && !pendingVoiceAction) return { ok: false, message: 'There is no action waiting for confirmation.' };
    if (gameScreen.hidden || !dealPrompt.hidden || !winnerPicker.hidden || !gameWinnerScreen.hidden) {
      pendingFold = false;
      pendingVoiceAction = null;
      return { ok: false, message: 'That confirmation is no longer available.' };
    }
    if (pendingVoiceAction && pendingVoiceAction.playerNumber !== currentPlayerNumber) {
      pendingFold = false;
      pendingVoiceAction = null;
      return { ok: false, message: 'That confirmation is no longer available.' };
    }

    const pendingAction = pendingVoiceAction;
    const action = pendingFold ? 'fold' : pendingAction.type;
    pendingVoiceAction = null;
    if (action === 'fold') {
      confirm();
      return { ok: true, message: `${player.name} folds.` };
    }
    if (action === 'all-in') {
      const amount = pendingAction.amount ?? player.chips;
      betCurrentPlayer(amount);
      confirm();
      return { ok: true, message: `${player.name} is all in for ${amount}.` };
    }
    return { ok: false, message: 'Unknown pending action.' };
  }

  if (gameScreen.hidden || !dealPrompt.hidden || !winnerPicker.hidden || !gameWinnerScreen.hidden) {
    return { ok: false, message: 'A betting action is not available right now.' };
  }

  const amountToCall = Math.min(Math.max(0, highestRoundBet - player.roundBet), player.chips);
  const maximumBet = maximumAdditionalBet(Object.values(playersByNumber), currentPlayerNumber);
  if (name !== 'fold' && name !== 'allIn') pendingVoiceAction = null;
  if (name === 'fold') {
    pendingVoiceAction = null;
    foldCurrentPlayer();
    confirm();
    return { ok: true, message: `${player.name} folds.` };
  }
  if (name === 'check') {
    if (amountToCall > 0) return { ok: false, message: `${player.name} must call ${amountToCall} or fold.` };
    betCurrentPlayer(0);
    confirm();
    return { ok: true, message: `${player.name} checks.` };
  }
  if (name === 'call') {
    betCurrentPlayer(amountToCall);
    confirm();
    return { ok: true, message: `${player.name} calls ${amountToCall}.` };
  }
  if (name === 'allIn') {
    if (maximumBet < player.chips) {
      return { ok: false, message: `${player.name} cannot go all in because opponents can cover only ${maximumBet}; the maximum additional bet is ${maximumBet}.` };
    }
    pendingFold = false;
    updateBetControls();
    pendingVoiceAction = { type: 'all-in', playerNumber: currentPlayerNumber, amount: player.chips };
    return { ok: true, confirmationRequired: true, message: `Ask ${player.name} to confirm going all in for ${player.chips}.` };
  }
  if (name === 'bet') {
    const total = Number(args.total);
    const amount = total - player.roundBet;
    if (!Number.isFinite(total) || amount < amountToCall || amount > maximumBet) {
      return { ok: false, message: `The total bet must be from ${player.roundBet + amountToCall} to ${player.roundBet + maximumBet}.` };
    }
    if (amount === player.chips) {
      pendingVoiceAction = { type: 'all-in', playerNumber: currentPlayerNumber, amount };
      return { ok: true, confirmationRequired: true, message: `That bet is all in. Ask ${player.name} to confirm going all in for ${player.chips}.` };
    }
    betCurrentPlayer(amount);
    confirm();
    return { ok: true, message: `${player.name} bets to ${total}.` };
  }
  if (name === 'raise') {
    const raiseAmount = Number(args.amount);
    const amount = amountToCall + raiseAmount;
    if (!Number.isFinite(raiseAmount) || raiseAmount < 0 || amount > maximumBet) {
      return { ok: false, message: `The raise must be from 0 to ${Math.max(0, maximumBet - amountToCall)}.` };
    }
    if (amount === player.chips) {
      pendingVoiceAction = { type: 'all-in', playerNumber: currentPlayerNumber, amount };
      return { ok: true, confirmationRequired: true, message: `That raise is all in. Ask ${player.name} to confirm going all in for ${player.chips}.` };
    }
    const total = player.roundBet + amount;
    betCurrentPlayer(amount);
    confirm();
    return { ok: true, message: `${player.name} raises ${raiseAmount} to ${total}.` };
  }
  return { ok: false, message: 'Unknown poker action.' };
}

async function connectVoiceAgent() {
  if (voiceAgent?.connected) return voiceAgent;
  if (voiceConnectionPromise) return voiceConnectionPromise;

  voiceAgent?.disconnect();
  voiceAgent = new VoiceAgent({
    getInstructions: getVoiceInstructions,
    prompts: gameVoicePrompts,
    tools: voiceTools,
    executeTool: executeVoiceTool,
    onTranscript: setVoiceTranscript,
    onStatus: setVoiceStatus,
  });
  voiceConnectionPromise = voiceAgent.connect(gameSettings?.voice?.name || voiceChoice.value)
    .then(() => voiceAgent)
    .finally(() => { voiceConnectionPromise = null; });
  return voiceConnectionPromise;
}

async function toggleRecording() {
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
    getInstructions: () => prompts.voicePreviewInstructions,
    prompts,
    onStatus: (status) => { voicePreviewStatus.textContent = status; },
  });
  try {
    await voicePreviewAgent.connect(voiceChoice.value);
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
  playersByNumber = {};
  const names = [...playerNames.querySelectorAll('input')];

  names.forEach((input, index) => {
    const number = index + 1;
    playersByNumber[number] = {
      number,
      name: input.value || `Player ${number}`,
      chips: Number(document.querySelector('#starting-money').value),
      isDealer: number === Number(dealerSelect.value),
      roundBet: 0,
      handContribution: 0,
      hasActedThisRound: false,
      folded: false,
      eliminated: false,
    };
  });
}

const debugPresets = {
  'two-pots': {
    playerCount: 3,
    contributions: [25, 50, 50],
    chips: [0, 87, 88],
    currentPlayerNumber: 2,
    roundNumber: 4,
  },
  'three-pots': {
    playerCount: 4,
    contributions: [25, 50, 75, 75],
    chips: [0, 0, 87, 88],
    currentPlayerNumber: 3,
    roundNumber: 4,
  },
  'all-in-runout': {
    playerCount: 3,
    contributions: [25, 50, 50],
    chips: [0, 0, 175],
    currentPlayerNumber: 3,
    roundNumber: 1,
    view: 'all-in-runout',
  },
  'deal-flop': {
    playerCount: 3,
    contributions: [10, 10, 10],
    chips: [90, 90, 90],
    currentPlayerNumber: 1,
    roundNumber: 1,
    view: 'deal-flop',
  },
  showdown: {
    playerCount: 3,
    contributions: [20, 20, 20],
    chips: [80, 80, 80],
    currentPlayerNumber: 1,
    roundNumber: 4,
    view: 'showdown',
  },
  'hand-won': {
    playerCount: 3,
    contributions: [0, 0, 0],
    chips: [140, 80, 80],
    currentPlayerNumber: 1,
    roundNumber: 4,
    view: 'hand-won',
  },
  'game-won': {
    playerCount: 2,
    contributions: [0, 0],
    chips: [200, 0],
    currentPlayerNumber: 1,
    roundNumber: 4,
    view: 'game-won',
  },
};

function selectDebugPreset() {
  const preset = debugPresets[debugPresetSelect.value];
  if (!preset) return;

  playerCount.value = preset.playerCount;
  document.querySelector('#starting-money').value = 100;
  drawPlayerNames();
}

function startDebugPreset(presetName) {
  const preset = debugPresets[presetName];
  if (!preset) {
    startHand();
    return true;
  }

  gameHandNumber = 1;
  isGameWon = false;
  roundNumber = preset.roundNumber;
  potAwardIndex = 0;
  lastPotWinnerNumber = null;
  handWinnerNumbers = [];
  lastTurnState = null;
  pendingFold = false;
  dealPromptKind = null;
  antePlayerNumber = playerToDealersLeft(gameSettings.dealerNumber);
  bigBlindPlayerNumber = null;

  Object.values(playersByNumber).forEach((player, index) => {
    player.chips = preset.chips[index];
    player.roundBet = preset.contributions[index];
    player.handContribution = preset.contributions[index];
    player.hasActedThisRound = false;
    player.folded = false;
    player.eliminated = false;
    player.isDealer = player.number === gameSettings.dealerNumber;
  });

  highestRoundBet = Math.max(...preset.contributions);
  recalculatePots();
  gameSettings.antePlayerNumber = antePlayerNumber;
  gameSettings.bigBlindPlayerNumber = null;
  gameSettings.bigBlind = null;
  dealPrompt.hidden = true;
  winnerPicker.hidden = true;
  turnIndicator.hidden = false;
  actionButtons.hidden = false;
  setCurrentPlayer(preset.currentPlayerNumber);

  if (preset.view === 'deal-flop') {
    startNextRound();
  } else if (preset.view === 'all-in-runout') {
    startNextRound();
  } else if (preset.view === 'showdown') {
    showWinnerPicker();
  } else if (preset.view === 'hand-won') {
    finishHand(playersByNumber[preset.currentPlayerNumber]);
  } else if (preset.view === 'game-won') {
    Object.values(playersByNumber).forEach((player) => {
      player.eliminated = player.chips === 0;
    });
    drawPlayerSeats();
    showGameWinner(playersByNumber[preset.currentPlayerNumber]);
    return false;
  }

  return true;
}

function playerToDealersLeft(dealerNumber) {
  const playerNumbers = Object.keys(playersByNumber).map(Number);
  const dealerIndex = playerNumbers.indexOf(dealerNumber);

  for (let step = 1; step <= playerNumbers.length; step += 1) {
    const nextNumber = playerNumbers[(dealerIndex + step) % playerNumbers.length];
    if (!playersByNumber[nextNumber].eliminated) return nextNumber;
  }

  return dealerNumber;
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

function drawPlayerSeats() {
  playerSeats.replaceChildren();
  const players = Object.values(playersByNumber);

  players.forEach((player, index) => {
    const angle = (index / players.length) * Math.PI * 2 + Math.PI / 2;
    const seat = document.createElement('div');
    seat.className = 'player-seat';
    const isCurrentPlayer = player.number === currentPlayerNumber;
    if (isCurrentPlayer) seat.classList.add('current-player');
    if (player.isDealer) seat.classList.add('dealer');
    if (player.folded) seat.classList.add('folded');
    if (player.eliminated) seat.classList.add('eliminated');
    seat.style.setProperty('--x', `${50 + Math.cos(angle) * 43}%`);
    seat.style.setProperty('--y', `${50 + Math.sin(angle) * 43}%`);
    seat.style.setProperty('--rotation', `${angle - Math.PI / 2}rad`);
    const name = document.createElement('span');
    name.className = 'player-seat-name';
    name.textContent = player.name;
    seat.append(name);

    if (!player.eliminated) {
      if (gameSettings.chipDisplayMode === 'pile') {
        seat.append(makePlayerChipPiles(player.chips));
      } else {
        const chips = document.createElement('span');
        chips.className = 'player-seat-chips';
        chips.textContent = player.chips;
        seat.append(chips);
      }
    }
    seat.setAttribute('aria-label', `${player.name}${player.eliminated ? ', out of the game' : `: ${player.chips} chips`}${player.isDealer ? ', dealer' : ''}${isCurrentPlayer ? ', current turn' : ''}${player.folded ? ', folded' : ''}`);
    seat.setAttribute('role', 'button');
    seat.tabIndex = 0;
    if (!player.folded && !player.eliminated && player.chips > 0) {
      seat.addEventListener('click', () => setCurrentPlayer(player.number));
      seat.addEventListener('keydown', (event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault();
          setCurrentPlayer(player.number);
        }
      });
    } else {
      seat.tabIndex = -1;
    }
    playerSeats.append(seat);
  });

  const activeIndex = players.findIndex((player) => player.number === currentPlayerNumber);
  const activeAngle = (activeIndex / players.length) * Math.PI * 2 + Math.PI / 2;
  turnControl.style.setProperty('--rotation', `${activeAngle - Math.PI / 2}rad`);
  updatePotDisplay();
  roundLabel.textContent = ['Preflop', 'Flop', 'Turn', 'River'][roundNumber - 1];
  turnIndicator.setAttribute('aria-label', `Your bet: ${pendingBet}. Total pot: ${totalPotAmount()}`);
  updateBetControls();
  voiceAgent?.updateContext();
}

function setCurrentPlayer(number) {
  if (pendingVoiceAction && pendingVoiceAction.playerNumber !== number) {
    pendingVoiceAction = null;
  }
  raiseMode = false;
  currentPlayerNumber = number;
  gameSettings.currentPlayerNumber = number;
  pendingBet = Math.max(0, highestRoundBet - playersByNumber[number].roundBet);
  pendingFold = false;
  drawPlayerSeats();
}

function nextActivePlayerFrom(number) {
  const playerNumbers = Object.keys(playersByNumber).map(Number);
  const startIndex = playerNumbers.indexOf(number);

  for (let step = 1; step <= playerNumbers.length; step += 1) {
    const nextNumber = playerNumbers[(startIndex + step) % playerNumbers.length];
    if (!playersByNumber[nextNumber].folded && !playersByNumber[nextNumber].eliminated && playersByNumber[nextNumber].chips > 0) return nextNumber;
  }

  return null;
}

function nextPlayer() {
  const nextNumber = nextActivePlayerFrom(currentPlayerNumber);
  if (nextNumber !== null) setCurrentPlayer(nextNumber);
}

function updateBetControls() {
  const player = playersByNumber[currentPlayerNumber];
  const minimumBet = Math.max(0, highestRoundBet - player.roundBet);
  const maximumBet = maximumAdditionalBet(Object.values(playersByNumber), currentPlayerNumber);
  const minimumAllowedBet = Math.min(minimumBet, maximumBet);
  const minimumRaiseBet = Math.max(minimumAllowedBet, highestRoundBet - player.roundBet + 1, 1);
  const canRaise = minimumRaiseBet <= maximumBet;
  pendingBet = Math.max(minimumAllowedBet, Math.min(pendingBet, maximumBet));
  betInput.value = pendingBet;
  betInput.min = minimumAllowedBet;
  betInput.max = maximumBet;
  betIncrease.disabled = pendingFold || pendingBet >= maximumBet;
  betDecrease.disabled = pendingFold || pendingBet <= minimumBet;
  betInput.disabled = pendingFold;
  foldButton.classList.toggle('selected', pendingFold);
  confirmButton.textContent = pendingFold ? 'Confirm fold' : 'Confirm bet';
  callActionButton.textContent = minimumAllowedBet > 0 ? `Call ${minimumAllowedBet}` : 'Call';
  callActionButton.disabled = minimumAllowedBet === 0;
  checkActionButton.disabled = minimumBet > 0;
  allInActionButton.disabled = player.chips <= 0 || maximumBet !== player.chips;
  raiseActionButton.disabled = !canRaise;
  raiseTotalValue.value = String(player.roundBet + pendingBet);
  raiseTotalValue.min = String(player.roundBet + minimumRaiseBet);
  raiseTotalValue.max = String(player.roundBet + maximumBet);
  raiseDecreaseButton.disabled = pendingBet <= minimumRaiseBet;
  raiseIncreaseButton.disabled = pendingBet >= maximumBet;
  raiseShortcutButtons.forEach((button) => {
    const adjustment = Number(button.dataset.raiseAdjustment);
    button.disabled = adjustment < 0 ? pendingBet <= minimumRaiseBet : pendingBet >= maximumBet;
  });
  confirmRaiseButton.disabled = !canRaise || pendingBet < minimumRaiseBet;
  actionMenu.hidden = raiseMode;
  raisePanel.hidden = !raiseMode;
  const undoIsAvailable = canUndoLastTurn();
  undoButton.disabled = !undoIsAvailable;
  actionButtons.classList.toggle('has-undo', undoIsAvailable);
}

function enterRaiseMode() {
  const player = playersByNumber[currentPlayerNumber];
  const maximumBet = maximumAdditionalBet(Object.values(playersByNumber), currentPlayerNumber);
  const minimumBet = Math.max(0, highestRoundBet - player.roundBet);
  const minimumRaiseBet = Math.max(Math.min(minimumBet, maximumBet), highestRoundBet - player.roundBet + 1, 1);
  if (minimumRaiseBet > maximumBet) return;
  raiseMode = true;
  pendingBet = minimumRaiseBet;
  updateBetControls();
}

function cancelRaiseMode() {
  const player = playersByNumber[currentPlayerNumber];
  raiseMode = false;
  pendingBet = Math.min(Math.max(0, highestRoundBet - player.roundBet), player.chips);
  updateBetControls();
}

function setRaiseTotal(total) {
  const player = playersByNumber[currentPlayerNumber];
  const maximumBet = maximumAdditionalBet(Object.values(playersByNumber), currentPlayerNumber);
  const minimumBet = Math.max(0, highestRoundBet - player.roundBet);
  const minimumRaiseBet = Math.max(Math.min(minimumBet, maximumBet), highestRoundBet - player.roundBet + 1, 1);
  const requestedTotal = Number(total);

  if (!Number.isFinite(requestedTotal)) {
    updateBetControls();
    return;
  }

  pendingBet = Math.max(minimumRaiseBet, Math.min(requestedTotal - player.roundBet, maximumBet));
  updateBetControls();
}

function adjustRaiseBy(amount) {
  const player = playersByNumber[currentPlayerNumber];
  setRaiseTotal(player.roundBet + pendingBet + amount);
}

function closeButtonHelp() {
  buttonHelp.hidden = true;
}

function captureTurnState() {
  return {
    currentPlayerNumber,
    roundNumber,
    highestRoundBet,
    players: Object.fromEntries(Object.values(playersByNumber).map((player) => [player.number, {
      chips: player.chips,
      roundBet: player.roundBet,
      handContribution: player.handContribution,
      hasActedThisRound: player.hasActedThisRound,
      folded: player.folded,
    }])),
  };
}

function canUndoLastTurn(fromShowdown = false) {
  return lastTurnState !== null && (fromShowdown || currentPlayerNumber !== lastTurnState.currentPlayerNumber);
}

function undoLastTurn(fromShowdown = false) {
  if (!canUndoLastTurn(fromShowdown)) return;

  raiseMode = false;
  Object.entries(lastTurnState.players).forEach(([number, playerState]) => {
    Object.assign(playersByNumber[number], playerState);
  });
  currentPlayerNumber = lastTurnState.currentPlayerNumber;
  roundNumber = lastTurnState.roundNumber;
  recalculatePots();
  highestRoundBet = lastTurnState.highestRoundBet;
  pendingBet = Math.max(0, highestRoundBet - playersByNumber[currentPlayerNumber].roundBet);
  pendingFold = false;
  pendingVoiceAction = null;
  gameSettings.currentPlayerNumber = currentPlayerNumber;
  lastTurnState = null;
  if (fromShowdown) {
    potAwardIndex = 0;
    lastPotWinnerNumber = null;
    handWinnerNumbers = [];
    isGameWon = false;
    winnerPicker.hidden = true;
    showdownUndoButton.hidden = true;
    dealPromptKind = null;
    dealPrompt.hidden = true;
    turnIndicator.hidden = false;
    actionButtons.hidden = false;
  }
  drawPlayerSeats();
}

function allActivePlayersHaveMatchedBet() {
  return hasBettingRoundFinished(Object.values(playersByNumber), highestRoundBet);
}

function remainingCommunityCards() {
  return ['the flop', 'the turn', 'the river'].slice(roundNumber - 1);
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

function startNextRound() {
  if (roundNumber >= 4) {
    showWinnerPicker();
    return;
  }

  const playersWhoCanStillBet = Object.values(playersByNumber)
    .filter((player) => !player.folded && !player.eliminated && player.chips > 0);
  if (playersWhoCanStillBet.length <= 1) {
    const cards = remainingCommunityCards();
    const cardsToDeal = formatCardList(cards);
    turnIndicator.hidden = true;
    actionButtons.hidden = true;
    dealPromptKind = 'all-in-runout';
    dealMessage.textContent = `Deal ${cardsToDeal}. Press OK for showdown.`;
    dealPrompt.hidden = false;
    return;
  }
  lastTurnState = null;

  const nextCard = ['the flop', 'the turn', 'the river'][roundNumber - 1];
  turnIndicator.hidden = true;
  actionButtons.hidden = true;
  dealPromptKind = 'community-cards';
  dealMessage.textContent = `Deal ${nextCard}. Press OK to continue.`;
  dealPrompt.hidden = false;
}

function beginNextRound() {
  dealPromptKind = null;
  dealPrompt.hidden = true;
  turnIndicator.hidden = false;
  actionButtons.hidden = false;
  roundNumber += 1;
  Object.values(playersByNumber).forEach((player) => {
    player.roundBet = 0;
    player.hasActedThisRound = false;
  });
  highestRoundBet = 0;
  const firstPlayer = playersByNumber[antePlayerNumber].folded || playersByNumber[antePlayerNumber].chips === 0
    ? nextActivePlayerFrom(antePlayerNumber)
    : antePlayerNumber;
  if (firstPlayer === null) {
    startNextRound();
  } else {
    setCurrentPlayer(firstPlayer);
  }
}

function showWinnerPicker() {
  const activePlayers = Object.values(playersByNumber).filter((player) => !player.folded && !player.eliminated);
  potAwardIndex = 0;
  lastPotWinnerNumber = null;
  handWinnerNumbers = [];
  if (pots.length === 0) {
    showPotWinnerPicker('Who had the best cards?', activePlayers, (winnerNumber) => finishHand(playersByNumber[winnerNumber]));
    return;
  }
  awardNextPot();
}

function showPotWinnerPicker(question, players, awardFunction, splitFunction = null) {
  turnIndicator.hidden = true;
  actionButtons.hidden = true;
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

function eligiblePlayersForPot(potLayer) {
  return potLayer.eligiblePlayerNumbers
    .map((number) => playersByNumber[number])
    .filter((player) => player && !player.folded && !player.eliminated);
}

function awardPot(potIndex, winnerNumber) {
  const potLayer = pots[potIndex];
  const winner = playersByNumber[winnerNumber];
  if (!potLayer || potLayer.amount <= 0 || !winner || !potLayer.eligiblePlayerNumbers.includes(winnerNumber)) return;

  winner.chips += potLayer.amount;
  potLayer.amount = 0;
  lastPotWinnerNumber = winnerNumber;
  if (!handWinnerNumbers.includes(winnerNumber)) handWinnerNumbers.push(winnerNumber);
  potAwardIndex = potIndex + 1;
  syncPotsToGameSettings();
  drawPlayerSeats();
  awardNextPot();
}

function playersInOddChipOrder(winnerNumbers) {
  const playerNumbers = Object.keys(playersByNumber).map(Number);
  const dealerIndex = playerNumbers.indexOf(gameSettings.dealerNumber);
  return [...new Set(winnerNumbers)].sort((first, second) => {
    const firstDistance = (playerNumbers.indexOf(first) - dealerIndex + playerNumbers.length) % playerNumbers.length || playerNumbers.length;
    const secondDistance = (playerNumbers.indexOf(second) - dealerIndex + playerNumbers.length) % playerNumbers.length || playerNumbers.length;
    return firstDistance - secondDistance;
  });
}

function awardSplitPot(potIndex, winnerNumbers) {
  const potLayer = pots[potIndex];
  const validWinnerNumbers = playersInOddChipOrder(winnerNumbers)
    .filter((number) => potLayer?.eligiblePlayerNumbers.includes(number));
  if (!potLayer || potLayer.amount <= 0 || validWinnerNumbers.length < 2) return;

  const originalAmount = potLayer.amount;
  const awards = splitPotAmount(originalAmount, validWinnerNumbers);
  awards.forEach((award) => {
    playersByNumber[award.number].chips += award.amount;
    if (!handWinnerNumbers.includes(award.number)) handWinnerNumbers.push(award.number);
  });
  potLayer.amount = 0;
  lastPotWinnerNumber = awards[0].number;
  potAwardIndex = potIndex + 1;
  syncPotsToGameSettings();
  drawPlayerSeats();
  awardNextPot();
}

function awardNextPot() {
  while (potAwardIndex < pots.length && pots[potAwardIndex].amount <= 0) potAwardIndex += 1;

  if (potAwardIndex >= pots.length) {
    const fallbackWinner = Object.values(playersByNumber).find((player) => !player.folded && !player.eliminated);
    const winners = handWinnerNumbers.map((number) => playersByNumber[number]).filter(Boolean);
    finishHand(winners.length > 0 ? winners : [playersByNumber[lastPotWinnerNumber] || fallbackWinner]);
    return;
  }

  const potLayer = pots[potAwardIndex];
  const eligiblePlayers = eligiblePlayersForPot(potLayer);
  if (eligiblePlayers.length <= 1) {
    const fallbackWinner = Object.values(playersByNumber).find((player) => !player.folded && !player.eliminated);
    awardPot(potAwardIndex, eligiblePlayers[0]?.number || fallbackWinner?.number);
    return;
  }

  const question = potAwardIndex === 0
    ? 'Who had the best cards?'
    : `Who wins side pot ${potAwardIndex}?`;
  showPotWinnerPicker(
    question,
    eligiblePlayers,
    (winnerNumber) => awardPot(potAwardIndex, winnerNumber),
    (winnerNumbers) => awardSplitPot(potAwardIndex, winnerNumbers),
  );
}

function awardAllPotsTo(winnerNumber) {
  const winner = playersByNumber[winnerNumber];
  winner.chips += totalPotAmount();
  pots.forEach((potLayer) => {
    potLayer.amount = 0;
  });
  lastPotWinnerNumber = winnerNumber;
  handWinnerNumbers = [winnerNumber];
  syncPotsToGameSettings();
  finishHand(winner);
}

function finishHand(winnerOrWinners) {
  const winners = (Array.isArray(winnerOrWinners) ? winnerOrWinners : [winnerOrWinners]).filter(Boolean);
  Object.values(playersByNumber).forEach((player) => {
    if (player.chips === 0) player.eliminated = true;
  });
  isGameWon = true;

  const playersWithMoney = Object.values(playersByNumber).filter((player) => player.chips > 0);
  if (playersWithMoney.length === 1) {
    showGameWinner(playersWithMoney[0]);
    return;
  }

  turnIndicator.hidden = true;
  actionButtons.hidden = true;
  winnerPicker.hidden = false;
  showdownUndoButton.hidden = true;
  const winnerNames = formatNameList(winners.map((winner) => winner.name));
  winnerQuestion.textContent = `${winnerNames} ${winners.length === 1 ? 'wins' : 'win'} the hand!`;
  winnerOptions.replaceChildren();
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = 'Close';
  closeButton.addEventListener('click', startNewHand);
  winnerOptions.append(closeButton);
  drawPlayerSeats();
}

function showGameWinner(winner) {
  allowScreenToSleep();
  gameScreen.hidden = true;
  gameWinnerMessage.textContent = `${winner.name} wins!`;
  gameWinnerScreen.hidden = false;
}

function postBlind(playerNumber, requestedAmount) {
  const player = playersByNumber[playerNumber];
  const amount = Math.min(requestedAmount, player.chips);

  player.chips -= amount;
  player.roundBet += amount;
  player.handContribution += amount;
  player.hasActedThisRound = true;
  highestRoundBet = Math.max(highestRoundBet, player.roundBet);
  recalculatePots();
}

function startHand() {
  gameHandNumber += 1;
  isGameWon = false;
  roundNumber = 1;
  pots = [];
  potAwardIndex = 0;
  lastPotWinnerNumber = null;
  handWinnerNumbers = [];
  highestRoundBet = 0;
  pendingBet = 0;
  pendingFold = false;
  lastTurnState = null;
  bigBlindPlayerNumber = null;
  pendingVoiceAction = null;

  Object.values(playersByNumber).forEach((player) => {
    player.folded = player.eliminated;
    player.roundBet = 0;
    player.handContribution = 0;
    player.hasActedThisRound = false;
    player.isDealer = player.number === gameSettings.dealerNumber;
  });

  antePlayerNumber = playerToDealersLeft(gameSettings.dealerNumber);
  if (gameSettings.useBigBlind) {
    bigBlindPlayerNumber = playerToDealersLeft(antePlayerNumber);
  }
  gameSettings.antePlayerNumber = antePlayerNumber;
  gameSettings.bigBlindPlayerNumber = bigBlindPlayerNumber;
  gameSettings.bigBlind = bigBlindPlayerNumber === null ? null : gameSettings.ante * 2;

  postBlind(antePlayerNumber, gameSettings.ante);
  if (bigBlindPlayerNumber !== null) {
    postBlind(bigBlindPlayerNumber, gameSettings.bigBlind);
  }

  turnIndicator.hidden = true;
  actionButtons.hidden = true;
  dealPromptKind = 'hole-cards';
  const dealer = playersByNumber[gameSettings.dealerNumber];
  const introduction = gameHandNumber === 1 ? `Game is Texas Hold'em. Ante is ${gameSettings.ante}.` : `New hand. Ante is ${gameSettings.ante}.`;
  dealMessage.textContent = `${introduction} ${dealer.name}, you're the dealer. Deal two cards face down to each player. Press OK when done.`;
  dealPrompt.hidden = false;
  setCurrentPlayer(bigBlindPlayerNumber ?? antePlayerNumber);
  nextPlayer();
}

function startNewHand() {
  const nextDealerNumber = playerToDealersLeft(gameSettings.dealerNumber);
  if (nextDealerNumber === gameSettings.firstDealerNumber) {
    gameSettings.ante += gameSettings.anteIncrease;
  }
  gameSettings.dealerNumber = nextDealerNumber;
  winnerPicker.hidden = true;
  dealPrompt.hidden = true;
  turnIndicator.hidden = false;
  actionButtons.hidden = false;
  startHand();
}

function finishTurn() {
  const activePlayers = Object.values(playersByNumber).filter((player) => !player.folded);

  if (activePlayers.length === 1) {
    lastTurnState = null;
    awardAllPotsTo(activePlayers[0].number);
  } else if (allActivePlayersHaveMatchedBet()) {
    startNextRound();
  } else {
    nextPlayer();
  }
}

function confirmTurn() {
  const player = playersByNumber[currentPlayerNumber];
  lastTurnState = captureTurnState();

  if (pendingFold) {
    player.folded = true;
    recalculatePots();
  } else {
    const additionalChips = pendingBet;
    player.chips -= additionalChips;
    player.roundBet += additionalChips;
    player.handContribution += additionalChips;
    player.hasActedThisRound = true;
    highestRoundBet = Math.max(highestRoundBet, player.roundBet);
    recalculatePots();
  }

  finishTurn();
}

function foldCurrentPlayer() {
  pendingFold = true;
  updateBetControls();

}

function betCurrentPlayer(amount) {
  const player = playersByNumber[currentPlayerNumber];
  const requestedAmount = Number(amount);

  if (!Number.isFinite(requestedAmount) || requestedAmount < 0) return false;

  pendingFold = false;
  const maximumBet = maximumAdditionalBet(Object.values(playersByNumber), currentPlayerNumber);
  pendingBet = Math.min(requestedAmount, maximumBet);
  updateBetControls();
  return true;
}

function confirm() {
  confirmTurn();
}

function cardsAreDealt() {
  if (dealPrompt.hidden) return false;

  if (dealPromptKind === 'hole-cards') {
    dealPromptKind = null;
    dealPrompt.hidden = true;
    turnIndicator.hidden = false;
    actionButtons.hidden = false;
    drawPlayerSeats();
    return true;
  }

  if (dealPromptKind === 'all-in-runout') {
    dealPromptKind = null;
    dealPrompt.hidden = true;
    roundNumber = 4;
    showWinnerPicker();
    return true;
  }

  beginNextRound();
  return true;
}

playerCount.addEventListener('change', () => {
  drawPlayerNames();
  useBigBlindCheckbox.checked = Number(playerCount.value) >= 6;
});
debugPresetSelect.addEventListener('change', selectDebugPreset);
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
  if (document.visibilityState === 'visible' && !gameScreen.hidden && !isGameWon) {
    keepScreenAwake();
  }
});
callActionButton.addEventListener('click', () => {
  if (callActionButton.disabled) return;
  const player = playersByNumber[currentPlayerNumber];
  raiseMode = false;
  pendingBet = Math.min(Math.max(0, highestRoundBet - player.roundBet), player.chips);
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
  const player = playersByNumber[currentPlayerNumber];
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
betIncrease.addEventListener('click', () => {
  betCurrentPlayer(pendingBet + 1);
});
betDecrease.addEventListener('click', () => {
  betCurrentPlayer(pendingBet - 1);
});
betInput.addEventListener('change', () => {
  betCurrentPlayer(betInput.value);
});
foldButton.addEventListener('click', () => {
  if (pendingFold) {
    pendingFold = false;
    updateBetControls();
  } else {
    foldCurrentPlayer();
  }
});
confirmButton.addEventListener('click', confirm);
undoButton.addEventListener('click', () => undoLastTurn());
showdownUndoButton.addEventListener('click', () => undoLastTurn(true));
dealOkButton.addEventListener('click', cardsAreDealt);
recordingButton.addEventListener('click', toggleRecording);
form.addEventListener('submit', (event) => {
  event.preventDefault();
  gameSettings = {
    playerCount: Number(playerCount.value),
    startingMoney: Number(document.querySelector('#starting-money').value),
    ante: Number(document.querySelector('#ante').value),
    anteIncrease: Number(document.querySelector('#ante-increase').value),
    useBigBlind: useBigBlindCheckbox.checked,
    dealerNumber: Number(dealerSelect.value),
    firstDealerNumber: Number(dealerSelect.value),
    playerNames: [...playerNames.querySelectorAll('input')].map((input, index) => input.value || `Player ${index + 1}`),
    startMicrophoneAutomatically: startMicrophoneAutomaticallyCheckbox.checked,
    showVoiceTranscript: showVoiceTranscriptCheckbox.checked,
    chipDisplayMode,
    chipDenominations: selectedChipDenominations(),
    voice: selectedVoiceSettings(),
  };
  gameHandNumber = 0;
  saveLastGameSettings();
  makePlayers();
  setupScreen.hidden = true;
  voiceCustomizationScreen.hidden = true;
  chipDenominationsScreen.hidden = true;
  gameScreen.hidden = false;
  gameWinnerScreen.hidden = true;
  winnerPicker.hidden = true;
  dealPrompt.hidden = true;
  turnIndicator.hidden = false;
  actionButtons.hidden = false;
  keepScreenAwake();
  startDebugPreset(debugPresetSelect.value);
  connectVoiceAgent()
    .then(async (agent) => {
      if (gameSettings.startMicrophoneAutomatically) await agent.startMicrophone();
      updateRecordingButton();
    })
    .catch((error) => {
      const errorMessage = `Voice unavailable: ${error.message}`;
      setVoiceStatus(errorMessage);
      setVoiceTranscript(errorMessage);
    });
});

drawPlayerNames();
updateChipDisplayModeButton();
restoreLastGameSettings();
voiceAudioTest.hidden = !['localhost', '127.0.0.1'].includes(window.location.hostname);
