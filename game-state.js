import { calculatePots, hasBettingRoundFinished, maximumAdditionalBet, splitPotAmount } from './pot-logic.js';

export const GamePhase = Object.freeze({
  SETUP: 'SETUP',
  DEAL_HOLE_CARDS: 'DEAL_HOLE_CARDS',
  BETTING_PREFLOP: 'BETTING_PREFLOP',
  DEAL_FLOP: 'DEAL_FLOP',
  BETTING_FLOP: 'BETTING_FLOP',
  DEAL_TURN: 'DEAL_TURN',
  BETTING_TURN: 'BETTING_TURN',
  DEAL_RIVER: 'DEAL_RIVER',
  BETTING_RIVER: 'BETTING_RIVER',
  ALL_IN_RUNOUT: 'ALL_IN_RUNOUT',
  SHOWDOWN: 'SHOWDOWN',
  HAND_COMPLETE: 'HAND_COMPLETE',
  GAME_COMPLETE: 'GAME_COMPLETE',
});

export const Transition = Object.freeze({
  START_HAND: 'START_HAND',
  CARDS_DEALT: 'CARDS_DEALT',
  FOLD: 'FOLD',
  CHECK: 'CHECK',
  CALL: 'CALL',
  BET: 'BET',
  ALL_IN: 'ALL_IN',
  AWARD_POT: 'AWARD_POT',
  SPLIT_POT: 'SPLIT_POT',
  START_NEXT_HAND: 'START_NEXT_HAND',
});

export const BettingLimit = Object.freeze({
  NO_LIMIT: 'no-limit',
  POT_LIMIT: 'pot-limit',
  FIXED_LIMIT: 'fixed-limit',
});

const bettingPhases = [
  GamePhase.BETTING_PREFLOP,
  GamePhase.BETTING_FLOP,
  GamePhase.BETTING_TURN,
  GamePhase.BETTING_RIVER,
];

const dealPhaseFor = Object.freeze({
  [GamePhase.BETTING_PREFLOP]: GamePhase.DEAL_FLOP,
  [GamePhase.BETTING_FLOP]: GamePhase.DEAL_TURN,
  [GamePhase.BETTING_TURN]: GamePhase.DEAL_RIVER,
  [GamePhase.BETTING_RIVER]: GamePhase.SHOWDOWN,
});

const bettingPhaseFor = Object.freeze({
  [GamePhase.DEAL_HOLE_CARDS]: GamePhase.BETTING_PREFLOP,
  [GamePhase.DEAL_FLOP]: GamePhase.BETTING_FLOP,
  [GamePhase.DEAL_TURN]: GamePhase.BETTING_TURN,
  [GamePhase.DEAL_RIVER]: GamePhase.BETTING_RIVER,
});

function clone(state) {
  return structuredClone(state);
}

function playerById(state, playerId) {
  return state.players.find((player) => player.id === playerId);
}

function nonFoldedPlayers(state) {
  return state.players.filter((player) => !player.folded && !player.eliminated);
}

function playersWhoCanAct(state) {
  return nonFoldedPlayers(state).filter((player) => player.chips > 0);
}

function nextPlayerFrom(state, playerId) {
  const index = state.players.findIndex((player) => player.id === playerId);
  if (index < 0) return null;

  for (let step = 1; step <= state.players.length; step += 1) {
    const player = state.players[(index + step) % state.players.length];
    if (!player.folded && !player.eliminated && player.chips > 0) return player.id;
  }
  return null;
}

function playerToDealersLeft(state, dealerId) {
  const index = state.players.findIndex((player) => player.id === dealerId);
  if (index < 0) throw new Error('The dealer must be seated at the table.');

  for (let step = 1; step <= state.players.length; step += 1) {
    const player = state.players[(index + step) % state.players.length];
    if (!player.eliminated) return player.id;
  }
  return dealerId;
}

function currentPlayer(state) {
  return playerById(state, state.actionPlayerId);
}

function amountToCall(state, player) {
  return Math.min(Math.max(0, state.highestRoundBet - player.roundBet), player.chips);
}

function minimumFullBetForRound(state) {
  if (state.bettingLimit === BettingLimit.FIXED_LIMIT) {
    return state.fixedLimitBet * (state.round <= 2 ? 1 : 2);
  }
  return Math.max(1, state.smallBlind * (state.useBigBlind ? 2 : 1));
}

function refreshPots(state) {
  state.pots = calculatePots(state.players.map((player) => ({
    number: player.id,
    chips: player.chips,
    handContribution: player.handContribution,
    folded: player.folded,
    eliminated: player.eliminated,
  })));
}

