const playerCount = document.querySelector('#player-count');
const playerNames = document.querySelector('#player-names');
const form = document.querySelector('#setup-form');
const message = document.querySelector('#message');
const dealerSelect = document.querySelector('#dealer');
const setupScreen = document.querySelector('#setup-screen');
const voiceCustomizationScreen = document.querySelector('#voice-customization-screen');
const gameScreen = document.querySelector('#game-screen');
const gameWinnerScreen = document.querySelector('#game-winner-screen');
const gameWinnerMessage = document.querySelector('#game-winner-message');
const playerSeats = document.querySelector('#player-seats');
const turnIndicator = document.querySelector('#turn-indicator');
const betInput = document.querySelector('#current-bet');
const betIncrease = document.querySelector('#bet-increase');
const betDecrease = document.querySelector('#bet-decrease');
const foldButton = document.querySelector('#fold-button');
const confirmButton = document.querySelector('#confirm-button');
const undoButton = document.querySelector('#undo-button');
const potValue = document.querySelector('#pot-value');
const potDisplay = document.querySelector('#pot-display');
const sidePotValue = document.querySelector('#side-pot-value');
const roundLabel = document.querySelector('#round-label');
const actionButtons = document.querySelector('.action-buttons');
const winnerPicker = document.querySelector('#winner-picker');
const winnerQuestion = document.querySelector('#winner-question');
const winnerOptions = document.querySelector('#winner-options');
const dealPrompt = document.querySelector('#deal-prompt');
const dealMessage = document.querySelector('#deal-message');
const dealOkButton = document.querySelector('#deal-ok-button');
const testVoiceButton = document.querySelector('#test-voice-button');
const recordingButton = document.querySelector('#recording-button');
const voiceStatus = document.querySelector('#voice-status');
const voiceTranscript = document.querySelector('#voice-transcript');
const startAiAutomaticallyCheckbox = document.querySelector('#start-ai-automatically');
const showVoiceTranscriptCheckbox = document.querySelector('#show-voice-transcript');
const voiceCustomizationButton = document.querySelector('#voice-customization-button');
const voiceCustomizationBack = document.querySelector('#voice-customization-back');
const voiceChoice = document.querySelector('#voice-choice');
const voiceAccent = document.querySelector('#voice-accent');
const voicePersonality = document.querySelector('#voice-personality');
const voicePace = document.querySelector('#voice-pace');
const voicePreviewStatus = document.querySelector('#voice-preview-status');

// This is where the game screen can read the settings when we add its controls.
let gameSettings = null;
let playersByNumber = {};
let currentPlayerNumber = 1;
let antePlayerNumber = null;
let bigBlindPlayerNumber = null;
let pot = 0;
let highestRoundBet = 0;
let pendingBet = 0;
let pendingFold = false;
let isGameWon = false;
let roundNumber = 1;
let sidePot = 0;
let sidePotActive = false;
let sidePotEligiblePlayers = [];
let lastTurnState = null;
let gameHistory = [];
let gameHandNumber = 0;
let dealPromptKind = null;
let openingTurnAnnouncementPending = false;
// These are one-second audio files kept only in this browser's memory.
// The newest minute is useful for a future speech-to-text feature; nothing
// is saved to the phone's file system.
let microphoneStream = null;
let microphoneRecorder = null;
let recentAudioFiles = [];
let audioCleanupTimer = null;
let realtimePeerConnection = null;
let realtimeDataChannel = null;
let realtimeAudio = null;
let realtimeSessionConfigured = false;
let realtimeStatePollTimer = null;
let realtimeInitialNarrationTimer = null;
let realtimeStateSyncQueued = false;
let lastRealtimeGameStateFingerprint = null;
let realtimeGameStateVersion = 0;
let realtimeResponseActive = false;
let realtimeUserResponseQueued = null;
let queuedRealtimeNarration = null;
let lastRealtimeNarration = null;
let showVoiceTranscript = false;
let screenWakeLock = null;
let voicePreviewConnection = null;
let voicePreviewChannel = null;
let voicePreviewAudio = null;
const lastGameSettingsKey = 'robodeal-last-game-settings';

function selectedVoiceSettings() {
  return {
    name: voiceChoice.value,
    accent: voiceAccent.value,
    personality: voicePersonality.value,
    pace: voicePace.value,
  };
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
  drawPlayerNames();

  [...playerNames.querySelectorAll('input')].forEach((input, index) => {
    input.value = settings.playerNames?.[index] || '';
  });
  drawDealerOptions(String(settings.dealerNumber));
  dealerSelect.value = String(settings.dealerNumber);
  startAiAutomaticallyCheckbox.checked = settings.startAiAutomatically !== false;
  showVoiceTranscriptCheckbox.checked = Boolean(savedGame.showVoiceTranscript);

  if (settings.voice) {
    if ([...voiceChoice.options].some((option) => option.value === settings.voice.name)) voiceChoice.value = settings.voice.name;
    if ([...voiceAccent.options].some((option) => option.value === settings.voice.accent)) voiceAccent.value = settings.voice.accent;
    if ([...voicePersonality.options].some((option) => option.value === settings.voice.personality)) voicePersonality.value = settings.voice.personality;
    if ([...voicePace.options].some((option) => option.value === settings.voice.pace)) voicePace.value = settings.voice.pace;
  }

  message.textContent = 'Last game settings restored.';
}

function saveLastGameSettings() {
  try {
    localStorage.setItem(lastGameSettingsKey, JSON.stringify({
      settings: gameSettings,
      showVoiceTranscript,
    }));
  } catch {
    // The game still works if this browser has disabled saved site data.
  }
}

function voiceStyleInstructions(voiceSettings) {
  const accentInstruction = voiceSettings.accent === 'neutral' ? 'Use a neutral accent.' : `Use a ${voiceSettings.accent} accent.`;
  return `Your personality is ${voiceSettings.personality}. ${accentInstruction} Speak at a ${voiceSettings.pace} pace.`;
}

