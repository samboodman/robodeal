const playerCount = document.querySelector('#player-count');
const playerNames = document.querySelector('#player-names');
const form = document.querySelector('#setup-form');
const message = document.querySelector('#message');
const setupScreen = document.querySelector('#setup-screen');
const gameScreen = document.querySelector('#game-screen');

// This is where the game screen can read the settings when we add its controls.
let gameSettings = null;

function drawPlayerNames() {
  const existingNames = [...playerNames.querySelectorAll('input')].map((input) => input.value);
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
    row.append(seat, input);
    playerNames.append(row);
  }
}

playerCount.addEventListener('change', drawPlayerNames);
form.addEventListener('submit', (event) => {
  event.preventDefault();
  gameSettings = {
    playerCount: Number(playerCount.value),
    startingMoney: Number(document.querySelector('#starting-money').value),
    ante: Number(document.querySelector('#ante').value),
    playerNames: [...playerNames.querySelectorAll('input')].map((input, index) => input.value || `Player ${index + 1}`),
  };

  setupScreen.hidden = true;
  gameScreen.hidden = false;

  // Add the game-table interface here in the next step.
});

drawPlayerNames();