function postBlind(state, playerId, requestedAmount, countsAsInitialAction = true) {
  const player = playerById(state, playerId);
  const amount = Math.min(requestedAmount, player.chips);
  player.chips -= amount;
  player.roundBet += amount;
  player.handContribution += amount;
  // In this game, posting the small blind counts as an initial matched action. A
  // later raise still requires a response because roundBet will no longer
  // equal highestRoundBet. A configured big blind retains its usual option.
  player.hasActedThisRound = countsAsInitialAction;
  state.highestRoundBet = Math.max(state.highestRoundBet, player.roundBet);
}

function phaseAfterBetting(state) {
  const nextPhase = dealPhaseFor[state.phase];
  if (nextPhase === GamePhase.SHOWDOWN) return GamePhase.SHOWDOWN;
  return playersWhoCanAct(state).length <= 1 ? GamePhase.ALL_IN_RUNOUT : nextPhase;
}

function finishHand(state, winnerIds) {
  state.handWinnerIds = [...new Set(winnerIds)];
  state.players.forEach((player) => {
    player.eliminated = player.chips === 0;
  });
  state.actionPlayerId = null;
  state.phase = state.players.filter((player) => player.chips > 0).length === 1
    ? GamePhase.GAME_COMPLETE
    : GamePhase.HAND_COMPLETE;
}

function awardAllPots(state, winnerId) {
  const winner = playerById(state, winnerId);
  winner.chips += state.pots.reduce((total, pot) => total + pot.amount, 0);
  state.pots.forEach((pot) => { pot.amount = 0; });
  finishHand(state, [winnerId]);
}

function resolveBetting(state) {
  const remainingPlayers = nonFoldedPlayers(state);
  if (remainingPlayers.length === 1) {
    awardAllPots(state, remainingPlayers[0].id);
    return;
  }

  if (hasBettingRoundFinished(state.players, state.highestRoundBet)) {
    state.actionPlayerId = null;
    state.phase = phaseAfterBetting(state);
    return;
  }

  state.actionPlayerId = nextPlayerFrom(state, state.actionPlayerId);
}

function assertBettingTurn(state, action) {
  if (!bettingPhases.includes(state.phase)) throw new Error(`No betting action is allowed during ${state.phase}.`);
  if (action.playerId !== state.actionPlayerId) throw new Error('It is not that player’s turn.');
  const player = currentPlayer(state);
  if (!player || player.folded || player.eliminated || player.chips <= 0) throw new Error('That player cannot act.');
  return player;
}

function prepareNextBettingRound(state) {
  state.highestRoundBet = 0;
  state.lastFullRaiseSize = minimumFullBetForRound(state);
  state.players.forEach((player) => {
    player.roundBet = 0;
    player.hasActedThisRound = false;
  });
  const first = playerById(state, state.smallBlindPlayerId);
  state.actionPlayerId = first && !first.folded && !first.eliminated && first.chips > 0
    ? first.id
    : nextPlayerFrom(state, state.smallBlindPlayerId);
}

function advanceAward(state) {
  while (state.potAwardIndex < state.pots.length && state.pots[state.potAwardIndex].amount === 0) {
    state.potAwardIndex += 1;
  }
  if (state.potAwardIndex >= state.pots.length) {
    const fallback = nonFoldedPlayers(state)[0];
    finishHand(state, state.handWinnerIds.length > 0 ? state.handWinnerIds : fallback ? [fallback.id] : []);
  }
}

function makeAction(type, details = {}) {
  return { type, ...details };
}

/**
 * Creates the initial, serializable GameState. It intentionally contains no
 * browser state: it can be constructed directly in a test.
 */
