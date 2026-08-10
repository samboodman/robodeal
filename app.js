const playerCount = document.querySelector('#player-count');
const playerNames = document.querySelector('#player-names');
const form = document.querySelector('#setup-form');
const message = document.querySelector('#message');
const dealerSelect = document.querySelector('#dealer');
const setupScreen = document.querySelector('#setup-screen');
const gameScreen = document.querySelector('#game-screen');
const playerSeats = document.querySelector('#player-seats');
const turnIndicator = document.querySelector('#turn-indicator');

// This is where the game screen can read the settings when we add its controls.
let gameSettings = null;
let playersByNumber = {};
let currentPlayerNumber = 1;

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
    };
  });
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
    seat.style.setProperty('--x', `${50 + Math.cos(angle) * 43}%`);
    seat.style.setProperty('--y', `${50 + Math.sin(angle) * 43}%`);
    seat.style.setProperty('--rotation', `${angle - Math.PI / 2}rad`);
    seat.textContent = player.chips;
    seat.setAttribute('aria-label', `${player.name}: ${player.chips} chips${player.isDealer ? ', dealer' : ''}${isCurrentPlayer ? ', current turn' : ''}`);
    seat.setAttribute('role', 'button');
    seat.tabIndex = 0;
    seat.addEventListener('click', () => setCurrentPlayer(player.number));
    seat.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' || event.key === ' ') {
        event.preventDefault();
        setCurrentPlayer(player.number);
      }
    });
    playerSeats.append(seat);
  });

  const activeIndex = players.findIndex((player) => player.number === currentPlayerNumber);
  const activeAngle = (activeIndex / players.length) * Math.PI * 2 - Math.PI / 2;
  turnIndicator.textContent = currentPlayerNumber;
  turnIndicator.style.setProperty('--rotation', `${activeAngle - Math.PI / 2}rad`);
  turnIndicator.setAttribute('aria-label', `Player ${currentPlayerNumber}'s turn`);
}

function setCurrentPlayer(number) {
  currentPlayerNumber = number;
  gameSettings.currentPlayerNumber = number;
  drawPlayerSeats();
}

playerCount.addEventListener('change', drawPlayerNames);
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
  setCurrentPlayer(1);

  setupScreen.hidden = true;
  gameScreen.hidden = false;

  // Add the game-table interface inside gameScreen in the next step.
});

drawPlayerNames();