async function keepScreenAwake() {
  if (!('wakeLock' in navigator) || document.visibilityState !== 'visible') return;

  try {
    screenWakeLock = await navigator.wakeLock.request('screen');
    screenWakeLock.addEventListener('release', () => {
      screenWakeLock = null;
    }, { once: true });
  } catch (error) {
    // Low-battery and power-saving modes may decline this request. The game
    // still works normally when the phone decides not to keep the screen on.
    console.info('Screen wake lock was not available:', error.message);
  }
}

async function allowScreenToSleep() {
  await screenWakeLock?.release();
  screenWakeLock = null;
}

function discardOldAudioFiles() {
  const oneMinuteAgo = Date.now() - 60_000;
  recentAudioFiles = recentAudioFiles.filter((audioFile) => audioFile.createdAt >= oneMinuteAgo);
}

function setVoiceStatus(status) {
  voiceStatus.textContent = showVoiceTranscript ? status : '';
  voiceStatus.hidden = !showVoiceTranscript || !status;
}

function setVoiceTranscript(transcript) {
  voiceTranscript.textContent = transcript;
  voiceTranscript.hidden = !showVoiceTranscript || !transcript;
}

function logGameEvent(text) {
  gameHistory.push({
    hand: gameHandNumber,
    round: ['Preflop', 'Flop', 'Turn', 'River'][roundNumber - 1] || 'Setup',
    text,
  });
  scheduleRealtimeGameStateSync();
}

function getGamePhase() {
  if (!gameWinnerScreen.hidden) return 'game over';
  if (gameScreen.hidden) return 'setup';
  if (!dealPrompt.hidden) return dealPromptKind === 'hole-cards' ? 'waiting for hole cards to be dealt' : 'waiting for community cards to be dealt';
  if (!winnerPicker.hidden) return isGameWon ? 'hand complete' : 'choosing a pot winner';
  return 'betting';
}

function getRealtimeGameState() {
  // This makes a plain copy. The AI can read this copy, but cannot change the
  // real game variables. Only the approved functions below can affect a turn.
  return {
    stateVersion: realtimeGameStateVersion,
    gamePhase: getGamePhase(),
    dealInstruction: dealPrompt.hidden ? null : dealMessage.textContent,
    dealPromptKind,
    winnerQuestion: winnerPicker.hidden ? null : winnerQuestion.textContent,
    gameSettings: gameSettings ? { ...gameSettings } : null,
    playersByNumber: Object.fromEntries(Object.entries(playersByNumber).map(([number, player]) => [number, { ...player }])),
    currentPlayerNumber,
    antePlayerNumber,
    bigBlindPlayerNumber,
    pot,
    highestRoundBet,
    pendingBet,
    pendingFold,
    isGameWon,
    roundNumber,
    sidePot,
    sidePotActive,
    sidePotEligiblePlayers: [...sidePotEligiblePlayers],
    lastTurnState: lastTurnState ? JSON.parse(JSON.stringify(lastTurnState)) : null,
    gameHistory: [...gameHistory],
    recentAudioFileCount: recentAudioFiles.length,
    isRecording: microphoneRecorder?.state === 'recording',
  };
}

function realtimeGameStateFingerprint() {
  const state = getRealtimeGameState();
  // Recording bookkeeping changes continuously but does not alter the poker
  // game. Everything else in the snapshot is authoritative game data.
  delete state.stateVersion;
  delete state.recentAudioFileCount;
  delete state.isRecording;
  return JSON.stringify(state);
}

function getRealtimeNarration() {
  const player = playersByNumber[currentPlayerNumber];
  if (!player) return null;

  if (dealPromptKind === 'hole-cards') {
    const dealer = Object.values(playersByNumber).find((candidate) => candidate.isDealer);
    const introduction = gameHandNumber === 1 ? `Game is Texas Hold'em. Ante is ${gameSettings.ante}.` : `New hand. Ante is ${gameSettings.ante}.`;
    return `${introduction} ${dealer.name}, you're the dealer. Deal two cards face down to each player. Press OK when done.`;
  }

  if (openingTurnAnnouncementPending) {
    const smallBlind = playersByNumber[antePlayerNumber];
    const bigBlind = playersByNumber[bigBlindPlayerNumber];
    const blindNarration = bigBlind
      ? `${smallBlind.name}, you're the small blind. ${bigBlind.name}, you're the big blind.`
      : `${smallBlind.name}, you're the small blind.`;
    return `${blindNarration} ${player.name}, you're first.`;
  }

  const amountToCall = Math.max(0, highestRoundBet - player.roundBet);
  const minimumBet = Math.min(amountToCall, player.chips);
  const potNarration = sidePotActive ? `Main pot, ${pot}. Side pot, ${sidePot}.` : `Pot, ${pot}.`;
  return `${player.name}, it's your turn. Minimum bet, ${minimumBet}. ${potNarration} ${player.chips} chips behind.`;
}

function isPokerRelatedTranscript(transcript) {
  const normalizedTranscript = transcript.toLowerCase();
  const mentionsPlayer = Object.values(playersByNumber).some((player) =>
    normalizedTranscript.includes(player.name.toLowerCase()));
  const mentionsPoker = /\b(poker|turn|pot|chips?|money|bet|wager|fold|check|call|raise|all[ -]?in|deal|dealt|cards?|flop|river|ante|dealer|winner|showdown|undo)\b/.test(normalizedTranscript);
  return mentionsPlayer || mentionsPoker;
}

