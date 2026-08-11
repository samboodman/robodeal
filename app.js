const playerCount = document.querySelector('#player-count');
const playerNames = document.querySelector('#player-names');
const form = document.querySelector('#setup-form');
const message = document.querySelector('#message');
const dealerSelect = document.querySelector('#dealer');
const setupScreen = document.querySelector('#setup-screen');
const gameScreen = document.querySelector('#game-screen');
const playerSeats = document.querySelector('#player-seats');
const turnIndicator = document.querySelector('#turn-indicator');
const betInput = document.querySelector('#current-bet');
const betIncrease = document.querySelector('#bet-increase');
const betDecrease = document.querySelector('#bet-decrease');
const foldButton = document.querySelector('#fold-button');
const confirmButton = document.querySelector('#confirm-button');
const potValue = document.querySelector('#pot-value');
const actionButtons = document.querySelector('.action-buttons');
const winnerPicker = document.querySelector('#winner-picker');
const winnerQuestion = document.querySelector('#winner-question');
const winnerOptions = document.querySelector('#winner-options');

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
    };
  });
}

function playerToDealersLeft(dealerNumber) {
  const playerNumbers = Object.keys(playersByNumber).map(Number);
  const dealerIndex = playerNumbers.indexOf(dealerNumber);
  return playerNumbers[(dealerIndex + 1) % playerNumbers.length];
}

