import { readFileSync } from 'node:fs';
import { createDecisionsResponse } from './openai-api.js';
import {
  buildDecisionInput,
  buildPokerDecisionRequest,
  narrationContent,
  placeValuesUpTo,
  PokerDecision,
  RaiseTarget,
  readPokerDecision,
  selectedValueFacts,
  valueQuestionsFor,
  winnerQuestions,
  winnersFromDecision,
} from './decisions.js';

const prompts = JSON.parse(readFileSync(new URL('./Prompts.json', import.meta.url), 'utf8'));

function toolCallFor(action, raiseTarget, amount) {
  switch (action) {
    case PokerDecision.CHECK: return { name: 'check', args: {} };
    case PokerDecision.CALL: return { name: 'call', args: {} };
    case PokerDecision.FOLD: return { name: 'fold', args: {} };
    case PokerDecision.ALL_IN: return { name: 'allIn', args: {} };
    case PokerDecision.CARDS_DEALT: return { name: 'cardsDealt', args: {} };
    case PokerDecision.UNDO: return { name: 'undo', args: {} };
    case PokerDecision.NEXT_HAND: return { name: 'nextHand', args: {} };
    case PokerDecision.BET:
    case PokerDecision.RAISE:
      return raiseTarget === RaiseTarget.RAISE_BY
        ? { name: 'raise', args: { amount } }
        : { name: 'bet', args: { total: amount } };
    default: return { name: null, args: {} };
  }
}

function reconcileRaiseTarget(gameState, raiseTarget, amount) {
  const player = gameState?.currentPlayer;
  const betAction = (gameState?.availableActions || []).find((entry) => entry.type === 'BET');
  if (!player || !betAction || !Number.isFinite(amount)) return raiseTarget;
  const min = betAction.minAdditionalChips ?? 0;
  const max = Number.isFinite(betAction.maxAdditionalChips) ? betAction.maxAdditionalChips : Infinity;
  const inRange = (value) => value >= min && value <= max;
  const toLegal = inRange(amount - (player.roundBet ?? 0));
  const byLegal = inRange((player.amountToCall ?? 0) + amount);
  if (raiseTarget === RaiseTarget.RAISE_BY && !byLegal && toLegal) return RaiseTarget.RAISE_TO;
  if (raiseTarget !== RaiseTarget.RAISE_BY && !toLegal && byLegal) return RaiseTarget.RAISE_BY;
  return raiseTarget;
}

function chipsMoved(gameState, toolName, args) {
  const player = gameState?.currentPlayer;
  if (!player) return null;
  if (toolName === 'call') return player.amountToCall ?? null;
  if (toolName === 'bet') return Number(args.total) - (player.roundBet ?? 0);
  if (toolName === 'raise') return (player.amountToCall ?? 0) + Number(args.amount);
  return null;
}

function successFacts(gameState, action, toolName, args) {
  const moved = chipsMoved(gameState, toolName, args);
  const pot = typeof gameState?.pot === 'number' ? gameState.pot : null;
  return {
    requested: action,
    actor: gameState?.currentPlayer?.name ?? null,
    chips_moved: moved,
    pot_after: pot !== null && typeof moved === 'number' ? pot + moved : pot,
  };
}

function pickWinnerFacts(gameState, winners) {
  return {
    requested: PokerDecision.PICK_WINNER,
    winners: winners.map((player) => player.name),
    pot_awarded: gameState?.showdown?.potAmount ?? null,
  };
}

function answerFacts(facts) {
  return facts;
}

function rejectionFacts(gameState, toolOutput) {
  return {
    rejected: true,
    error: toolOutput?.errorCode ?? 'UNKNOWN',
    details: toolOutput?.details ?? null,
    amount_to_call: gameState?.currentPlayer?.amountToCall ?? null,
    valid_options: (gameState?.availableActions || []).map((entry) => entry.type),
  };
}

function compactSetup(game) {
  if (!game) return null;
  return {
    variant: game.variant ?? null,
    starting_stack: game.startingStack ?? null,
    ante: game.ante ?? null,
    small_blind: game.smallBlind ?? null,
    big_blind: game.bigBlind ?? null,
    small_blind_increase: game.smallBlindIncrease ?? null,
    hand_number: game.handNumber ?? null,
    dealer: game.dealer?.name ?? null,
    small_blind_player: game.smallBlindPlayer?.name ?? null,
    big_blind_player: game.bigBlindPlayer?.name ?? null,
  };
}