function flushRealtimeResponseQueue() {
  if (realtimeResponseActive || realtimeDataChannel?.readyState !== 'open') return;

  if (realtimeUserResponseQueued) {
    const queuedUserResponse = realtimeUserResponseQueued;
    realtimeUserResponseQueued = null;
    realtimeResponseActive = true;
    sendRealtimeEvent({
      type: 'response.create',
      response: {
        // Consider only this voice turn. Earlier microphone items may contain
        // ignored background speech and must never influence a later reply.
        ...(queuedUserResponse.itemId ? {
          input: [{ type: 'item_reference', id: queuedUserResponse.itemId }],
        } : {}),
        instructions: realtimeInstructions(),
      },
    });
    return;
  }

  if (!queuedRealtimeNarration || queuedRealtimeNarration === lastRealtimeNarration) return;

  const narration = queuedRealtimeNarration;
  queuedRealtimeNarration = null;
  lastRealtimeNarration = narration;
  realtimeResponseActive = true;
  sendRealtimeEvent({
    type: 'response.create',
    response: {
      // Keep deterministic announcements outside the user's conversation and
      // give the model an explicit input instead of an empty-context prompt.
      conversation: 'none',
      metadata: { kind: 'game-state-narration' },
      input: [{
        type: 'message',
        role: 'user',
        content: [{
          type: 'input_text',
          text: `In a crisp professional poker dealer cadence, say exactly this and nothing else: ${narration}`,
        }],
      }],
      tool_choice: 'none',
    },
  });
}

function queueRealtimeNarration() {
  const narration = getRealtimeNarration();
  if (!narration || narration === lastRealtimeNarration) return;

  queuedRealtimeNarration = narration;
  openingTurnAnnouncementPending = false;
  flushRealtimeResponseQueue();
}

function scheduleRealtimeGameStateSync() {
  if (realtimeStateSyncQueued) return;

  realtimeStateSyncQueued = true;
  queueMicrotask(() => {
    realtimeStateSyncQueued = false;
    updateRealtimeGameState();
  });
}

function realtimeInstructions() {
  const voiceSettings = gameSettings?.voice || { accent: 'neutral', personality: 'friendly', pace: 'steady' };
  const playerNames = Object.values(playersByNumber).map((player) => player.name).join(', ');
  return `You are the voice control and dealer for a real-card poker game. This response was created with the newest authoritative, read-only game snapshot: ${JSON.stringify(getRealtimeGameState())}\n\nUse only this snapshot for the current voice turn. Ignore conflicting or older game details elsewhere in the conversation. Never recite, summarize, or list the snapshot or its fields. Say only the specific poker fact needed for the current command or question. Pass this snapshot's exact stateVersion to any action function; never guess or reuse a version from an older turn. The players are: ${playerNames}. Always use each player's name from playersByNumber. Never call a named player "Player 1", "Player 2", or any other number. ${voiceStyleInstructions(voiceSettings)} Only respond to clear poker-related speech: a poker action, a poker question, or an instruction about dealing cards. For all other speech, stay completely silent: do not speak, ask a question, or call a function. This includes casual conversation, background talk, unrelated jokes, and people talking to each other. Speak in exactly one very short poker-dealer phrase only after a successful poker action or a clear poker question. Say only the player, action, and amount when needed: "Sam bets 5." "Aaron calls." "Sam folds." "Deal the flop." Do not add greetings, explanations, commentary, or a second sentence. If a poker action is unclear, ask only one short poker question, such as "Call or raise?", and do not call an action function. Never claim to change the game yourself. To do anything, use only the listed poker action functions. Use check only when it is legal. A raise amount is the number of additional chips to bet now. Clear action commands are immediately confirmed by their action function; call exactly one action function. When the table says the two hole cards, flop, turn, or river have been dealt, call cardsAreDealt.`;
}

const stateVersionProperty = {
  stateVersion: {
    type: 'number',
    description: 'The exact stateVersion shown in the authoritative snapshot for this voice turn.',
  },
};

const realtimeTools = [
  { type: 'function', name: 'foldCurrentPlayer', description: 'Immediately fold and confirm the current player.', parameters: { type: 'object', properties: stateVersionProperty, required: ['stateVersion'], additionalProperties: false } },
  { type: 'function', name: 'checkCurrentPlayer', description: 'Immediately check and confirm for the current player, only when checking is legal.', parameters: { type: 'object', properties: stateVersionProperty, required: ['stateVersion'], additionalProperties: false } },
  { type: 'function', name: 'callCurrentPlayer', description: 'Immediately call and confirm the current bet for the current player.', parameters: { type: 'object', properties: stateVersionProperty, required: ['stateVersion'], additionalProperties: false } },
  { type: 'function', name: 'betCurrentPlayer', description: 'Immediately bet and confirm this many additional chips for the current player.', parameters: { type: 'object', properties: { ...stateVersionProperty, amount: { type: 'number', description: 'Additional chips to bet now.' } }, required: ['stateVersion', 'amount'], additionalProperties: false } },
  { type: 'function', name: 'goAllIn', description: 'Immediately bet every remaining chip and confirm for the current player.', parameters: { type: 'object', properties: stateVersionProperty, required: ['stateVersion'], additionalProperties: false } },
  { type: 'function', name: 'cardsAreDealt', description: 'Continue after the physical hole cards, flop, turn, or river have been dealt. This does the same thing as pressing the OK button in the deal prompt.', parameters: { type: 'object', properties: stateVersionProperty, required: ['stateVersion'], additionalProperties: false } },
];

function sendRealtimeEvent(event) {
  if (realtimeDataChannel?.readyState === 'open') {
    realtimeDataChannel.send(JSON.stringify(event));
  }
}

