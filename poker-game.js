// Pure poker rules. This module has no DOM, audio, or network dependencies so
// every transition can be exercised directly in tests.

const bettingRounds = ['preflop', 'flop', 'turn', 'river'];

function copyState(state) {
  return structuredClone(state);
}

function activePlayers(state) {
  return state.players.filter((player) => !player.folded && !player.eliminated);
}

function playersWhoCanAct(state) {
  return activePlayers(state).filter((player) => player.chips > 0);
}

function playerByNumber(state, playerNumber) {
  return state.players.find((player) => player.number === playerNumber);
}

function nextPlayerFrom(state, playerNumber) {
  const startIndex = state.players.findIndex((player) => player.number === playerNumber);

  for (let step = 1; step <= state.players.length; step += 1) {
    const player = state.players[(startIndex + step) % state.players.length];
    if (!player.folded && !player.eliminated && player.chips > 0) return player.number;
  }

  return null;
}

function playerToDealersLeft(state, dealerNumber) {
  const dealerIndex = state.players.findIndex((player) => player.number === dealerNumber);

  for (let step = 1; step <= state.players.length; step += 1) {
    const player = state.players[(dealerIndex + step) % state.players.length];
    if (!player.eliminated) return player.number;
  }

  return dealerNumber;
}

function postBlind(state, playerNumber, requestedAmount) {
  const player = playerByNumber(state, playerNumber);
  const amount = Math.min(requestedAmount, player.chips);
  player.chips -= amount;
  player.roundBet += amount;
  // Posting a blind starts a wager but is not a voluntary turn.
  player.hasActedThisRound = false;
  state.highestRoundBet = Math.max(state.highestRoundBet, player.roundBet);
  state.pot += amount;
}

function finishAction(state) {
  const remainingPlayers = activePlayers(state);
  if (remainingPlayers.length === 1) {
    state.phase = 'hand-winner';
    state.currentPlayerNumber = null;
    state.winnerCandidateNumber = remainingPlayers[0].number;
    return state;
  }

  if (isBettingRoundComplete(state)) {
    state.currentPlayerNumber = null;
    state.phase = state.round === 'river' ? 'showdown' : 'awaiting-community-cards';
    return state;
  }

  state.currentPlayerNumber = nextPlayerFrom(state, state.currentPlayerNumber);
  return state;
}

function assertCurrentTurn(state, playerNumber) {
  if (state.phase !== 'betting') throw new Error(`Cannot act while phase is ${state.phase}.`);
  if (playerNumber !== state.currentPlayerNumber) throw new Error('It is not that player’s turn.');
}

export function createGame({ players, dealerNumber, ante, useBigBlinds = false }) {
  if (!Array.isArray(players) || players.length < 2) throw new Error('At least two players are required.');
  if (!Number.isFinite(ante) || ante < 0) throw new Error('Ante must be a non-negative number.');
  if (!players.some((player) => player.number === dealerNumber)) throw new Error('Dealer must be a player.');

  return {
    players: players.map((player) => ({
      number: player.number,
      name: player.name || `Player ${player.number}`,
      chips: player.chips,
      folded: Boolean(player.folded),
      eliminated: Boolean(player.eliminated),
      roundBet: 0,
      hasActedThisRound: false,
    })),
    dealerNumber,
    ante,
    useBigBlinds,
    antePlayerNumber: null,
    bigBlindPlayerNumber: null,
    currentPlayerNumber: null,
    highestRoundBet: 0,
    pot: 0,
    round: 'preflop',
    phase: 'ready',
    winnerCandidateNumber: null,
  };
}

