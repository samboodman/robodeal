const playerCount = document.querySelector('#player-count');
const playerNames = document.querySelector('#player-names');
const form = document.querySelector('#setup-form');
const message = document.querySelector('#message');
const dealerSelect = document.querySelector('#dealer');
const setupScreen = document.querySelector('#setup-screen');
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
const showTranscript = document.querySelector('#show-transcript');

// This is where the game screen can read the settings when we add its controls.
let gameSettings = null;
let playersByNumber = {};
let currentPlayerNumber = 1;
let antePlayerNumber = null;
let pot = 0;
let highestRoundBet = 0;
let pendingBet = 0;
let pendingFold = false;
let isGameWon = false;
let roundNumber = 1;
let sidePot = 0;
let sidePotActive = false;
let sidePotEligiblePlayers = [];
let microphoneStream = null;
let speechRecognizer = null;
let pokerCommandClassifier = null;
let audioContext = null;
let microphoneSource = null;
let voiceCaptureProcessor = null;
let silentAudioOutput = null;
let isTranscribing = false;
let queuedAudioSamples = null;
let recordingSessionId = 0;
let lastTurnState = null;
let lastRejectedVoiceCommand = null;
let ignoreVoiceUntil = 0;

function speak(message) {
  if (!('speechSynthesis' in window)) return;

  // Do not let Whisper treat RoboDeal's own spoken reply as a player command.
  // The little extra time at the end covers speakers that finish slightly late.
  ignoreVoiceUntil = Date.now() + Math.max(1400, message.length * 85) + 700;
  window.speechSynthesis.cancel();
  window.speechSynthesis.resume();
  const speech = new SpeechSynthesisUtterance(message);
  speech.rate = 1;
  window.speechSynthesis.speak(speech);
}

function showVoiceStatus(status) {
  voiceStatus.hidden = !gameSettings?.showTranscript;
  if (!gameSettings?.showTranscript) return;
  voiceStatus.textContent = status;
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
    seat.textContent = player.eliminated ? '' : player.chips;
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
  // An automatic ante counts as a bet, but not as the player's real turn.
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
  turnIndicator.hidden = true;
  actionButtons.hidden = true;
  dealMessage.textContent = `Deal ${nextCard}. Press OK to continue.`;
  dealPrompt.hidden = false;
  speak(`Deal ${nextCard}. Press OK to continue.`);
}

function beginNextRound() {
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
  if (firstPlayer !== null) setCurrentPlayer(firstPlayer);
}