function updateRealtimeGameState({ force = false, narrate = true } = {}) {
  if (realtimeDataChannel?.readyState !== 'open') return false;

  const fingerprint = realtimeGameStateFingerprint();
  if (!force && fingerprint === lastRealtimeGameStateFingerprint) return false;

  lastRealtimeGameStateFingerprint = fingerprint;
  realtimeGameStateVersion += 1;

  const session = {
    type: 'realtime',
    instructions: realtimeInstructions(),
    tools: realtimeTools,
    tool_choice: 'auto',
    output_modalities: ['audio'],
  };

  // Voice settings can only be chosen before the AI has spoken. Later state
  // updates deliberately leave them alone.
  if (!realtimeSessionConfigured) {
    session.audio = {
      input: {
        noise_reduction: { type: 'far_field' },
        transcription: { model: 'gpt-4o-transcribe', language: 'en' },
        // VAD still detects and commits each voice turn, but the app waits for
        // its transcription and then creates a response with fresh game state.
        turn_detection: { type: 'server_vad', create_response: false, interrupt_response: true },
      },
      output: { voice: gameSettings?.voice?.name || 'marin' },
    };
  }

  sendRealtimeEvent({
    event_id: `game-state-${realtimeGameStateVersion}`,
    type: 'session.update',
    session,
  });
  realtimeSessionConfigured = true;
  if (narrate && realtimeInitialNarrationTimer === null) queueRealtimeNarration();
  return true;
}

function callRealtimeTool(name, argumentsText) {
  const args = argumentsText ? JSON.parse(argumentsText) : {};
  if (args.stateVersion !== realtimeGameStateVersion) {
    throw new Error(`Stale game state. Expected stateVersion ${realtimeGameStateVersion}, received ${args.stateVersion}. Use the latest gameState in this output.`);
  }

  const allowedFunctions = {
    foldCurrentPlayer,
    checkCurrentPlayer,
    callCurrentPlayer,
    betCurrentPlayer,
    goAllIn,
    cardsAreDealt,
  };
  const action = allowedFunctions[name];
  if (!action) throw new Error(`The AI tried to call an unapproved function: ${name}`);

  const actionText = name === 'betCurrentPlayer' ? `AI action: bet ${args.amount}` : `AI action: ${name.replace('CurrentPlayer', '').replace(/([A-Z])/g, ' $1').toLowerCase()}`;
  setVoiceTranscript(actionText);

  // This is the only bridge from OpenAI back into the poker game.
  // The AI has no direct access to the real variables above.
  if (name === 'betCurrentPlayer') {
    if (!action(args.amount)) return false;
    confirm();
    return true;
  }

  if (name === 'cardsAreDealt') return action();

  const selected = action();
  if (selected === false) return false;
  confirm();
  return true;
}

function handleRealtimeEvent(event) {
  if (event.type === 'conversation.item.input_audio_transcription.delta') {
    setVoiceTranscript(`Hearing: ${event.delta}`);
    return;
  }

  if (event.type === 'conversation.item.input_audio_transcription.completed') {
    setVoiceTranscript(`Heard: “${event.transcript}”`);
    if (!isPokerRelatedTranscript(event.transcript)) {
      setVoiceTranscript(`Ignored unrelated speech: “${event.transcript}”`);
      return;
    }
    logGameEvent(`Table heard: “${event.transcript}”`);
    // The transcript marks the completed user turn. Refresh the session first,
    // then create its response; data-channel events are processed in order.
    realtimeUserResponseQueued = { itemId: event.item_id };
    updateRealtimeGameState({ force: true });
    flushRealtimeResponseQueue();
    return;
  }

  if (event.type === 'response.created') {
    realtimeResponseActive = true;
    return;
  }

  if (event.type === 'response.done') {
    realtimeResponseActive = false;
    flushRealtimeResponseQueue();
    return;
  }

  if (event.type === 'response.output_audio_transcript.done') {
    logGameEvent(`Dealer said: “${event.transcript}”`);
    return;
  }

  if (event.type === 'error') {
    console.error('Realtime API error:', event.error);
    setVoiceStatus(`AI error: ${event.error?.message || 'unknown error'}`);
    return;
  }

  if (event.type !== 'response.function_call_arguments.done') return;

  let result;
  try {
    result = callRealtimeTool(event.name, event.arguments);
  } catch (error) {
    result = { error: error.message };
  }

  const gameState = getRealtimeGameState();

  sendRealtimeEvent({
    type: 'conversation.item.create',
    item: {
      type: 'function_call_output',
      call_id: event.call_id,
      output: JSON.stringify({ result, gameState }),
    },
  });
  updateRealtimeGameState();
}

function stopRealtimeConversation() {
  realtimeDataChannel?.close();
  realtimePeerConnection?.close();
  realtimeAudio?.remove();
  realtimeDataChannel = null;
  realtimePeerConnection = null;
  realtimeAudio = null;
  realtimeSessionConfigured = false;
  window.clearInterval(realtimeStatePollTimer);
  realtimeStatePollTimer = null;
  window.clearTimeout(realtimeInitialNarrationTimer);
  realtimeInitialNarrationTimer = null;
  realtimeStateSyncQueued = false;
  lastRealtimeGameStateFingerprint = null;
  realtimeResponseActive = false;
  realtimeUserResponseQueued = null;
  queuedRealtimeNarration = null;
  lastRealtimeNarration = null;
  setVoiceStatus('');
  setVoiceTranscript('');
}