export function createGameState({
  players,
  smallBlind,
  smallBlindIncrease = 0,
  dealerId,
  useBigBlind = false,
  bettingLimit = BettingLimit.NO_LIMIT,
  fixedLimitBet = Math.max(1, smallBlind * 2),
}) {
  if (!Array.isArray(players) || players.length < 2) throw new Error('At least two players are required.');
  if (!Number.isInteger(smallBlind) || smallBlind < 0) throw new Error('Small blind must be a non-negative integer.');
  if (!players.some((player) => player.id === dealerId)) throw new Error('The dealer must be a player.');
  if (!Object.values(BettingLimit).includes(bettingLimit)) throw new Error('Betting limit is not supported.');
  if (!Number.isInteger(fixedLimitBet) || fixedLimitBet <= 0) throw new Error('Fixed-limit bet must be a positive integer.');

  return {
    phase: GamePhase.SETUP,
    players: players.map((player) => ({
      id: player.id,
      name: player.name || `Player ${player.id}`,
      chips: player.chips,
      folded: Boolean(player.folded),
      eliminated: Boolean(player.eliminated),
      roundBet: 0,
      handContribution: 0,
      hasActedThisRound: false,
    })),
    smallBlind,
    smallBlindIncrease,
    useBigBlind,
    bettingLimit,
    fixedLimitBet,
    dealerId,
    firstDealerId: dealerId,
    actionPlayerId: null,
    smallBlindPlayerId: null,
    bigBlindPlayerId: null,
    highestRoundBet: 0,
    lastFullRaiseSize: bettingLimit === BettingLimit.FIXED_LIMIT
      ? fixedLimitBet
      : Math.max(1, smallBlind * (useBigBlind ? 2 : 1)),
    round: 1,
    pots: [],
    handNumber: 0,
    potAwardIndex: 0,
    handWinnerIds: [],
  };
}

/** Returns the call and legal raise range for the selected Hold'em limit. */
export function getBettingBounds(state, playerId = state.actionPlayerId) {
  const player = playerById(state, playerId);
  if (!player || player.folded || player.eliminated || player.chips <= 0) {
    return { callAmount: 0, minRaiseAdditionalChips: 0, maxAdditionalChips: 0 };
  }

  const callAmount = amountToCall(state, player);
  const effectiveMaximum = maximumAdditionalBet(
    state.players.map((candidate) => ({ ...candidate, number: candidate.id })),
    player.id,
  );
  const lastFullRaiseSize = Number.isInteger(state.lastFullRaiseSize) && state.lastFullRaiseSize > 0
    ? state.lastFullRaiseSize
    : minimumFullBetForRound(state);
  let minRaiseAdditionalChips = callAmount + lastFullRaiseSize;
  let maxAdditionalChips = effectiveMaximum;

  if (state.bettingLimit === BettingLimit.POT_LIMIT) {
    const potBeforeAction = state.players.reduce(
      (total, candidate) => total + candidate.handContribution,
      0,
    );
    maxAdditionalChips = Math.min(
      effectiveMaximum,
      Math.max(minRaiseAdditionalChips, potBeforeAction + (callAmount * 2)),
    );
  } else if (state.bettingLimit === BettingLimit.FIXED_LIMIT) {
    const fixedRaiseSize = state.fixedLimitBet * (state.round <= 2 ? 1 : 2);
    minRaiseAdditionalChips = callAmount + fixedRaiseSize;
    maxAdditionalChips = Math.min(effectiveMaximum, minRaiseAdditionalChips);
  }

  return { callAmount, minRaiseAdditionalChips, maxAdditionalChips };
}

const debugPresets = Object.freeze({
  'two-pots': { phase: GamePhase.BETTING_RIVER, contributions: [25, 50, 50], chips: [0, 87, 88], actionPlayerId: 2, round: 4 },
  'three-pots': { phase: GamePhase.BETTING_RIVER, contributions: [25, 50, 75, 75], chips: [0, 0, 87, 88], actionPlayerId: 3, round: 4 },
  'all-in-runout': { phase: GamePhase.ALL_IN_RUNOUT, contributions: [25, 50, 50], chips: [0, 0, 175], actionPlayerId: null, round: 1 },
  'deal-flop': { phase: GamePhase.DEAL_FLOP, contributions: [10, 10, 10], chips: [90, 90, 90], actionPlayerId: null, round: 1 },
  showdown: { phase: GamePhase.SHOWDOWN, contributions: [20, 20, 20], chips: [80, 80, 80], actionPlayerId: null, round: 4 },
  'hand-won': { phase: GamePhase.HAND_COMPLETE, contributions: [0, 0, 0], chips: [140, 80, 80], actionPlayerId: null, round: 4, winnerIds: [1] },
  'game-won': { phase: GamePhase.GAME_COMPLETE, contributions: [0, 0], chips: [200, 0], actionPlayerId: null, round: 4, winnerIds: [1] },
});