function showWinnerPicker() {
  const activePlayers = Object.values(playersByNumber).filter((player) => !player.folded && !player.eliminated);
  speak('Showdown. Choose the player with the best cards.');
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
  gameScreen.hidden = true;
  gameWinnerMessage.textContent = `Player ${winner.name} wins!`;
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

function startHand() {
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

  Object.values(playersByNumber).forEach((player) => {
    player.folded = player.eliminated;
    player.roundBet = 0;
    player.hasActedThisRound = false;
    player.isDealer = player.number === gameSettings.dealerNumber;
  });

  antePlayerNumber = playerToDealersLeft(gameSettings.dealerNumber);
  gameSettings.antePlayerNumber = antePlayerNumber;
  playersByNumber[antePlayerNumber].chips -= gameSettings.ante;
  playersByNumber[antePlayerNumber].roundBet = gameSettings.ante;
  playersByNumber[antePlayerNumber].hasActedThisRound = true;
  highestRoundBet = gameSettings.ante;
  addToPot(gameSettings.ante);

  setCurrentPlayer(antePlayerNumber);
  nextPlayer();
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
    speak(`${player.name} folds.`);
  } else {
    const additionalChips = pendingBet;
    player.chips -= additionalChips;
    player.roundBet += additionalChips;
    player.hasActedThisRound = true;
    highestRoundBet = Math.max(highestRoundBet, player.roundBet);
    addToPot(additionalChips);
    startSidePotIfNeeded();
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
}

function cardsAreDealt() {
  if (dealPrompt.hidden) return false;

  beginNextRound();
  return true;
}

function spokenNumber(text) {
  const digit = text.match(/\b(\d+)\b/);
  if (digit) return Number(digit[1]);

  const numberWords = {
    one: 1, two: 2, three: 3, four: 4, five: 5,
    six: 6, seven: 7, eight: 8, nine: 9, ten: 10,
  };
  const word = Object.keys(numberWords).find((name) => new RegExp(`\\b${name}\\b`).test(text));
  return word ? numberWords[word] : null;
}

function runClassifiedPokerAction(action) {
  if (action === 'fold') {
    foldCurrentPlayer();
    confirm();
  } else if (action === 'call') {
    callCurrentPlayer();
    confirm();
  } else if (action === 'check') {
    if (checkCurrentPlayer()) confirm();
  } else if (action === 'all-in') {
    goAllIn();
    confirm();
  } else if (action === 'cards-dealt') {
    if (!cardsAreDealt()) speak('There are no cards waiting to be dealt.');
  }
}

async function classifyVaguePokerCommand(transcript) {
  showVoiceStatus('Thinking about what that means…');
  try {
    // This small classifier downloads once per device, then works offline.
    pokerCommandClassifier ??= await pipeline(
      'zero-shot-classification',
      'Xenova/mobilebert-uncased-mnli',
    );
    const choices = {
      fold: 'fold from the poker hand',
      call: 'call the current poker bet',
      check: 'check in poker without betting more',
      'all-in': 'put all poker chips in the pot',
      'cards-dealt': 'say the next community cards are dealt',
      unrelated: 'unrelated conversation, not a poker action',
    };
    const result = await pokerCommandClassifier(transcript, Object.values(choices));
    const bestChoice = result.labels[0];
    const action = Object.keys(choices).find((key) => choices[key] === bestChoice);

    if (action && action !== 'unrelated' && result.scores[0] >= 0.55) {
      runClassifiedPokerAction(action);
    } else {
      showVoiceStatus(`Heard: “${transcript}” — no poker action.`);
    }
  } catch (error) {
    console.error('Could not classify poker command:', error);
    showVoiceStatus(`Heard: “${transcript}” — no poker action.`);
  }
}

async function handleSpokenPokerCommand(transcript) {
  const words = transcript
    .toLowerCase()
    .replace(/[^a-z0-9\s']/g, ' ')
    // Whisper sometimes confuses the poker word "raise" with "blaze".
    .replace(/\bblaze\b/g, 'raise');
  showVoiceStatus(`Heard: “${transcript}”`);

  const saysCardsAreDealt = /\b(flop|turn|river)\b.{0,18}\b(deal|dealt)\b|\b(deal|dealt)\b.{0,18}\b(flop|turn|river)\b/.test(words);
  if (saysCardsAreDealt) {
    if (!cardsAreDealt()) speak('There are no cards waiting to be dealt.');
    return;
  }

  // This function only calls the six action functions above. It never changes
  // poker variables directly. A recognized legal action is applied right away;
  // the next player can use Undo if Whisper heard it wrong.
  if (/\bconfirm\s+(the\s+)?(bet|that)\b/.test(words)) {
    lastRejectedVoiceCommand = null;
    confirm();
    return;
  }
  if (/\bconfirm\b/.test(words)) {
    speak('Say confirm bet to use the number already selected.');
    return;
  }
  if (/\b(all in|all-in)\b|\bscrew it\b.{0,18}\b(i'?m in|i am in)\b/.test(words)) {
    lastRejectedVoiceCommand = null;
    runClassifiedPokerAction('all-in');
    return;
  }
  if (/\b(fold|i'?m out|i am out|too rich)\b/.test(words)) {
    lastRejectedVoiceCommand = null;
    runClassifiedPokerAction('fold');
    return;
  }
  if (/\bcheck\b/.test(words)) {
    const shouldAnnounceProblem = lastRejectedVoiceCommand !== 'check';
    if (checkCurrentPlayer(shouldAnnounceProblem)) {
      lastRejectedVoiceCommand = null;
      confirm();
    } else {
      lastRejectedVoiceCommand = 'check';
    }
    return;
  }
  if (/\bcall\b/.test(words)) {
    lastRejectedVoiceCommand = null;
    runClassifiedPokerAction('call');
    return;
  }
  if (/\b(bet|raise)\b/.test(words)) {
    const amount = spokenNumber(words);
    if (amount === null) {
      speak('Say bet, then a number.');
      return;
    }
    const player = playersByNumber[currentPlayerNumber];
    const amountNeededToCall = Math.max(0, highestRoundBet - player.roundBet);
    const isRaise = /\braise\b/.test(words);
    const chipsToAdd = isRaise ? amountNeededToCall + amount : amount;
    if (betCurrentPlayer(chipsToAdd)) {
      lastRejectedVoiceCommand = null;
      confirm();
    }
    return;
  }

  classifyVaguePokerCommand(transcript);
}

async function audioSamplesToWhisperSamples(samples, sampleRate) {
  const offlineContext = new OfflineAudioContext(1, Math.ceil((samples.length / sampleRate) * 16000), 16000);
  const audioBuffer = offlineContext.createBuffer(1, samples.length, sampleRate);
  audioBuffer.copyToChannel(samples, 0);
  const source = offlineContext.createBufferSource();
  source.buffer = audioBuffer;
  source.connect(offlineContext.destination);
  source.start();
  const resampledBuffer = await offlineContext.startRendering();
  return resampledBuffer.getChannelData(0);
}

async function transcribeAudioSamples(samples, sampleRate) {
  if (Date.now() < ignoreVoiceUntil) return;

  if (isTranscribing) {
    queuedAudioSamples = { samples, sampleRate };
    return;
  }

  isTranscribing = true;
  try {
    const audio = await audioSamplesToWhisperSamples(samples, sampleRate);
    const result = await speechRecognizer(audio);
    const transcript = result.text.trim();
    if (transcript) handleSpokenPokerCommand(transcript);
    else showVoiceStatus('No words heard. Try speaking closer to the phone.');
  } catch (error) {
    console.error('Could not transcribe recording:', error);
    showVoiceStatus('Voice could not understand that clip. Try again.');
  } finally {
    isTranscribing = false;
    if (queuedAudioSamples) {
      const nextAudio = queuedAudioSamples;
      queuedAudioSamples = null;
      transcribeAudioSamples(nextAudio.samples, nextAudio.sampleRate);
    }
  }
}

function stopVoiceRecording() {
  recordingSessionId += 1;
  microphoneSource?.disconnect();
  voiceCaptureProcessor?.disconnect();
  silentAudioOutput?.disconnect();
  microphoneSource = null;
  voiceCaptureProcessor = null;
  silentAudioOutput = null;
  microphoneStream?.getTracks().forEach((track) => track.stop());
  microphoneStream = null;
  audioContext?.close();
  audioContext = null;
  queuedAudioSamples = null;
  recordingButton.disabled = false;
  recordingButton.textContent = 'Start recording';
  recordingButton.setAttribute('aria-pressed', 'false');
  showVoiceStatus('Voice control stopped.');
}

function startContinuousVoiceCapture(sessionId) {
  if (sessionId !== recordingSessionId || !microphoneStream) return;

  let speechSamples = [];
  let speechStartedAt = 0;
  let lastSpeechAt = 0;
  microphoneSource = audioContext.createMediaStreamSource(microphoneStream);
  voiceCaptureProcessor = audioContext.createScriptProcessor(2048, 1, 1);
  silentAudioOutput = audioContext.createGain();
  silentAudioOutput.gain.value = 0;

  voiceCaptureProcessor.addEventListener('audioprocess', (event) => {
    if (sessionId !== recordingSessionId) return;
    const now = Date.now();
    if (now < ignoreVoiceUntil) {
      speechSamples = [];
      return;
    }

    const samples = event.inputBuffer.getChannelData(0);
    const loudness = Math.sqrt(samples.reduce((total, sample) => total + sample * sample, 0) / samples.length);
    if (loudness > 0.008) {
      if (speechSamples.length === 0) speechStartedAt = now;
      speechSamples.push(new Float32Array(samples));
      lastSpeechAt = now;
    }

    const hasPause = speechSamples.length > 0 && now - lastSpeechAt > 700;
    const isTooLong = speechSamples.length > 0 && now - speechStartedAt > 8000;
    if (hasPause || isTooLong) {
      const sampleCount = speechSamples.reduce((total, chunk) => total + chunk.length, 0);
      const utterance = new Float32Array(sampleCount);
      let position = 0;
      speechSamples.forEach((chunk) => {
        utterance.set(chunk, position);
        position += chunk.length;
      });
      speechSamples = [];
      transcribeAudioSamples(utterance, audioContext.sampleRate);
    }
  });
  microphoneSource.connect(voiceCaptureProcessor);
  voiceCaptureProcessor.connect(silentAudioOutput);
  silentAudioOutput.connect(audioContext.destination);
}

async function startVoiceRecording() {
  const sessionId = recordingSessionId + 1;
  recordingSessionId = sessionId;
  recordingButton.disabled = true;
  recordingButton.textContent = 'Loading voice…';
  showVoiceStatus('Loading Whisper…');

  try {
    microphoneStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        echoCancellation: true,
        noiseSuppression: true,
        autoGainControl: true,
        channelCount: 1,
      },
    });
    const microphoneSettings = microphoneStream.getAudioTracks()[0].getSettings();
    console.info('Microphone settings:', microphoneSettings);
    audioContext = new AudioContext();
    // The full-precision files avoid a browser-runtime problem in the
    // compressed version of this Whisper model.
    speechRecognizer ??= await pipeline('automatic-speech-recognition', 'Xenova/whisper-base.en', {
      dtype: 'fp32',
    });
    if (sessionId !== recordingSessionId) return;

    startContinuousVoiceCapture(sessionId);
    recordingButton.disabled = false;
    recordingButton.textContent = 'Stop recording';
    recordingButton.setAttribute('aria-pressed', 'true');
    showVoiceStatus(`Listening${microphoneSettings.echoCancellation ? ' with echo cancellation' : ''}…`);
    speak('Voice control is listening.');
  } catch (error) {
    console.error('Could not start voice recording:', error);
    stopVoiceRecording();
    showVoiceStatus('Voice model could not start.');
    speak('Voice control could not start because the speech model did not load.');
  }
}

playerCount.addEventListener('change', drawPlayerNames);
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
dealOkButton.addEventListener('click', beginNextRound);
testVoiceButton.addEventListener('click', () => {
  speak('Voice is ready. Let the poker game begin.');
});
recordingButton.addEventListener('click', () => {
  if (microphoneStream) stopVoiceRecording();
  else startVoiceRecording();
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
    showTranscript: showTranscript.checked,
    playerNames: [...playerNames.querySelectorAll('input')].map((input, index) => input.value || `Player ${index + 1}`),
  };
  makePlayers();
  setupScreen.hidden = true;
  gameScreen.hidden = false;
  gameWinnerScreen.hidden = true;
  voiceStatus.hidden = !gameSettings.showTranscript;
  winnerPicker.hidden = true;
  dealPrompt.hidden = true;
  turnIndicator.hidden = false;
  actionButtons.hidden = false;
  startHand();


  // Add the game-table interface inside gameScreen in the next step.
});

drawPlayerNames();
import { pipeline } from '@huggingface/transformers';