async function startRealtimeConversation(stream) {
  if (!window.RTCPeerConnection) throw new Error('This browser does not support WebRTC.');

  realtimePeerConnection = new RTCPeerConnection();
  stream.getTracks().forEach((track) => realtimePeerConnection.addTrack(track, stream));
  realtimePeerConnection.addEventListener('track', (event) => {
    if (!realtimeAudio) {
      realtimeAudio = document.createElement('audio');
      realtimeAudio.autoplay = true;
      realtimeAudio.playsInline = true;
      realtimeAudio.hidden = true;
      document.body.append(realtimeAudio);
    }
    realtimeAudio.srcObject = event.streams[0];
    realtimeAudio.play().catch(() => {});
  });

  realtimeDataChannel = realtimePeerConnection.createDataChannel('oai-events');
  realtimeDataChannel.addEventListener('open', () => {
    window.clearTimeout(realtimeInitialNarrationTimer);
    realtimeInitialNarrationTimer = window.setTimeout(() => {
      realtimeInitialNarrationTimer = null;
      queueRealtimeNarration();
    }, 200);
    updateRealtimeGameState({ force: true, narrate: false });
    window.clearInterval(realtimeStatePollTimer);
    // This catches every change to the authoritative game variables, even if
    // a future code path forgets to request an immediate synchronization.
    realtimeStatePollTimer = window.setInterval(updateRealtimeGameState, 100);
    setVoiceStatus('AI is listening');
  });
  realtimeDataChannel.addEventListener('message', (event) => handleRealtimeEvent(JSON.parse(event.data)));
  realtimeDataChannel.addEventListener('close', () => setVoiceStatus('Voice connection ended'));

  const offer = await realtimePeerConnection.createOffer();
  await realtimePeerConnection.setLocalDescription(offer);
  const callResponse = await fetch('/api/realtime-call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sdp: offer.sdp }),
  });
  const answer = await callResponse.text();
  if (!callResponse.ok) throw new Error(answer);
  await realtimePeerConnection.setRemoteDescription({ type: 'answer', sdp: answer });
}

function stopVoicePreview() {
  voicePreviewChannel?.close();
  voicePreviewConnection?.close();
  voicePreviewAudio?.remove();
  voicePreviewChannel = null;
  voicePreviewConnection = null;
  voicePreviewAudio = null;
}

async function previewVoice() {
  stopVoicePreview();
  testVoiceButton.disabled = true;
  voicePreviewStatus.textContent = 'Loading voice…';

  try {
    const settings = selectedVoiceSettings();
    const connection = new RTCPeerConnection();
    voicePreviewConnection = connection;
    connection.addTransceiver('audio', { direction: 'recvonly' });
    connection.addEventListener('track', (event) => {
      if (!voicePreviewAudio) {
        voicePreviewAudio = document.createElement('audio');
        voicePreviewAudio.autoplay = true;
        voicePreviewAudio.playsInline = true;
        voicePreviewAudio.hidden = true;
        document.body.append(voicePreviewAudio);
      }
      voicePreviewAudio.srcObject = event.streams[0];
      voicePreviewAudio.play().catch(() => {});
    });

    const channel = connection.createDataChannel('oai-events');
    voicePreviewChannel = channel;
    channel.addEventListener('open', () => {
      channel.send(JSON.stringify({
        type: 'session.update',
        session: {
          type: 'realtime',
          instructions: `You are previewing a poker dealer voice. ${voiceStyleInstructions(settings)} Say exactly: "Welcome to RoboDeal. Place your bets."`,
          output_modalities: ['audio'],
          audio: { output: { voice: settings.name } },
        },
      }));
      channel.send(JSON.stringify({ type: 'response.create' }));
    });
    channel.addEventListener('message', (event) => {
      const update = JSON.parse(event.data);
      if (update.type === 'error') {
        voicePreviewStatus.textContent = `Voice preview could not start: ${update.error?.message || 'unknown problem'}`;
        testVoiceButton.disabled = false;
      }
      if (update.type === 'output_audio_buffer.stopped') {
        voicePreviewStatus.textContent = '';
        testVoiceButton.disabled = false;
        window.setTimeout(stopVoicePreview, 500);
      }
    });

    const offer = await connection.createOffer();
    await connection.setLocalDescription(offer);
    const callResponse = await fetch('/api/realtime-call', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sdp: offer.sdp }),
    });
    const answer = await callResponse.text();
    if (!callResponse.ok) throw new Error(answer);
    await connection.setRemoteDescription({ type: 'answer', sdp: answer });
  } catch (error) {
    console.error('Voice preview could not start:', error);
    voicePreviewStatus.textContent = 'Voice preview could not start.';
    testVoiceButton.disabled = false;
    stopVoicePreview();
  }
}

function stopRecording() {
  if (microphoneRecorder && microphoneRecorder.state !== 'inactive') {
    microphoneRecorder.stop();
  }

  microphoneStream?.getTracks().forEach((track) => track.stop());
  stopRealtimeConversation();
  microphoneRecorder = null;
  microphoneStream = null;
  window.clearInterval(audioCleanupTimer);
  audioCleanupTimer = null;
  recordingButton.setAttribute('aria-pressed', 'false');
  recordingButton.textContent = 'Start recording';
}

async function startRecording() {
  try {
    const newMicrophoneStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
      },
    });
    const newMicrophoneRecorder = new MediaRecorder(newMicrophoneStream);
    microphoneStream = newMicrophoneStream;
    microphoneRecorder = newMicrophoneRecorder;

    newMicrophoneRecorder.addEventListener('dataavailable', (event) => {
      if (event.data.size === 0) return;

      // MediaRecorder gives us a fresh Blob about once per second.
      recentAudioFiles.push({
        audio: event.data,
        createdAt: Date.now(),
      });
      discardOldAudioFiles();
    });

    newMicrophoneRecorder.addEventListener('stop', () => {
      // Use this recording's stream, not the shared variable. The shared
      // variable may already point at a newer recording session.
      newMicrophoneStream.getTracks().forEach((track) => track.stop());
    }, { once: true });

    newMicrophoneRecorder.start(1_000);
    audioCleanupTimer = window.setInterval(discardOldAudioFiles, 1_000);
    recordingButton.setAttribute('aria-pressed', 'true');
    recordingButton.textContent = 'Stop recording';
    setVoiceStatus('Connecting AI…');
    setVoiceTranscript('');
    startRealtimeConversation(newMicrophoneStream).catch((error) => {
      console.error('Realtime voice connection could not start:', error);
      let reason = 'unknown connection problem';
      try {
        reason = JSON.parse(error.message).error?.message || reason;
      } catch {
        reason = error.message || reason;
      }
      setVoiceStatus(`AI could not connect: ${reason}`);
    });
  } catch (error) {
    microphoneRecorder = null;
    microphoneStream?.getTracks().forEach((track) => track.stop());
    microphoneStream = null;
    window.clearInterval(audioCleanupTimer);
    audioCleanupTimer = null;
    recordingButton.setAttribute('aria-pressed', 'false');
    recordingButton.textContent = 'Start recording';
    speak('Recording could not start. Please allow microphone access.');
  }
}