/** Creates a named, internally consistent state for localhost debug starts. */
export function createDebugGameState(gameState, presetName) {
  const preset = debugPresets[presetName];
  if (!preset) return executeTransition(gameState, { type: Transition.START_HAND });
  if (gameState.phase !== GamePhase.SETUP) throw new Error('A debug starting point can only be created from setup.');
  if (gameState.players.length !== preset.chips.length) throw new Error(`${presetName} requires ${preset.chips.length} players.`);

  const state = clone(gameState);
  state.phase = preset.phase;
  state.handNumber = 1;
  state.round = preset.round;
  state.actionPlayerId = preset.actionPlayerId;
  state.smallBlindPlayerId = playerToDealersLeft(state, state.dealerId);
  state.bigBlindPlayerId = null;
  state.highestRoundBet = Math.max(0, ...preset.contributions);
  state.lastFullRaiseSize = minimumFullBetForRound(state);
  state.potAwardIndex = 0;
  state.handWinnerIds = [...(preset.winnerIds || [])];
  state.players.forEach((player, index) => {
    player.chips = preset.chips[index];
    player.roundBet = preset.contributions[index];
    player.handContribution = preset.contributions[index];
    player.hasActedThisRound = false;
    player.folded = false;
    player.eliminated = preset.phase === GamePhase.GAME_COMPLETE && player.chips === 0;
  });
  refreshPots(state);
  return state;
}

/** Returns only the transitions that are legal for this exact state. */
export function getAvailableActions(state) {
  if (state.phase === GamePhase.SETUP || state.phase === GamePhase.HAND_COMPLETE) {
    return [makeAction(state.phase === GamePhase.SETUP ? Transition.START_HAND : Transition.START_NEXT_HAND)];
  }
  if ([GamePhase.DEAL_HOLE_CARDS, GamePhase.DEAL_FLOP, GamePhase.DEAL_TURN, GamePhase.DEAL_RIVER, GamePhase.ALL_IN_RUNOUT].includes(state.phase)) {
    return [makeAction(Transition.CARDS_DEALT)];
  }
  if (state.phase === GamePhase.SHOWDOWN) {
    const pot = state.pots[state.potAwardIndex];
    if (!pot) return [];
    const eligiblePlayerIds = [...pot.eligiblePlayerNumbers];
    return [
      makeAction(Transition.AWARD_POT, { potIndex: state.potAwardIndex, eligiblePlayerIds }),
      ...(eligiblePlayerIds.length > 1 ? [makeAction(Transition.SPLIT_POT, { potIndex: state.potAwardIndex, eligiblePlayerIds })] : []),
    ];
  }
  if (!bettingPhases.includes(state.phase)) return [];

  const player = currentPlayer(state);
  if (!player) return [];
  const {
    callAmount,
    minRaiseAdditionalChips: minimumBet,
    maxAdditionalChips: maximumBet,
  } = getBettingBounds(state, player.id);
  const actions = [makeAction(Transition.FOLD)];
  if (callAmount === 0) actions.push(makeAction(Transition.CHECK));
  if (callAmount > 0) actions.push(makeAction(Transition.CALL, { additionalChips: callAmount }));
  if (maximumBet >= minimumBet) actions.push(makeAction(Transition.BET, {
    minAdditionalChips: minimumBet,
    maxAdditionalChips: maximumBet,
  }));
  if (maximumBet === player.chips && maximumBet > 0) actions.push(makeAction(Transition.ALL_IN, { additionalChips: maximumBet }));
  return actions;
}

/**
 * Applies one named transition and returns a new GameState. Invalid transitions
 * throw without modifying the supplied state.
 */