export function startHand(game) {
  const state = copyState(game);
  state.phase = 'awaiting-hole-cards';
  state.round = 'preflop';
  state.currentPlayerNumber = null;
  state.highestRoundBet = 0;
  state.pot = 0;
  state.winnerCandidateNumber = null;
  state.players.forEach((player) => {
    player.folded = player.eliminated;
    player.roundBet = 0;
    player.hasActedThisRound = false;
  });

  state.antePlayerNumber = playerToDealersLeft(state, state.dealerNumber);
  state.bigBlindPlayerNumber = state.useBigBlinds
    ? playerToDealersLeft(state, state.antePlayerNumber)
    : null;
  postBlind(state, state.antePlayerNumber, state.ante);
  if (state.bigBlindPlayerNumber !== null) postBlind(state, state.bigBlindPlayerNumber, state.ante * 2);
  return state;
}

export function getAvailableActions(state) {
  if (state.phase === 'awaiting-hole-cards' || state.phase === 'awaiting-community-cards') return [{ type: 'cards-dealt' }];
  if (state.phase !== 'betting') return [];

  const player = playerByNumber(state, state.currentPlayerNumber);
  if (!player || player.chips <= 0 || player.folded || player.eliminated) return [];

  const amountToCall = Math.max(0, state.highestRoundBet - player.roundBet);
  const actions = [{ type: 'fold' }, { type: 'all-in', amount: player.chips }];
  if (amountToCall === 0) actions.push({ type: 'check' });
  if (amountToCall > 0) actions.push({ type: 'call', amount: Math.min(amountToCall, player.chips) });
  if (player.chips > amountToCall) actions.push({ type: 'bet', min: Math.max(1, amountToCall), max: player.chips });
  return actions;
}

export function isBettingRoundComplete(state) {
  const playersStillAbleToAct = playersWhoCanAct(state);
  return playersStillAbleToAct.length === 0
    || playersStillAbleToAct.every((player) => player.hasActedThisRound && player.roundBet === state.highestRoundBet);
}

export function applyAction(game, action) {
  const state = copyState(game);
  if (!action || typeof action.type !== 'string') throw new Error('An action type is required.');

  if (action.type === 'cards-dealt') {
    if (state.phase === 'awaiting-hole-cards') {
      state.phase = 'betting';
      state.currentPlayerNumber = nextPlayerFrom(state, state.bigBlindPlayerNumber ?? state.antePlayerNumber);
      return state;
    }
    if (state.phase === 'awaiting-community-cards') {
      state.round = bettingRounds[bettingRounds.indexOf(state.round) + 1];
      state.phase = 'betting';
      state.highestRoundBet = 0;
      state.players.forEach((player) => {
        player.roundBet = 0;
        player.hasActedThisRound = false;
      });
      const firstPlayer = playerByNumber(state, state.antePlayerNumber);
      state.currentPlayerNumber = firstPlayer.folded || firstPlayer.eliminated || firstPlayer.chips === 0
        ? nextPlayerFrom(state, state.antePlayerNumber)
        : state.antePlayerNumber;
      return state;
    }
    throw new Error('Cards are not expected right now.');
  }

  assertCurrentTurn(state, action.playerNumber);
  const player = playerByNumber(state, action.playerNumber);
  const amountToCall = Math.max(0, state.highestRoundBet - player.roundBet);

  if (action.type === 'fold') {
    player.folded = true;
    return finishAction(state);
  }

  let amount;
  if (action.type === 'check') {
    if (amountToCall !== 0) throw new Error('Cannot check when there is a bet to call.');
    amount = 0;
  } else if (action.type === 'call') {
    if (amountToCall === 0) throw new Error('Nothing to call.');
    amount = Math.min(amountToCall, player.chips);
  } else if (action.type === 'all-in') {
    amount = player.chips;
  } else if (action.type === 'bet') {
    amount = Number(action.amount);
    if (!Number.isInteger(amount) || amount < Math.max(1, amountToCall) || amount > player.chips) {
      throw new Error('Bet amount is outside the legal range.');
    }
  } else {
    throw new Error(`Unknown action: ${action.type}.`);
  }

  player.chips -= amount;
  player.roundBet += amount;
  player.hasActedThisRound = true;
  state.highestRoundBet = Math.max(state.highestRoundBet, player.roundBet);
  state.pot += amount;
  return finishAction(state);
}