function speak(message) {
  // When the AI is connected, it is the table's voice. Browser speech remains
  // available as a fallback when voice control is off.
  if (realtimeDataChannel?.readyState === 'open') return;
  if (!('speechSynthesis' in window)) return;

  window.speechSynthesis.cancel();
  window.speechSynthesis.resume();
  const speech = new SpeechSynthesisUtterance(message);
  speech.rate = 1;
  window.speechSynthesis.speak(speech);
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
      hasActedThisRound: false,
      folded: false,
      eliminated: false,
    };
  });
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
      const chips = document.createElement('span');
      chips.className = 'player-seat-chips';
      chips.textContent = player.chips;
      seat.append(chips);
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
  turnIndicator.style.setProperty('--rotation', `${activeAngle - Math.PI / 2}rad`);
  potValue.textContent = pot;
  sidePotValue.textContent = sidePot;
  sidePotValue.hidden = !sidePotActive;
  potDisplay.classList.toggle('side-pot-active', sidePotActive);
  roundLabel.textContent = ['Preflop', 'Flop', 'Turn', 'River'][roundNumber - 1];
  turnIndicator.setAttribute('aria-label', `Your bet: ${pendingBet}. Pot: ${pot}`);
  updateBetControls();
  updateRealtimeGameState();
}

function setCurrentPlayer(number) {
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
  const maximumBet = player.chips;
  // A player may go all-in even when they cannot completely match the bet.
  const minimumAllowedBet = Math.min(minimumBet, maximumBet);

  pendingBet = Math.max(minimumAllowedBet, Math.min(pendingBet, maximumBet));
  betInput.value = pendingBet;
  betInput.min = minimumAllowedBet;
  betInput.max = maximumBet;
  betIncrease.disabled = pendingFold || pendingBet >= maximumBet;
  betDecrease.disabled = pendingFold || pendingBet <= minimumBet;
  betInput.disabled = pendingFold;
  foldButton.classList.toggle('selected', pendingFold);
  confirmButton.textContent = pendingFold ? 'Confirm fold' : 'Confirm bet';
  const undoIsAvailable = canUndoLastTurn();
  undoButton.hidden = !undoIsAvailable;
  actionButtons.classList.toggle('has-undo', undoIsAvailable);
  scheduleRealtimeGameStateSync();
}

function captureTurnState() {
  return {
    currentPlayerNumber,
    pot,
    sidePot,
    sidePotActive,
    sidePotEligiblePlayers: [...sidePotEligiblePlayers],
    highestRoundBet,
    players: Object.fromEntries(Object.values(playersByNumber).map((player) => [player.number, {
      chips: player.chips,
      roundBet: player.roundBet,
      hasActedThisRound: player.hasActedThisRound,
      folded: player.folded,
    }])),
  };
}

function canUndoLastTurn() {
  // An automatic blind counts as a bet, but not as the player's real turn.
  // Undo stays available until the next player confirms an action.
  return lastTurnState !== null && currentPlayerNumber !== lastTurnState.currentPlayerNumber;
}

function undoLastTurn() {
  if (!canUndoLastTurn()) return;

  Object.entries(lastTurnState.players).forEach(([number, playerState]) => {
    Object.assign(playersByNumber[number], playerState);
  });
  currentPlayerNumber = lastTurnState.currentPlayerNumber;
  pot = lastTurnState.pot;
  sidePot = lastTurnState.sidePot;
  sidePotActive = lastTurnState.sidePotActive;
  sidePotEligiblePlayers = [...lastTurnState.sidePotEligiblePlayers];
  highestRoundBet = lastTurnState.highestRoundBet;
  pendingBet = Math.max(0, highestRoundBet - playersByNumber[currentPlayerNumber].roundBet);
  pendingFold = false;
  gameSettings.currentPlayerNumber = currentPlayerNumber;
  gameSettings.pot = pot;
  gameSettings.sidePot = sidePot;
  gameSettings.sidePotEligiblePlayers = sidePotEligiblePlayers;
  lastTurnState = null;
  speak('Last turn undone.');
  drawPlayerSeats();
}

function allActivePlayersHaveMatchedBet() {
  const activePlayers = Object.values(playersByNumber).filter((player) => !player.folded && !player.eliminated && player.chips > 0);

  if (activePlayers.length === 1) return activePlayers[0].hasActedThisRound;

  return activePlayers.length > 1
    && activePlayers.every((player) => player.hasActedThisRound && player.roundBet === highestRoundBet);
}

function startNextRound() {
  lastTurnState = null;
  if (roundNumber >= 4) {
    showWinnerPicker();
    return;
  }

  const nextCard = ['the flop', 'the turn', 'the river'][roundNumber - 1];
  logGameEvent(`Betting round finished. Deal ${nextCard}.`);
  turnIndicator.hidden = true;
  actionButtons.hidden = true;
  dealPromptKind = 'community-cards';
  dealMessage.textContent = `Deal ${nextCard}. Press OK to continue.`;
  dealPrompt.hidden = false;
  speak(`Deal ${nextCard}. Press OK to continue.`);
}

