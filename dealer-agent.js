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

function toolCallFor(action, raiseTarget, amount) {
  switch (action) {
    case PokerDecision.CHECK: return { name: 'check', args: {} };
    case PokerDecision.CALL: return { name: 'call', args: {} };
    case PokerDecision.FOLD: return { name: 'fold', args: {} };
    case PokerDecision.ALL_IN: return { name: 'allIn', args: {} };
    case PokerDecision.CARDS_DEALT: return { name: 'cardsDealt', args: {} };
    case PokerDecision.UNDO: return { name: 'undo', args: {} };
    case PokerDecision.NEXT_HAND: return { name: 'nextHand', args: {} };
    case PokerDecision.BET: return { name: 'bet', args: { total: amount } };
    case PokerDecision.RAISE: return raiseTarget === RaiseTarget.RAISE_BY
      ? { name: 'raise', args: { amount } }
      : { name: 'bet', args: { total: amount } };
    default: return { name: null, args: {} };
  }
}

function resultFacts({ action, toolName, output }) {
  if (output?.ok) {
    const winnerIds = output.action?.type === 'split_pot'
      ? output.action.winnerIds
      : (output.action?.winnerId != null ? [output.action.winnerId] : []);
    const players = output.stateAfter?.players || [];
    const winners = winnerIds
      .map((id) => players.find((player) => player.number === id)?.name)
      .filter(Boolean);
    return {
      requested: action,
      tool: toolName,
      actor: output.action?.actor?.name ?? null,
      chips_moved: output.action?.chipsMoved ?? null,
      total_round_bet: output.action?.totalRoundBet ?? null,
      pot_after: output.stateAfter?.pot ?? null,
      next_player: output.stateAfter?.currentPlayer?.name ?? null,
      instruction: output.stateAfter?.dealInstruction ?? null,
      winners: winners.length > 0 ? winners : null,
    };
  }
  return {
    requested: action,
    rejected: true,
    error: output?.errorCode ?? 'UNKNOWN',
    details: output?.details ?? null,
    amount_to_call: output?.stateAfter?.currentPlayer?.amountToCall ?? null,
    valid_options: (output?.stateAfter?.availableActions || []).map((entry) => entry.type),
    next_player: output?.stateAfter?.currentPlayer?.name ?? null,
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
    return {
      event: 'game_started',
      setup: compactSetup(sourceEvent.setup),
      instruction: sourceEvent.dealInstruction,
    };
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
    return {
      event: 'state_transition',
      action: sourceEvent.action,
      state: compactState(sourceEvent.stateAfter),
    };
  }
  return { event: sourceEvent.type };
}

export class DealerAgent {
  constructor({
    getGameState,
    executeTool,
    instructions = '',
    onStatus = () => {},
    onTiming = () => {},
    fetchImplementation = (...args) => fetch(...args),
    decisionsPath = '/api/decisions',
  }) {
    this.getGameState = getGameState;
    this.executeTool = executeTool;
    this.instructions = instructions;
    this.onStatus = onStatus;
    this.onTiming = onTiming;
    this.fetchImplementation = fetchImplementation;
    this.decisionsPath = decisionsPath;
    this.queue = Promise.resolve();
  }

  run(sourceEvent, recentConversation = [], preparedTurn = null) {
    const queuedAt = Date.now();
    const turn = this.queue.then(() => this.runTurn(
      sourceEvent,
      recentConversation,
      queuedAt,
      preparedTurn,
    ));
    this.queue = turn.catch(() => {});
    return turn;
  }

  voiceRequestBody(sourceEvent, snapshot) {
    return buildPokerDecisionRequest({
      instructions: this.instructions,
      gameState: snapshot,
      transcript: sourceEvent.transcript,
      maxAmount: snapshot?.currentPlayer?.chips ?? 0,
    });
  }

  prepare(sourceEvent, recentConversation = []) {
    if (sourceEvent.type !== 'voice_utterance') return null;
    const snapshot = this.getGameState();
    const preparedAt = Date.now();
    const request = this.decide(this.voiceRequestBody(sourceEvent, snapshot)).then(
      (response) => ({ response, decisionsMs: Date.now() - preparedAt }),
      (error) => ({ error, decisionsMs: Date.now() - preparedAt }),
    );
    return {
      sourceEventKey: JSON.stringify(sourceEvent),
      stateFingerprint: JSON.stringify(snapshot),
      preparedAt,
      request,
    };
  }

