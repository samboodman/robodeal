import { BettingLimit, createGameState, executeTransition, GamePhase, getAvailableActions, Transition } from './game-state.js';

const VARIANTS = Object.freeze({
  NT: BettingLimit.NO_LIMIT,
  FT: BettingLimit.FIXED_LIMIT,
  PO: BettingLimit.POT_LIMIT,
});

function parseArray(value, field) {
  const source = String(value || '').trim();
  if (!source.startsWith('[') || !source.endsWith(']')) throw new Error(`${field} must be an array.`);
  return source.slice(1, -1).split(',').map((entry) => entry.trim()).filter(Boolean).map((entry) => {
    if (entry === 'inf') return Infinity;
    const number = Number(entry);
    if (!Number.isFinite(number)) throw new Error(`${field} contains an invalid number.`);
    return number;
  });
}

function readField(text, name) {
  const match = text.match(new RegExp(`^\\s*${name}\\s*=\\s*(.+)$`, 'm'));
  return match?.[1]?.replace(/\s+#.*$/, '').trim() ?? null;
}

function readActions(text) {
  const assignment = text.match(/^\s*actions\s*=\s*\[/m);
  if (!assignment || assignment.index === undefined) throw new Error('actions is required.');
  const openingIndex = text.indexOf('[', assignment.index);
  let closingIndex = -1;
  let quote = null;
  let escaped = false;
  for (let index = openingIndex + 1; index < text.length; index += 1) {
    const character = text[index];
    if (quote) {
      if (!escaped && character === quote) quote = null;
      escaped = !escaped && character === '\\';
      if (character !== '\\') escaped = false;
      continue;
    }
    if (character === '"' || character === "'") quote = character;
    else if (character === ']') { closingIndex = index; break; }
  }
  if (closingIndex < 0) throw new Error('actions has no closing bracket.');
  const actions = [];
  const expression = /'(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*"/g;
  let item;
  const source = text.slice(openingIndex + 1, closingIndex);
  while ((item = expression.exec(source))) {
    const quoted = item[0];
    if (quoted.startsWith('"')) actions.push(JSON.parse(quoted));
    else actions.push(quoted.slice(1, -1).replace(/\\'/g, "'").replace(/\\\\/g, '\\'));
  }
  return actions;
}

export function parsePhh(text) {
  const variant = readField(text, 'variant')?.replace(/^(?:"|')|(?:"|')$/g, '');
  if (!variant) throw new Error('variant is required.');
  const startingStacks = parseArray(readField(text, 'starting_stacks'), 'starting_stacks');
  const antes = parseArray(readField(text, 'antes'), 'antes');
  const blinds = parseArray(readField(text, 'blinds_or_straddles'), 'blinds_or_straddles');
  if (startingStacks.length < 2 || antes.length !== startingStacks.length || blinds.length !== startingStacks.length) {
    throw new Error('Player arrays must have the same length and include at least two players.');
  }
  return {
    variant,
    antes,
    blinds,
    startingStacks,
    minBet: readField(text, 'min_bet') === null ? null : Number(readField(text, 'min_bet')),
    smallBet: readField(text, 'small_bet') === null ? null : Number(readField(text, 'small_bet')),
    bigBet: readField(text, 'big_bet') === null ? null : Number(readField(text, 'big_bet')),
    actions: readActions(text),
  };
}

function unsupported(reason) {
  return { status: 'unsupported', reason, checkedActions: 0, errors: [] };
}

function configurationFor(hand) {
  const bettingLimit = VARIANTS[hand.variant];
  if (!bettingLimit) return { reason: `Variant ${hand.variant} is not supported by RoboDeal.` };
  if (!hand.startingStacks.every(Number.isSafeInteger) || !hand.startingStacks.every((stack) => stack > 0)) {
    return { reason: 'RoboDeal validates only positive integer starting stacks.' };
  }
  if (!hand.antes.every((ante) => Number.isSafeInteger(ante) && ante >= 0)) {
    return { reason: 'RoboDeal validates only non-negative integer antes.' };
  }
  if (!hand.blinds.every(Number.isSafeInteger) || hand.blinds[0] <= 0 || hand.blinds[1] !== hand.blinds[0] * 2 || hand.blinds.slice(2).some((blind) => blind !== 0)) {
    return { reason: 'RoboDeal requires a small blind, a double-sized big blind, and no straddles.' };
  }
  const fixedLimitBet = hand.smallBet;
  if (bettingLimit === BettingLimit.FIXED_LIMIT && (!Number.isSafeInteger(fixedLimitBet) || fixedLimitBet <= 0 || hand.bigBet !== fixedLimitBet * 2)) {
    return { reason: 'RoboDeal fixed-limit validation requires integer small_bet and a double-sized big_bet.' };
  }
  if (bettingLimit !== BettingLimit.FIXED_LIMIT && (!Number.isSafeInteger(hand.minBet) || hand.minBet !== hand.blinds[1])) {
    return { reason: 'RoboDeal requires min_bet to equal the big blind for no-limit and pot-limit PHH.' };
  }
  const playerCount = hand.startingStacks.length;
  const uniformAnte = new Set(hand.antes).size === 1;
  // PHH stores a big-blind ante together with that player's blind. RoboDeal
  // stores an ante separately, so replay its extra forced contribution below.
  const bigBlindAnte = hand.antes[1] - hand.blinds[1];
  const hasBigBlindAnte = !uniformAnte
    && hand.antes.every((ante, index) => index === 1 ? ante === hand.blinds[1] + bigBlindAnte : ante === 0)
    && bigBlindAnte > 0;
  if (!uniformAnte && !hasBigBlindAnte) {
    return { reason: 'RoboDeal validates uniform antes or a standard big-blind ante.' };
  }
  return {
    bigBlindAnte: hasBigBlindAnte ? bigBlindAnte : 0,
    game: createGameState({
      players: hand.startingStacks.map((chips, index) => ({ id: index + 1, name: `p${index + 1}`, chips })),
      smallBlind: hand.blinds[0],
      dealerId: playerCount === 2 ? 1 : playerCount,
      useBigBlind: true,
      bettingLimit,
      fixedLimitBet: bettingLimit === BettingLimit.FIXED_LIMIT ? fixedLimitBet : hand.blinds[1],
      ante: uniformAnte ? hand.antes[0] : 0,
    }),
  };
}

function postBigBlindAnte(state, amount) {
  if (!amount) return state;
  const bigBlind = state.players.find((player) => player.id === state.bigBlindPlayerId);
  if (!bigBlind) throw new Error('Big blind is required to post a big-blind ante.');
  if (bigBlind.chips < amount) throw new Error('Big blind cannot cover the PHH big-blind ante.');
  bigBlind.chips -= amount;
  bigBlind.handContribution += amount;
  return state;
}

function actionError(index, action, state, error) {
  return {
    actionIndex: index,
    action,
    phase: state.phase,
    expectedPlayer: state.actionPlayerId === null ? null : `p${state.actionPlayerId}`,
    message: error.message || String(error),
  };
}

function transitionForPlayerAction(state, actor, verb, amount) {
  const playerId = Number(actor.slice(1));
  if (verb === 'f') return { type: Transition.FOLD, playerId };
  if (verb === 'cc') {
    const call = getAvailableActions(state).find((action) => action.type === Transition.CALL);
    return { type: call ? Transition.CALL : Transition.CHECK, playerId };
  }
  if (verb === 'cbr') {
    const total = Number(amount);
    if (!Number.isSafeInteger(total) || total <= 0) throw new Error('cbr needs a positive integer total wager.');
    const player = state.players.find((candidate) => candidate.id === playerId);
    if (!player) throw new Error('Unknown PHH player.');
    const additionalChips = total - player.roundBet;
    const allIn = additionalChips === player.chips;
    return { type: allIn ? Transition.ALL_IN : Transition.BET, playerId, ...(allIn ? {} : { additionalChips }) };
  }
  return null;
}

/** Replays the supported betting portion of a single PHH document. */
export function validatePhh(text) {
  let hand;
  try { hand = parsePhh(text); } catch (error) {
    return { status: 'invalid', reason: 'PHH parse error.', checkedActions: 0, errors: [{ actionIndex: null, action: null, message: error.message }] };
  }
  const configuration = configurationFor(hand);
  if (configuration.reason) return unsupported(configuration.reason);

  let state = executeTransition(configuration.game, { type: Transition.START_HAND });
  postBigBlindAnte(state, configuration.bigBlindAnte);
  let holeDeals = 0;
  const errors = [];
  let checkedActions = 0;

  for (let index = 0; index < hand.actions.length; index += 1) {
    const source = hand.actions[index].trim();
    if (!source || source.startsWith('#')) continue;
    const tokens = source.split(/\s+/);
    try {
      if (tokens[0] === 'd' && tokens[1] === 'dh') {
        if (state.phase !== GamePhase.DEAL_HOLE_CARDS) throw new Error('Hole cards were dealt outside the initial deal.');
        const expectedPlayer = `p${holeDeals + 1}`;
        if (tokens[2] !== expectedPlayer) throw new Error(`Hole cards must be dealt to ${expectedPlayer} next.`);
        holeDeals += 1;
        const activePlayers = state.players.filter((player) => !player.eliminated).length;
        if (holeDeals > activePlayers) throw new Error('Too many hole-card deals.');
        if (holeDeals === activePlayers) state = executeTransition(state, { type: Transition.CARDS_DEALT });
      } else if (tokens[0] === 'd' && tokens[1] === 'db') {
        if (state.phase === GamePhase.ALL_IN_RUNOUT) {
          state = executeTransition(state, { type: Transition.CARDS_DEALT });
        } else if ([GamePhase.DEAL_FLOP, GamePhase.DEAL_TURN, GamePhase.DEAL_RIVER].includes(state.phase)) {
          state = executeTransition(state, { type: Transition.CARDS_DEALT });
        } else if (state.phase !== GamePhase.SHOWDOWN) {
          throw new Error('Board cards were dealt before the betting round was complete.');
        }
      } else if (/^p\d+$/.test(tokens[0]) && ['f', 'cc', 'cbr'].includes(tokens[1])) {
        const transition = transitionForPlayerAction(state, tokens[0], tokens[1], tokens[2]);
        state = executeTransition(state, transition);
      } else if (/^p\d+$/.test(tokens[0]) && tokens[1] === 'sm') {
        // PHH may table all-in cards before the dealer runs the remaining board.
        // Physical cards/showing do not alter RoboDeal's chip-state machine.
      } else if (!source.startsWith('#')) {
        return unsupported(`PHH action ${source} is outside the RoboDeal Hold'em action set.`);
      }
      checkedActions += 1;
    } catch (error) {
      errors.push(actionError(index, source, state, error));
      break;
    }
  }

  return errors.length
    ? { status: 'invalid', checkedActions, errors, finalPhase: state.phase }
    : { status: 'valid', checkedActions, errors: [], finalPhase: state.phase };
}