function drawPlayerSeats() {
  playerSeats.replaceChildren();
  const players = Object.values(playersByNumber);

  players.forEach((player, index) => {
    const angle = (index / players.length) * Math.PI * 2 - Math.PI / 2;
    const seat = document.createElement('div');
    seat.className = 'player-seat';
    const isCurrentPlayer = player.number === currentPlayerNumber;
    if (isCurrentPlayer) seat.classList.add('current-player');
    if (player.isDealer) seat.classList.add('dealer');
    if (player.folded) seat.classList.add('folded');
    seat.style.setProperty('--x', `${50 + Math.cos(angle) * 43}%`);
    seat.style.setProperty('--y', `${50 + Math.sin(angle) * 43}%`);
    seat.style.setProperty('--rotation', `${angle - Math.PI / 2}rad`);
    seat.textContent = player.chips;
    seat.setAttribute('aria-label', `${player.name}: ${player.chips} chips${player.isDealer ? ', dealer' : ''}${isCurrentPlayer ? ', current turn' : ''}${player.folded ? ', folded' : ''}`);
    seat.setAttribute('role', 'button');
    seat.tabIndex = 0;
    if (!player.folded) {
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
  const activeAngle = (activeIndex / players.length) * Math.PI * 2 - Math.PI / 2;
  turnIndicator.style.setProperty('--rotation', `${activeAngle - Math.PI / 2}rad`);
  actionButtons.style.setProperty('--rotation', `${activeAngle - Math.PI / 2}rad`);
  potValue.textContent = pot;
  turnIndicator.setAttribute('aria-label', `Your bet: ${pendingBet}. Pot: ${pot}`);
  updateBetControls();
}

function setCurrentPlayer(number) {
  currentPlayerNumber = number;
  gameSettings.currentPlayerNumber = number;
  pendingBet = Math.max(highestRoundBet, playersByNumber[number].roundBet);
  pendingFold = false;
  drawPlayerSeats();
}

function nextActivePlayerFrom(number) {
  const playerNumbers = Object.keys(playersByNumber).map(Number);
  const startIndex = playerNumbers.indexOf(number);

  for (let step = 1; step <= playerNumbers.length; step += 1) {
    const nextNumber = playerNumbers[(startIndex + step) % playerNumbers.length];
    if (!playersByNumber[nextNumber].folded) return nextNumber;
  }

  return null;
}

function nextPlayer() {
  const nextNumber = nextActivePlayerFrom(currentPlayerNumber);
  if (nextNumber !== null) setCurrentPlayer(nextNumber);
}

function updateBetControls() {
  const player = playersByNumber[currentPlayerNumber];
  const minimumBet = highestRoundBet;
  const maximumBet = player.chips + player.roundBet;

  pendingBet = Math.max(minimumBet, Math.min(pendingBet, maximumBet));
  betInput.value = pendingBet;
  betInput.min = minimumBet;
  betInput.max = maximumBet;
  betIncrease.disabled = pendingFold || pendingBet >= maximumBet;
  betDecrease.disabled = pendingFold || pendingBet <= minimumBet;
  betInput.disabled = pendingFold;
  foldButton.classList.toggle('selected', pendingFold);
  confirmButton.textContent = pendingFold ? 'Confirm fold' : 'Confirm bet';
}

function allActivePlayersHaveMatchedBet() {
  const activePlayers = Object.values(playersByNumber).filter((player) => !player.folded);
  return activePlayers.length > 1
    && activePlayers.every((player) => player.hasActedThisRound && player.roundBet === highestRoundBet);
}

function startNextRound() {
  if (roundNumber >= 4) {
    showWinnerPicker();
    return;
  }

  roundNumber += 1;
  Object.values(playersByNumber).forEach((player) => {
    player.roundBet = 0;
    player.hasActedThisRound = false;
  });
  highestRoundBet = 0;
  const firstPlayer = playersByNumber[antePlayerNumber].folded
    ? nextActivePlayerFrom(antePlayerNumber)
    : antePlayerNumber;
  if (firstPlayer !== null) setCurrentPlayer(firstPlayer);
}

function showWinnerPicker() {
  const activePlayers = Object.values(playersByNumber).filter((player) => !player.folded);
  turnIndicator.hidden = true;
  actionButtons.hidden = true;
  winnerQuestion.textContent = 'Who had the best cards?';
  winnerOptions.replaceChildren();

  activePlayers.forEach((player) => {
    const winnerButton = document.createElement('button');
    winnerButton.type = 'button';
    winnerButton.textContent = player.name;
    winnerButton.addEventListener('click', () => awardPot(player.number));
    winnerOptions.append(winnerButton);
  });

  winnerPicker.hidden = false;
}

function awardPot(winnerNumber) {
  const winner = playersByNumber[winnerNumber];
  winner.chips += pot;
  pot = 0;
  gameSettings.pot = pot;
  isGameWon = true;
  turnIndicator.hidden = true;
  actionButtons.hidden = true;
  winnerPicker.hidden = false;
  winnerQuestion.textContent = `${winner.name} wins the hand!`;
  winnerOptions.replaceChildren();
  const closeButton = document.createElement('button');
  closeButton.type = 'button';
  closeButton.textContent = 'Close';
  closeButton.addEventListener('click', () => {
    winnerPicker.hidden = true;
  });
  winnerOptions.append(closeButton);
  drawPlayerSeats();
}

function finishTurn() {
  const activePlayers = Object.values(playersByNumber).filter((player) => !player.folded);

  if (activePlayers.length === 1) {
    awardPot(activePlayers[0].number);
  } else if (allActivePlayersHaveMatchedBet()) {
    startNextRound();
  } else {
    nextPlayer();
  }
}

function confirmTurn() {
  const player = playersByNumber[currentPlayerNumber];

  if (pendingFold) {
    player.folded = true;
  } else {
    const additionalChips = pendingBet - player.roundBet;
    player.chips -= additionalChips;
    player.roundBet = pendingBet;
    player.hasActedThisRound = true;
    highestRoundBet = Math.max(highestRoundBet, pendingBet);
    pot += additionalChips;
    gameSettings.pot = pot;
  }

  finishTurn();
}

playerCount.addEventListener('change', drawPlayerNames);
betIncrease.addEventListener('click', () => {
  pendingFold = false;
  pendingBet += 1;
  updateBetControls();
});
betDecrease.addEventListener('click', () => {
  pendingFold = false;
  pendingBet -= 1;
  updateBetControls();
});
betInput.addEventListener('change', () => {
  pendingFold = false;
  pendingBet = Number(betInput.value) || 0;
  updateBetControls();
});
foldButton.addEventListener('click', () => {
  pendingFold = !pendingFold;
  updateBetControls();
});
confirmButton.addEventListener('click', confirmTurn);
form.addEventListener('submit', (event) => {
  event.preventDefault();
  gameSettings = {
    playerCount: Number(playerCount.value),
    startingMoney: Number(document.querySelector('#starting-money').value),
    ante: Number(document.querySelector('#ante').value),
    dealerNumber: Number(dealerSelect.value),
    playerNames: [...playerNames.querySelectorAll('input')].map((input, index) => input.value || `Player ${index + 1}`),
  };
  makePlayers();
  antePlayerNumber = playerToDealersLeft(gameSettings.dealerNumber);
  gameSettings.antePlayerNumber = antePlayerNumber;
  highestRoundBet = 0;
  pendingBet = 0;
  pendingFold = false;
  pot = 0;
  roundNumber = 1;
  isGameWon = false;
  gameSettings.pot = pot;
  setCurrentPlayer(antePlayerNumber);

  setupScreen.hidden = true;
  gameScreen.hidden = false;
  winnerPicker.hidden = true;
  turnIndicator.hidden = false;
  actionButtons.hidden = false;
  playersByNumber[antePlayerNumber].chips -= gameSettings.ante;
  playersByNumber[antePlayerNumber].roundBet = gameSettings.ante;
  playersByNumber[antePlayerNumber].hasActedThisRound = true;
  highestRoundBet = gameSettings.ante;
  pot += gameSettings.ante;
  gameSettings.pot = pot;
  nextPlayer();


  // Add the game-table interface inside gameScreen in the next step.
});

drawPlayerNames();
