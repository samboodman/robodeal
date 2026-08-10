const playerCount = document.querySelector('#player-count');
const playerNames = document.querySelector('#player-names');
const form = document.querySelector('#setup-form');
const message = document.querySelector('#message');

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
  const count = playerCount.value;
  const chips = document.querySelector('#starting-money').value;
  const ante = document.querySelector('#ante').value;
  message.textContent = `Ready for ${count} players: ${chips} chips each, with a ${ante}-chip ante.`;
});

drawPlayerNames();