function compactState(snapshot) {
  if (!snapshot) return null;
  return {
    pot: snapshot.pot ?? null,
    round: snapshot.round ?? null,
    current_player: snapshot.currentPlayer?.name ?? null,
    amount_to_call: snapshot.currentPlayer?.amountToCall ?? null,
    available_actions: (snapshot.availableActions || []).map((entry) => entry.type),
    players: (snapshot.players || []).map((player) => ({
      name: player.name,
      chips: player.chips,
      folded: player.folded,
    })),
  };
}

function announcementFacts(sourceEvent) {
  if (sourceEvent.type === 'game_started') {
    return { event: 'game_started', setup: compactSetup(sourceEvent.setup), instruction: sourceEvent.dealInstruction };
  }
  if (sourceEvent.type === 'new_hand_started') {
    return {
      event: 'new_hand_started',
      hand_number: sourceEvent.handNumber,
      setup: compactSetup(sourceEvent.setup),
      instruction: sourceEvent.dealInstruction,
    };
  }
  if (sourceEvent.type === 'state_transition') {
    return { event: 'state_transition', action: sourceEvent.action, state: compactState(sourceEvent.stateAfter) };
  }
  return { event: sourceEvent.type };
}

function decide(apiKey, body, fetchImplementation) {
  return createDecisionsResponse(apiKey, body, fetchImplementation);
}

export async function runDealerTurn(apiKey, payload, fetchImplementation = fetch) {
  const { sourceEvent, gameState, transcript, toolOutput, toolName } = payload || {};

  if (sourceEvent && sourceEvent.type !== 'voice_utterance') {
    return { speak: true, kind: 'announcement', utterance: narrationContent(announcementFacts(sourceEvent)) };
  }

  if (toolOutput) {
    return {
      speak: true,
      kind: 'clarification',
      utterance: narrationContent(rejectionFacts(gameState, toolOutput)),
      rejectedTool: toolName ?? null,
    };
  }

  const instructions = prompts.decisionsInstructions;
  const maxAmount = gameState?.currentPlayer?.chips ?? 0;
  const places = placeValuesUpTo(maxAmount);
  const decision = await decide(apiKey, buildPokerDecisionRequest({ instructions, gameState, transcript, maxAmount }), fetchImplementation);
  const parsed = readPokerDecision(decision, { places });
  const { action, amount } = parsed;
  const raiseTarget = (action === PokerDecision.BET || action === PokerDecision.RAISE)
    ? reconcileRaiseTarget(gameState, parsed.raiseTarget, amount)
    : parsed.raiseTarget;

  if (!action || action === PokerDecision.NOTHING) {
    return { speak: false, kind: 'ignored', utterance: '' };
  }

  if (action === PokerDecision.NARRATE_VALUES) {
    const valuesDecision = await decide(apiKey, {
      input: buildDecisionInput({ instructions, gameState, transcript }),
      questions: valueQuestionsFor(gameState),
    }, fetchImplementation);
    const facts = answerFacts(selectedValueFacts(valuesDecision, gameState));
    if (Object.keys(facts).length === 0) return { speak: false, kind: 'ignored', utterance: '' };
    return { speak: true, kind: 'answer', utterance: narrationContent(facts), toolName: null };
  }

  if (action === PokerDecision.PICK_WINNER) {
    const winnerDecision = await decide(apiKey, {
      input: buildDecisionInput({ instructions, gameState, transcript }),
      questions: winnerQuestions(gameState),
    }, fetchImplementation);
    const winners = winnersFromDecision(winnerDecision, gameState);
    if (winners.length === 0) return { speak: false, kind: 'ignored', utterance: '' };
    const call = winners.length > 1
      ? { name: 'splitPot', args: { playerNumbers: winners.map((player) => player.number) } }
      : { name: 'chooseWinner', args: { playerNumber: winners[0].number } };
    return {
      speak: true,
      kind: 'action_result',
      utterance: narrationContent(pickWinnerFacts(gameState, winners)),
      toolName: call.name,
      toolArgs: call.args,
    };
  }

  const call = toolCallFor(action, raiseTarget, amount);
  if (!call.name) return { speak: false, kind: 'ignored', utterance: '' };
  return {
    speak: true,
    kind: 'action_result',
    utterance: narrationContent(successFacts(gameState, action, call.name, call.args)),
    toolName: call.name,
    toolArgs: call.args,
  };
}