  async decide(body) {
    const response = await this.fetchImplementation(this.decisionsPath, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    const text = await response.text();
    let data;
    try {
      data = JSON.parse(text);
    } catch {
      data = null;
    }
    if (!response.ok) throw new Error(data?.error || text || 'The Decisions backend failed.');
    return data;
  }

  async runTurn(sourceEvent, recentConversation, queuedAt = Date.now(), preparedTurn = null) {
    const startedAt = Date.now();
    const timing = { queueMs: startedAt - queuedAt, decisionsMs: 0, javascriptMs: 0, totalBackendMs: 0 };

    if (sourceEvent.type !== 'voice_utterance') {
      timing.totalBackendMs = Date.now() - startedAt;
      this.onTiming(timing);
      return { speak: true, kind: 'announcement', utterance: narrationContent(announcementFacts(sourceEvent)), timing };
    }

    this.onStatus('Processing…');
    const snapshot = this.getGameState();
    const stateFingerprint = JSON.stringify(snapshot);
    const preparedMatches = preparedTurn
      && preparedTurn.sourceEventKey === JSON.stringify(sourceEvent)
      && preparedTurn.stateFingerprint === stateFingerprint;

    let decision;
    if (preparedMatches) {
      const preparedResult = await preparedTurn.request;
      timing.decisionsMs = preparedResult.decisionsMs;
      timing.speculativeLeadMs = Math.max(0, startedAt - preparedTurn.preparedAt);
      if (preparedResult.error) throw preparedResult.error;
      decision = preparedResult.response;
    } else {
      const requestedAt = Date.now();
      decision = await this.decide(this.voiceRequestBody(sourceEvent, snapshot));
      timing.decisionsMs = Date.now() - requestedAt;
    }

    if (JSON.stringify(this.getGameState()) !== stateFingerprint) {
      timing.staleStateIgnored = true;
      timing.totalBackendMs = Date.now() - startedAt;
      this.onTiming(timing);
      return { speak: false, kind: 'ignored', utterance: '', timing };
    }

    const places = placeValuesUpTo(snapshot?.currentPlayer?.chips ?? 0);
    const { action, raiseTarget, amount } = readPokerDecision(decision, { places });

    if (!action || action === PokerDecision.NOTHING) {
      timing.totalBackendMs = Date.now() - startedAt;
      this.onTiming(timing);
      return { speak: false, kind: 'ignored', utterance: '', timing };
    }

    if (action === PokerDecision.NARRATE_VALUES) {
      const valuesDecision = await this.decide({
        input: buildDecisionInput({
          instructions: this.instructions,
          gameState: snapshot,
          transcript: sourceEvent.transcript,
        }),
        questions: valueQuestionsFor(snapshot),
      });
      const facts = selectedValueFacts(valuesDecision, snapshot);
      timing.totalBackendMs = Date.now() - startedAt;
      this.onTiming(timing);
      if (Object.keys(facts).length === 0) return { speak: false, kind: 'ignored', utterance: '', timing };
      return { speak: true, kind: 'answer', utterance: narrationContent(facts), timing };
    }

    if (action === PokerDecision.PICK_WINNER) {
      const questions = winnerQuestions(snapshot);
      if (questions.length === 0) {
        timing.totalBackendMs = Date.now() - startedAt;
        this.onTiming(timing);
        return { speak: false, kind: 'ignored', utterance: '', timing };
      }
      const winnerDecision = await this.decide({
        input: buildDecisionInput({
          instructions: this.instructions,
          gameState: snapshot,
          transcript: sourceEvent.transcript,
        }),
        questions,
      });
      const winners = winnersFromDecision(winnerDecision, snapshot);
      if (winners.length === 0) {
        timing.totalBackendMs = Date.now() - startedAt;
        this.onTiming(timing);
        return { speak: false, kind: 'ignored', utterance: '', timing };
      }
      const toolName = winners.length > 1 ? 'splitPot' : 'chooseWinner';
      const toolArgs = winners.length > 1
        ? { playerNumbers: winners.map((player) => player.number) }
        : { playerNumber: winners[0].number };
      this.onStatus('Applying action…');
      const startedApplyAt = Date.now();
      let output;
      try {
        output = await this.executeTool(toolName, toolArgs);
      } catch (error) {
        output = {
          ok: false,
          errorCode: 'TOOL_EXECUTION_FAILED',
          details: { reason: error.message },
          stateAfter: this.getGameState(),
        };
      }
      timing.javascriptMs = Date.now() - startedApplyAt;
      timing.totalBackendMs = Date.now() - startedAt;
      this.onTiming(timing);
      return {
        speak: true,
        kind: output?.ok ? 'action_result' : 'clarification',
        utterance: narrationContent(resultFacts({ action, toolName, output })),
        timing,
      };
    }

    this.onStatus('Applying action…');
    const { name, args } = toolCallFor(action, raiseTarget, amount);
    const toolStartedAt = Date.now();
    let output;
    try {
      output = await this.executeTool(name, args);
    } catch (error) {
      output = {
        ok: false,
        errorCode: 'TOOL_EXECUTION_FAILED',
        details: { reason: error.message },
        stateAfter: this.getGameState(),
      };
    }
    timing.javascriptMs = Date.now() - toolStartedAt;
    timing.totalBackendMs = Date.now() - startedAt;
    this.onTiming(timing);

    return {
      speak: true,
      kind: output?.ok ? 'action_result' : 'clarification',
      utterance: narrationContent(resultFacts({ action, toolName: name, output })),
      timing,
    };
  }
}