export function executeTransition(gameState, action) {
  if (!action?.type) throw new Error('A transition type is required.');
  const state = clone(gameState);

  if (action.type === Transition.START_HAND || action.type === Transition.START_NEXT_HAND) {
    const expected = action.type === Transition.START_HAND ? GamePhase.SETUP : GamePhase.HAND_COMPLETE;
    if (state.phase !== expected) throw new Error(`${action.type} is not allowed during ${state.phase}.`);
    if (action.type === Transition.START_NEXT_HAND) {
      state.dealerId = playerToDealersLeft(state, state.dealerId);
      if (state.dealerId === state.firstDealerId) state.smallBlind += state.smallBlindIncrease;
    }
    state.handNumber += 1;
    state.phase = GamePhase.DEAL_HOLE_CARDS;
    state.highestRoundBet = 0;
    state.round = 1;
    state.lastFullRaiseSize = minimumFullBetForRound(state);
    state.pots = [];
    state.potAwardIndex = 0;
    state.handWinnerIds = [];
    state.players.forEach((player) => {
      player.folded = player.eliminated;
      player.roundBet = 0;
      player.handContribution = 0;
      player.hasActedThisRound = false;
    });
    state.smallBlindPlayerId = playerToDealersLeft(state, state.dealerId);
    state.bigBlindPlayerId = state.useBigBlind ? playerToDealersLeft(state, state.smallBlindPlayerId) : null;
    postBlind(state, state.smallBlindPlayerId, state.smallBlind);
    if (state.bigBlindPlayerId !== null) postBlind(state, state.bigBlindPlayerId, state.smallBlind * 2, false);
    refreshPots(state);
    state.actionPlayerId = nextPlayerFrom(state, state.bigBlindPlayerId ?? state.smallBlindPlayerId);
    return state;
  }

  if (action.type === Transition.CARDS_DEALT) {
    if (state.phase === GamePhase.ALL_IN_RUNOUT) {
      state.phase = GamePhase.SHOWDOWN;
      state.potAwardIndex = 0;
      return state;
    }
    const nextBettingPhase = bettingPhaseFor[state.phase];
    if (!nextBettingPhase) throw new Error(`CARDS_DEALT is not allowed during ${state.phase}.`);
    state.phase = nextBettingPhase;
    if (state.phase !== GamePhase.BETTING_PREFLOP) {
      state.round += 1;
      prepareNextBettingRound(state);
    }
    return state;
  }

  if (action.type === Transition.AWARD_POT || action.type === Transition.SPLIT_POT) {
    if (state.phase !== GamePhase.SHOWDOWN) throw new Error(`A pot cannot be awarded during ${state.phase}.`);
    if (action.potIndex !== state.potAwardIndex) throw new Error('That pot is not ready to be awarded.');
    const pot = state.pots[state.potAwardIndex];
    if (!pot || pot.amount <= 0) throw new Error('There is no pot to award.');

    const winnerIds = action.type === Transition.AWARD_POT ? [action.winnerId] : action.winnerIds;
    if (!Array.isArray(winnerIds) || winnerIds.length === 0 || !winnerIds.every((id) => pot.eligiblePlayerNumbers.includes(id))) {
      throw new Error('A pot winner must be eligible for that pot.');
    }
    if (action.type === Transition.AWARD_POT && winnerIds.length !== 1) throw new Error('AWARD_POT requires exactly one winner.');
    if (action.type === Transition.SPLIT_POT && new Set(winnerIds).size < 2) throw new Error('SPLIT_POT requires at least two distinct winners.');

    const awards = splitPotAmount(pot.amount, winnerIds);
    awards.forEach(({ number: winnerId, amount }) => {
      playerById(state, winnerId).chips += amount;
      if (!state.handWinnerIds.includes(winnerId)) state.handWinnerIds.push(winnerId);
    });
    pot.amount = 0;
    state.potAwardIndex += 1;
    advanceAward(state);
    return state;
  }

  const player = assertBettingTurn(state, action);
  const {
    callAmount,
    minRaiseAdditionalChips: minimumBet,
    maxAdditionalChips: maximumBet,
  } = getBettingBounds(state, player.id);

  if (action.type === Transition.FOLD) {
    player.folded = true;
    refreshPots(state);
    resolveBetting(state);
    return state;
  }

  let additionalChips;
  if (action.type === Transition.CHECK) {
    if (callAmount !== 0) throw new Error('CHECK is not legal while chips are owed.');
    additionalChips = 0;
  } else if (action.type === Transition.CALL) {
    if (callAmount === 0) throw new Error('CALL is not legal when nothing is owed.');
    additionalChips = callAmount;
  } else if (action.type === Transition.ALL_IN) {
    if (maximumBet !== player.chips || maximumBet === 0) throw new Error('ALL_IN is not legal for this player.');
    additionalChips = maximumBet;
  } else if (action.type === Transition.BET) {
    additionalChips = Number(action.additionalChips);
    if (!Number.isInteger(additionalChips) || additionalChips < minimumBet || additionalChips > maximumBet) {
      throw new Error('BET amount is outside the legal range.');
    }
  } else {
    throw new Error(`Unknown transition: ${action.type}.`);
  }

  const previousHighestRoundBet = state.highestRoundBet;
  const newRoundBet = player.roundBet + additionalChips;
  const raiseSize = Math.max(0, newRoundBet - previousHighestRoundBet);

  player.chips -= additionalChips;
  player.roundBet = newRoundBet;
  player.handContribution += additionalChips;
  player.hasActedThisRound = true;
  if (raiseSize >= state.lastFullRaiseSize) state.lastFullRaiseSize = raiseSize;
  state.highestRoundBet = Math.max(state.highestRoundBet, player.roundBet);
  refreshPots(state);
  resolveBetting(state);
  return state;
}