function beginNextRound() {
  dealPromptKind = null;
  dealPrompt.hidden = true;
  turnIndicator.hidden = false;
  actionButtons.hidden = false;
  roundNumber += 1;
  logGameEvent(`${['Preflop', 'Flop', 'Turn', 'River'][roundNumber - 1]} betting round started.`);
  Object.values(playersByNumber).forEach((player) => {
    player.roundBet = 0;
    player.hasActedThisRound = false;
  });
  highestRoundBet = 0;
  const firstPlayer = playersByNumber[antePlayerNumber].folded || playersByNumber[antePlayerNumber].chips === 0
    ? nextActivePlayerFrom(antePlayerNumber)
    : antePlayerNumber;
  if (firstPlayer !== null) setCurrentPlayer(firstPlayer);
}

function showWinnerPicker() {
  const activePlayers = Object.values(playersByNumber).filter((player) => !player.folded && !player.eliminated);
  speak('Showdown. Choose the player with the best cards.');
  logGameEvent('Showdown: choose the player with the best cards.');
  showPotWinnerPicker('Who had the best cards?', activePlayers, awardMainPot);
}

function showPotWinnerPicker(question, players, awardFunction) {
  turnIndicator.hidden = true;
  actionButtons.hidden = true;
  winnerQuestion.textContent = question;
  winnerOptions.replaceChildren();

  players.forEach((player) => {
    const winnerButton = document.createElement('button');
    winnerButton.type = 'button';
    winnerButton.textContent = player.name;
    winnerButton.addEventListener('click', () => awardFunction(player.number));
    winnerOptions.append(winnerButton);
  });

  winnerPicker.hidden = false;
}

function awardMainPot(winnerNumber) {
  const winner = playersByNumber[winnerNumber];
  winner.chips += pot;
  pot = 0;
  gameSettings.pot = pot;

  if (sidePotActive && sidePot > 0) {
    const sidePotPlayers = Object.values(playersByNumber).filter((player) =>
      !player.folded && !player.eliminated && sidePotEligiblePlayers.includes(player.number));
    if (sidePotPlayers.length <= 1) {
      awardSidePot(sidePotPlayers[0]?.number || winnerNumber);
    } else {
      showPotWinnerPicker('Who wins the side pot?', sidePotPlayers, awardSidePot);
    }
    drawPlayerSeats();
    return;
  }

  finishHand(winner);
}

function awardSidePot(winnerNumber) {
  const winner = playersByNumber[winnerNumber];
  winner.chips += sidePot;
  sidePot = 0;
  gameSettings.sidePot = sidePot;
  finishHand(winner);
}

function finishHand(winner) {
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
  winnerQuestion.textContent = `${winner.name} wins the hand!`;
  logGameEvent(`${winner.name} wins hand ${gameHandNumber}.`);
  speak(`${winner.name} wins the hand.`);
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
  logGameEvent(`${winner.name} wins the game.`);
  gameScreen.hidden = true;
  gameWinnerMessage.textContent = `${winner.name} wins!`;
  gameWinnerScreen.hidden = false;
  speak(`Player ${winner.name} wins the game!`);
}

function addToPot(chips) {
  if (sidePotActive) {
    sidePot += chips;
  } else {
    pot += chips;
  }
  gameSettings.pot = pot;
  gameSettings.sidePot = sidePot;
}

function startSidePotIfNeeded() {
  if (sidePotActive) return;

  const allInPlayers = Object.values(playersByNumber).filter((player) => !player.folded && !player.eliminated && player.chips === 0);
  const playersWithChips = Object.values(playersByNumber).filter((player) => !player.folded && !player.eliminated && player.chips > 0);

  if (allInPlayers.length > 0 && playersWithChips.length >= 2) {
    sidePotActive = true;
    sidePotEligiblePlayers = playersWithChips.map((player) => player.number);
    gameSettings.sidePotEligiblePlayers = sidePotEligiblePlayers;
  }
}

function postBlind(playerNumber, requestedAmount, blindName) {
  const player = playersByNumber[playerNumber];
  const amount = Math.min(requestedAmount, player.chips);

  player.chips -= amount;
  player.roundBet += amount;
  player.hasActedThisRound = true;
  highestRoundBet = Math.max(highestRoundBet, player.roundBet);
  addToPot(amount);
  logGameEvent(`${player.name} posts the ${blindName} ${amount}.`);
}

function startHand() {
  gameHandNumber += 1;
  isGameWon = false;
  roundNumber = 1;
  pot = 0;
  sidePot = 0;
  sidePotActive = false;
  sidePotEligiblePlayers = [];
  highestRoundBet = 0;
  pendingBet = 0;
  pendingFold = false;
  lastTurnState = null;
  bigBlindPlayerNumber = null;
  openingTurnAnnouncementPending = false;

  Object.values(playersByNumber).forEach((player) => {
    player.folded = player.eliminated;
    player.roundBet = 0;
    player.hasActedThisRound = false;
    player.isDealer = player.number === gameSettings.dealerNumber;
  });

  antePlayerNumber = playerToDealersLeft(gameSettings.dealerNumber);
  if (gameSettings.playerCount >= 6) {
    bigBlindPlayerNumber = playerToDealersLeft(antePlayerNumber);
  }
  gameSettings.antePlayerNumber = antePlayerNumber;
  gameSettings.bigBlindPlayerNumber = bigBlindPlayerNumber;
  gameSettings.bigBlind = bigBlindPlayerNumber === null ? null : gameSettings.ante * 2;

  postBlind(antePlayerNumber, gameSettings.ante, 'small blind');
  if (bigBlindPlayerNumber !== null) {
    postBlind(bigBlindPlayerNumber, gameSettings.bigBlind, 'big blind');
  }

  startSidePotIfNeeded();

  turnIndicator.hidden = true;
  actionButtons.hidden = true;
  dealPromptKind = 'hole-cards';
  const dealer = playersByNumber[gameSettings.dealerNumber];
  const introduction = gameHandNumber === 1 ? `Game is Texas Hold'em. Ante is ${gameSettings.ante}.` : `New hand. Ante is ${gameSettings.ante}.`;
  dealMessage.textContent = `${introduction} ${dealer.name}, you're the dealer. Deal two cards face down to each player. Press OK when done.`;
  dealPrompt.hidden = false;
  setCurrentPlayer(bigBlindPlayerNumber ?? antePlayerNumber);
  nextPlayer();
  logGameEvent('Waiting for the dealer to deal two cards face down to each player.');
  if (!(gameHandNumber === 1 && gameSettings.startAiAutomatically)) speak(dealMessage.textContent);
}

function startNewHand() {
  const nextDealerNumber = playerToDealersLeft(gameSettings.dealerNumber);
  if (nextDealerNumber === gameSettings.firstDealerNumber) {
    gameSettings.ante += gameSettings.anteIncrease;
    speak(`The ante is now ${gameSettings.ante}.`);
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
    awardMainPot(activePlayers[0].number);
  } else if (allActivePlayersHaveMatchedBet()) {
    lastTurnState = null;
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
    logGameEvent(`${player.name} folds.`);
    speak(`${player.name} folds.`);
  } else {
    const additionalChips = pendingBet;
    player.chips -= additionalChips;
    player.roundBet += additionalChips;
    player.hasActedThisRound = true;
    highestRoundBet = Math.max(highestRoundBet, player.roundBet);
    addToPot(additionalChips);
    startSidePotIfNeeded();
    logGameEvent(additionalChips === 0 ? `${player.name} checks.` : `${player.name} bets ${additionalChips}.`);
    speak(additionalChips === 0 ? `${player.name} checks.` : `${player.name} bets ${additionalChips}.`);
  }

  finishTurn();
}

// These functions choose an action for the current player. They do not change
// the game until confirm() is called, which makes them useful for voice control.
function foldCurrentPlayer() {
  pendingFold = true;
  updateBetControls();

}

function checkCurrentPlayer(announceProblem = true) {
  const player = playersByNumber[currentPlayerNumber];
  const amountNeededToCall = Math.max(0, highestRoundBet - player.roundBet);

  if (amountNeededToCall > 0) {
    if (announceProblem) speak(`You cannot check. You need ${amountNeededToCall} more to call.`);
    return false;
  }

  pendingFold = false;
  pendingBet = 0;
  updateBetControls();
  return true;
}

function callCurrentPlayer() {
  const player = playersByNumber[currentPlayerNumber];
  pendingFold = false;
  // pendingBet means the extra chips to add now, not this round's total bet.
  pendingBet = Math.min(Math.max(0, highestRoundBet - player.roundBet), player.chips);
  updateBetControls();
}

function betCurrentPlayer(amount) {
  const player = playersByNumber[currentPlayerNumber];
  const requestedAmount = Number(amount);

  if (!Number.isFinite(requestedAmount) || requestedAmount < 0) return false;

  pendingFold = false;
  pendingBet = Math.min(requestedAmount, player.chips);
  updateBetControls();
  return true;
}

function goAllIn() {
  const player = playersByNumber[currentPlayerNumber];
  return betCurrentPlayer(player.chips);
}

function confirm() {
  confirmTurn();
  updateRealtimeGameState({ force: true });
}

function cardsAreDealt() {
  if (dealPrompt.hidden) return false;

  if (dealPromptKind === 'hole-cards') {
    dealPromptKind = null;
    dealPrompt.hidden = true;
    turnIndicator.hidden = false;
    actionButtons.hidden = false;
    openingTurnAnnouncementPending = true;
    logGameEvent('Two cards were dealt face down to each player. Preflop betting started.');
    drawPlayerSeats();
    return true;
  }

  beginNextRound();
  return true;
}

playerCount.addEventListener('change', drawPlayerNames);
voiceCustomizationButton.addEventListener('click', () => {
  setupScreen.hidden = true;
  voiceCustomizationScreen.hidden = false;
});
voiceCustomizationBack.addEventListener('click', () => {
  voiceCustomizationScreen.hidden = true;
  setupScreen.hidden = false;
});
testVoiceButton.addEventListener('click', previewVoice);
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && !gameScreen.hidden && !isGameWon) {
    keepScreenAwake();
  }
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
undoButton.addEventListener('click', undoLastTurn);
dealOkButton.addEventListener('click', cardsAreDealt);
recordingButton.addEventListener('click', () => {
  const isRecording = recordingButton.getAttribute('aria-pressed') === 'true';
  if (isRecording) {
    stopRecording();
  } else {
    startRecording();
  }
});
form.addEventListener('submit', (event) => {
  event.preventDefault();
  gameSettings = {
    playerCount: Number(playerCount.value),
    startingMoney: Number(document.querySelector('#starting-money').value),
    ante: Number(document.querySelector('#ante').value),
    anteIncrease: Number(document.querySelector('#ante-increase').value),
    dealerNumber: Number(dealerSelect.value),
    firstDealerNumber: Number(dealerSelect.value),
    playerNames: [...playerNames.querySelectorAll('input')].map((input, index) => input.value || `Player ${index + 1}`),
    startAiAutomatically: startAiAutomaticallyCheckbox.checked,
    voice: selectedVoiceSettings(),
  };
  showVoiceTranscript = showVoiceTranscriptCheckbox.checked;
  gameHistory = [];
  gameHandNumber = 0;
  saveLastGameSettings();
  makePlayers();
  setupScreen.hidden = true;
  voiceCustomizationScreen.hidden = true;
  gameScreen.hidden = false;
  gameWinnerScreen.hidden = true;
  winnerPicker.hidden = true;
  dealPrompt.hidden = true;
  turnIndicator.hidden = false;
  actionButtons.hidden = false;
  keepScreenAwake();
  startHand();
  if (gameSettings.startAiAutomatically) startRecording();


  // Add the game-table interface inside gameScreen in the next step.
});

drawPlayerNames();
restoreLastGameSettings();
