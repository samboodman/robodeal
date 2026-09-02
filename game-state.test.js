import assert from "node:assert/strict";
import test from "node:test";
import {
  BettingLimit,
  clearLog,
  createDebugGameState,
  createGameState,
  executeTransition,
  gameStartedAt,
  GamePhase,
  getAvailableActions,
  log,
  materializeLogState,
  setGameStartedAt,
  Transition,
} from "./game-state.js";

function game({
  chips = [250, 250, 250],
  useBigBlind = false,
  bettingLimit = BettingLimit.NO_LIMIT,
  fixedLimitBet = 10,
} = {}) {
  return createGameState({
    players: [
      { id: 1, name: "Dad", chips: chips[0] },
      { id: 2, name: "Abby", chips: chips[1] },
      { id: 3, name: "Sam", chips: chips[2] },
    ],
    smallBlind: 5,
    smallBlindIncrease: 5,
    dealerId: 1,
    useBigBlind,
    bettingLimit,
    fixedLimitBet,
  });
}

function start(state) {
  return executeTransition(
    executeTransition(state, { type: Transition.START_HAND }),
    { type: Transition.CARDS_DEALT }
  );
}

function action(state, type, details = {}) {
  return executeTransition(state, {
    type,
    playerId: state.actionPlayerId,
    ...details,
  });
}

function completeByFolding(state) {
  let next = action(state, Transition.FOLD);
  return action(next, Transition.FOLD);
}

function completeRoundWithCalls(state) {
  let next = action(state, Transition.CALL);
  return action(next, Transition.CALL);
}

function completeRoundWithChecks(state) {
  let next = action(state, Transition.CHECK);
  next = action(next, Transition.CHECK);
  return action(next, Transition.CHECK);
}

test("game start time is a shared exported binding", () => {
  assert.equal(setGameStartedAt(123.5), 123.5);
  assert.equal(gameStartedAt, 123.5);
});

test("log stores a full state every five items and differences between them", () => {
  clearLog();
  let currentState = executeTransition(game(), { type: Transition.START_HAND });
  currentState = executeTransition(currentState, {
    type: Transition.CARDS_DEALT,
  });
  currentState = action(currentState, Transition.CALL);
  currentState = action(currentState, Transition.CALL);

  assert.ok(log.length > 5);
  log.forEach((entry, index) => {
    assert.equal(Array.isArray(entry.State), index % 5 !== 0);
  });
  assert.ok(
    log.every((entry) => /^\d{2}:\d{2}:\d{2}\.\d{2}$/.test(entry.Time))
  );
  assert.ok(log.every((entry) => ["Action", "Event"].includes(entry.Kind)));
  assert.deepEqual(materializeLogState(log.length - 1), currentState);
  assert.ok(
    log.at(-1).State.some(({ path }) => path.includes("actionPlayerId"))
  );
});

test("log distinguishes opening bets from raises", () => {
  clearLog();
  let state = start(game());
  state = action(state, Transition.CALL);
  state = action(state, Transition.BET, { additionalChips: 10 });

  assert.equal(log.at(-1).Type, "Raise");
  assert.equal(log.at(-1).Kind, "Action");

  clearLog();
  state = start(game());
  state = action(state, Transition.CALL);
  state = action(state, Transition.CALL);
  state = executeTransition(state, { type: Transition.CARDS_DEALT });
  action(state, Transition.BET, { additionalChips: 5 });

  assert.equal(log.at(-1).Type, "Bet");
  assert.equal(log.at(-1).Kind, "Action");
});

test("log is persisted in browser storage", () => {
  const originalLocalStorage = Object.getOwnPropertyDescriptor(
    globalThis,
    "localStorage"
  );
  const storedValues = new Map();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key) => storedValues.get(key) ?? null,
      setItem: (key, value) => storedValues.set(key, value),
    },
  });

  try {
    clearLog();
    executeTransition(game(), { type: Transition.START_HAND });
    const storedLog = JSON.parse(storedValues.get("robodeal-log-v1"));
    assert.equal(storedLog.length, log.length);
    assert.deepEqual(storedLog, log);
  } finally {
    clearLog();
    if (originalLocalStorage) {
      Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
    } else {
      delete globalThis.localStorage;
    }
  }
});

test("GameState creation validates the immutable table configuration", () => {
  assert.throws(
    () => createGameState({ players: [], smallBlind: 5, dealerId: 1 }),
    /At least two/
  );
  assert.throws(
    () =>
      createGameState({
        players: [
          { id: 1, chips: 1 },
          { id: 2, chips: 1 },
        ],
        smallBlind: -1,
        dealerId: 1,
      }),
    /Small blind/
  );
  assert.throws(
    () =>
      createGameState({
        players: [
          { id: 1, chips: 1 },
          { id: 2, chips: 1 },
        ],
        smallBlind: 1,
        dealerId: 3,
      }),
    /dealer/
  );
  assert.throws(
    () =>
      createGameState({
        players: [
          { id: 1, chips: 1 },
          { id: 2, chips: 1 },
        ],
        smallBlind: 1,
        dealerId: 1,
        bettingLimit: "unlimited-ish",
      }),
    /Betting limit/
  );
  assert.throws(
    () =>
      createGameState({
        players: [
          { id: 1, chips: 1 },
          { id: 2, chips: 1 },
        ],
        smallBlind: 1,
        dealerId: 1,
        bettingLimit: BettingLimit.FIXED_LIMIT,
        fixedLimitBet: 0,
      }),
    /Fixed-limit bet/
  );
});

test("GameState uses camel case for the active first dealer", () => {
  const state = game();
  assert.equal(state.activeFirstDealerId, state.dealerId);
  assert.equal(Object.hasOwn(state, "ActiveFirstDealerId"), false);
});

test("debug presets create authoritative states with working pots and transitions", () => {
  const twoPots = createDebugGameState(
    game({ chips: [100, 100, 100] }),
    "two-pots"
  );
  assert.equal(twoPots.phase, GamePhase.BETTING_RIVER);
  assert.equal(twoPots.actionPlayerId, 2);
  assert.deepEqual(
    twoPots.pots.map((pot) => pot.amount),
    [75, 50]
  );
  assert.ok(
    getAvailableActions(twoPots).some(({ type }) => type === Transition.CHECK)
  );

  const showdown = createDebugGameState(
    game({ chips: [100, 100, 100] }),
    "showdown"
  );
  assert.equal(showdown.phase, GamePhase.SHOWDOWN);
  assert.deepEqual(getAvailableActions(showdown)[0], {
    type: Transition.AWARD_POT,
    potIndex: 0,
    eligiblePlayerIds: [1, 2, 3],
  });
});

test("debug presets enforce their player count and normal uses the regular start transition", () => {
  assert.throws(
    () => createDebugGameState(game(), "game-won"),
    /requires 2 players/
  );
  assert.equal(
    createDebugGameState(game(), "normal").phase,
    GamePhase.DEAL_HOLE_CARDS
  );
});

test("transitions return a new state without mutating the input state", () => {
  const setup = game();
  const before = structuredClone(setup);
  const next = executeTransition(setup, { type: Transition.START_HAND });

  assert.deepEqual(setup, before);
  assert.notEqual(next, setup);
});

test("START_HAND posts the blind and enters a named deal state", () => {
  const state = executeTransition(game(), { type: Transition.START_HAND });

  assert.equal(state.phase, GamePhase.DEAL_HOLE_CARDS);
  assert.equal(state.smallBlindPlayerId, 2);
  assert.equal(state.actionPlayerId, 3);
  assert.equal(state.players[1].chips, 245);
  assert.deepEqual(getAvailableActions(state), [
    { type: Transition.CARDS_DEALT },
  ]);
});

test("turns follow the locked physical player order instead of numeric order", () => {
  const state = executeTransition(
    createGameState({
      players: [
        { id: 1, name: "One", chips: 100 },
        { id: 3, name: "Three", chips: 100 },
        { id: 2, name: "Two", chips: 100 },
      ],
      smallBlind: 5,
      dealerId: 1,
    }),
    { type: Transition.START_HAND }
  );

  assert.equal(state.smallBlindPlayerId, 3);
  assert.equal(state.actionPlayerId, 2);
});

test("CARDS_DEALT starts preflop with only legal current-player actions", () => {
  const state = start(game());

  assert.equal(state.phase, GamePhase.BETTING_PREFLOP);
  assert.equal(state.actionPlayerId, 3);
  assert.deepEqual(getAvailableActions(state), [
    { type: Transition.FOLD },
    { type: Transition.CALL, additionalChips: 5 },
    { type: Transition.BET, minAdditionalChips: 10, maxAdditionalChips: 250 },
    { type: Transition.ALL_IN, additionalChips: 250 },
  ]);
});

test("matching the small blind does not ask the small-blind player to act again", () => {
  let state = start(game());

  state = action(state, Transition.CALL);
  state = action(state, Transition.CALL);

  assert.equal(state.phase, GamePhase.DEAL_FLOP);
  assert.equal(state.actionPlayerId, null);
  assert.deepEqual(getAvailableActions(state), [
    { type: Transition.CARDS_DEALT },
  ]);
});

test("every betting transition validates its guard", () => {
  const state = start(game());

  assert.throws(() => action(state, Transition.CHECK), /not legal/);
  assert.throws(
    () => executeTransition(state, { type: Transition.CALL, playerId: 1 }),
    /not that player/
  );
  assert.throws(
    () => action(state, Transition.BET, { additionalChips: 4 }),
    /outside the legal range/
  );
  assert.throws(
    () => action(state, Transition.BET, { additionalChips: 5 }),
    /outside the legal range/
  );
});

test("CHECK is available only with no outstanding bet and advances to the next player", () => {
  let state = start(game());
  state = completeRoundWithCalls(state);
  state = executeTransition(state, { type: Transition.CARDS_DEALT });

  assert.equal(state.phase, GamePhase.BETTING_FLOP);
  assert.equal(state.actionPlayerId, 2);
  assert.ok(
    getAvailableActions(state).some(({ type }) => type === Transition.CHECK)
  );
  assert.equal(
    getAvailableActions(state).some(({ type }) => type === Transition.CALL),
    false
  );

  state = action(state, Transition.CHECK);
  assert.equal(state.actionPlayerId, 3);
  assert.equal(state.players[1].hasActedThisRound, true);
});

test("normal betting moves action around the table and then requests the flop", () => {
  let state = start(game());
  state = action(state, Transition.BET, { additionalChips: 100 });
  assert.equal(state.actionPlayerId, 1);
  state = action(state, Transition.CALL);
  assert.equal(state.actionPlayerId, 2);
  state = action(state, Transition.CALL);

  assert.equal(state.phase, GamePhase.DEAL_FLOP);
  assert.equal(state.actionPlayerId, null);
});

test("tracks the last full raise size and calls do not replace it", () => {
  let state = start(game());

  state = action(state, Transition.BET, { additionalChips: 15 });
  assert.equal(state.lastFullRaiseSize, 10);
  assert.equal(
    getAvailableActions(state).find(({ type }) => type === Transition.BET)
      .minAdditionalChips,
    25
  );

  state = action(state, Transition.CALL);
  assert.equal(state.lastFullRaiseSize, 10);
  assert.equal(
    getAvailableActions(state).find(({ type }) => type === Transition.BET)
      .minAdditionalChips,
    20
  );
});

test("a 50-chip opening bet requires at least 100 additional chips to raise", () => {
  let state = start(game());
  state = completeRoundWithCalls(state);
  state = executeTransition(state, { type: Transition.CARDS_DEALT });

  state = action(state, Transition.BET, { additionalChips: 50 });

  assert.equal(state.lastFullRaiseSize, 50);
  assert.deepEqual(
    getAvailableActions(state).find(({ type }) => type === Transition.CALL),
    {
      type: Transition.CALL,
      additionalChips: 50,
    }
  );
  assert.deepEqual(
    getAvailableActions(state).find(({ type }) => type === Transition.BET),
    {
      type: Transition.BET,
      minAdditionalChips: 100,
      maxAdditionalChips: 245,
    }
  );
  assert.throws(
    () => action(state, Transition.BET, { additionalChips: 99 }),
    /outside the legal range/
  );
});

test("limited chips allow a short all-in without replacing the last full raise size", () => {
  let state = start(game({ chips: [250, 250, 75] }));
  state = completeRoundWithCalls(state);
  state = executeTransition(state, { type: Transition.CARDS_DEALT });

  state = action(state, Transition.BET, { additionalChips: 50 });
  const limitedPlayerActions = getAvailableActions(state);

  assert.equal(
    limitedPlayerActions.some(({ type }) => type === Transition.BET),
    false
  );
  assert.deepEqual(
    limitedPlayerActions.find(({ type }) => type === Transition.ALL_IN),
    {
      type: Transition.ALL_IN,
      additionalChips: 70,
    }
  );

  state = action(state, Transition.ALL_IN);

  assert.equal(state.lastFullRaiseSize, 50);
  assert.equal(state.players.find((player) => player.id === 3).chips, 0);
  assert.deepEqual(
    getAvailableActions(state).find(({ type }) => type === Transition.BET),
    {
      type: Transition.BET,
      minAdditionalChips: 120,
      maxAdditionalChips: 245,
    }
  );
});

test("the two-all-in sequence cannot skip the player who still owes chips", () => {
  let state = start(game());
  state = action(state, Transition.ALL_IN);
  state = action(state, Transition.ALL_IN);

  assert.equal(state.phase, GamePhase.BETTING_PREFLOP);
  assert.equal(state.actionPlayerId, 2);
  assert.deepEqual(
    getAvailableActions(state).find(({ type }) => type === Transition.CALL),
    {
      type: Transition.CALL,
      additionalChips: 245,
    }
  );

  state = action(state, Transition.CALL);
  assert.equal(state.phase, GamePhase.ALL_IN_RUNOUT);
});

test("all-in runout leads to showdown only after CARDS_DEALT", () => {
  let state = start(game());
  state = action(state, Transition.ALL_IN);
  state = action(state, Transition.ALL_IN);
  state = action(state, Transition.CALL);

  state = executeTransition(state, { type: Transition.CARDS_DEALT });
  assert.equal(state.phase, GamePhase.SHOWDOWN);
  assert.equal(getAvailableActions(state)[0].type, Transition.AWARD_POT);
});

test("CARDS_DEALT traverses every named deal and betting phase through river showdown", () => {
  let state = start(game());
  state = completeRoundWithCalls(state);
  assert.equal(state.phase, GamePhase.DEAL_FLOP);

  state = executeTransition(state, { type: Transition.CARDS_DEALT });
  assert.equal(state.phase, GamePhase.BETTING_FLOP);
  assert.equal(state.round, 2);
  state = completeRoundWithChecks(state);
  assert.equal(state.phase, GamePhase.DEAL_TURN);

  state = executeTransition(state, { type: Transition.CARDS_DEALT });
  assert.equal(state.phase, GamePhase.BETTING_TURN);
  assert.equal(state.round, 3);
  state = completeRoundWithChecks(state);
  assert.equal(state.phase, GamePhase.DEAL_RIVER);

  state = executeTransition(state, { type: Transition.CARDS_DEALT });
  assert.equal(state.phase, GamePhase.BETTING_RIVER);
  assert.equal(state.round, 4);
  state = completeRoundWithChecks(state);
  assert.equal(state.phase, GamePhase.SHOWDOWN);
});

test("a zero-stakes checked-down hand can still choose a showdown winner", () => {
  let state = start(
    createGameState({
      players: [
        { id: 1, chips: 100 },
        { id: 2, chips: 100 },
      ],
      smallBlind: 0,
      dealerId: 1,
    })
  );

  state = action(state, Transition.CHECK);
  for (let street = 0; street < 3; street += 1) {
    state = executeTransition(state, { type: Transition.CARDS_DEALT });
    state = action(state, Transition.CHECK);
    state = action(state, Transition.CHECK);
  }

  assert.equal(state.phase, GamePhase.SHOWDOWN);
  assert.equal(state.pots[0].amount, 0);
  state = executeTransition(state, {
    type: Transition.AWARD_POT,
    potIndex: 0,
    winnerId: 2,
  });
  assert.equal(state.phase, GamePhase.HAND_COMPLETE);
  assert.deepEqual(state.handWinnerIds, [2]);
});

test("CARDS_DEALT and betting actions are rejected from the wrong phases", () => {
  const setup = game();
  assert.throws(
    () => executeTransition(setup, { type: Transition.CARDS_DEALT }),
    /not allowed/
  );
  assert.throws(
    () => executeTransition(setup, { type: Transition.FOLD, playerId: 1 }),
    /No betting action/
  );

  const dealt = executeTransition(setup, { type: Transition.START_HAND });
  assert.throws(
    () => executeTransition(dealt, { type: Transition.START_HAND }),
    /not allowed/
  );
  assert.throws(
    () => executeTransition(dealt, { type: Transition.START_NEXT_HAND }),
    /not allowed/
  );
});

test("FOLD automatically awards the uncontested pot and completes the hand", () => {
  let state = start(game());
  state = action(state, Transition.FOLD);
  state = action(state, Transition.FOLD);

  assert.equal(state.phase, GamePhase.HAND_COMPLETE);
  assert.equal(state.handWinnerIds[0], 2);
  assert.equal(state.players[1].chips, 250);
});

test("showdown transitions award and split pots only to eligible players", () => {
  let state = start(game({ chips: [25, 50, 50] }));
  state = action(state, Transition.ALL_IN);
  state = action(state, Transition.ALL_IN);
  state = action(state, Transition.ALL_IN);
  state = executeTransition(state, { type: Transition.CARDS_DEALT });

  assert.equal(state.pots.length, 2);
  assert.throws(
    () =>
      executeTransition(state, {
        type: Transition.AWARD_POT,
        potIndex: 1,
        winnerId: 2,
      }),
    /not ready/
  );
  state = executeTransition(state, {
    type: Transition.AWARD_POT,
    potIndex: 0,
    winnerId: 1,
  });
  state = executeTransition(state, {
    type: Transition.SPLIT_POT,
    potIndex: 1,
    winnerIds: [2, 3],
  });

  assert.equal(state.phase, GamePhase.HAND_COMPLETE);
  assert.deepEqual(state.handWinnerIds, [1, 2, 3]);
});

test("showdown rejects ineligible, empty, duplicate, and incorrectly ordered awards", () => {
  let state = start(game({ chips: [25, 50, 50] }));
  state = action(state, Transition.ALL_IN);
  state = action(state, Transition.ALL_IN);
  state = action(state, Transition.ALL_IN);
  state = executeTransition(state, { type: Transition.CARDS_DEALT });

  assert.throws(
    () =>
      executeTransition(state, {
        type: Transition.AWARD_POT,
        potIndex: 0,
        winnerId: 99,
      }),
    /eligible/
  );
  assert.throws(
    () =>
      executeTransition(state, {
        type: Transition.SPLIT_POT,
        potIndex: 0,
        winnerIds: [1],
      }),
    /distinct/
  );
  assert.throws(
    () =>
      executeTransition(state, {
        type: Transition.SPLIT_POT,
        potIndex: 0,
        winnerIds: [1, 1],
      }),
    /distinct/
  );
  state = executeTransition(state, {
    type: Transition.AWARD_POT,
    potIndex: 0,
    winnerId: 1,
  });
  assert.throws(
    () =>
      executeTransition(state, {
        type: Transition.AWARD_POT,
        potIndex: 0,
        winnerId: 1,
      }),
    /There is no pot|not ready/
  );
});

test("START_NEXT_HAND is available only after a completed hand and rotates dealer and blinds", () => {
  let state = completeByFolding(start(game()));

  assert.equal(state.phase, GamePhase.HAND_COMPLETE);
  assert.deepEqual(getAvailableActions(state), [
    { type: Transition.START_NEXT_HAND },
  ]);
  state = executeTransition(state, { type: Transition.START_NEXT_HAND });

  assert.equal(state.phase, GamePhase.DEAL_HOLE_CARDS);
  assert.equal(state.handNumber, 2);
  assert.equal(state.dealerId, 2);
  assert.equal(state.smallBlindPlayerId, 3);
  assert.equal(state.actionPlayerId, 1);
});

test("the blind increases only when the dealer returns to the first dealer", () => {
  let state = completeByFolding(start(game()));
  state = executeTransition(state, { type: Transition.START_NEXT_HAND });
  state = completeByFolding(
    executeTransition(state, { type: Transition.CARDS_DEALT })
  );
  state = executeTransition(state, { type: Transition.START_NEXT_HAND });
  state = completeByFolding(
    executeTransition(state, { type: Transition.CARDS_DEALT })
  );
  state = executeTransition(state, { type: Transition.START_NEXT_HAND });

  assert.equal(state.dealerId, 1);
  assert.equal(state.smallBlind, 10);
});

test("GAME_COMPLETE has no available transitions", () => {
  clearLog();
  let state = start(game({ chips: [5, 5, 5] }));
  state = action(state, Transition.ALL_IN);
  state = action(state, Transition.ALL_IN);
  state = executeTransition(state, { type: Transition.CARDS_DEALT });
  state = executeTransition(state, {
    type: Transition.AWARD_POT,
    potIndex: 0,
    winnerId: 2,
  });

  assert.equal(state.phase, GamePhase.GAME_COMPLETE);
  const winIndex = log.findIndex(({ Type }) => Type === "Win");
  const gameWonIndex = log.findIndex(({ Type }) => Type === "Game Won");
  assert.equal(gameWonIndex, winIndex + 1);
  assert.equal(log[winIndex].Kind, "Event");
  assert.equal(log[gameWonIndex].Kind, "Event");
  assert.ok(Object.hasOwn(log[gameWonIndex], "State"));
  assert.deepEqual(materializeLogState(gameWonIndex), state);
  assert.deepEqual(getAvailableActions(state), []);
  assert.throws(
    () => executeTransition(state, { type: Transition.START_NEXT_HAND }),
    /not allowed/
  );
});

test("big blind mode changes forced bets and first player to act", () => {
  const state = start(game({ useBigBlind: true }));

  assert.equal(state.bigBlindPlayerId, 3);
  assert.equal(state.players[1].roundBet, 5);
  assert.equal(state.players[2].roundBet, 10);
  assert.equal(state.actionPlayerId, 1);
});

test("the big blind retains its option when nobody raises", () => {
  let state = start(game({ useBigBlind: true }));

  state = action(state, Transition.CALL);
  state = action(state, Transition.CALL);

  assert.equal(state.phase, GamePhase.BETTING_PREFLOP);
  assert.equal(state.actionPlayerId, 3);
  assert.ok(
    getAvailableActions(state).some(({ type }) => type === Transition.CHECK)
  );
});

test("pot-limit caps a raise at the size of the pot after calling", () => {
  const state = start(
    game({ useBigBlind: true, bettingLimit: BettingLimit.POT_LIMIT })
  );
  const actions = getAvailableActions(state);

  assert.deepEqual(
    actions.find(({ type }) => type === Transition.BET),
    {
      type: Transition.BET,
      minAdditionalChips: 20,
      maxAdditionalChips: 35,
    }
  );
  assert.equal(
    actions.some(({ type }) => type === Transition.ALL_IN),
    false
  );
  assert.throws(
    () => action(state, Transition.BET, { additionalChips: 36 }),
    /outside the legal range/
  );
});

test("fixed-limit uses the configured bet before and on the flop, then doubles it", () => {
  let state = start(
    game({
      useBigBlind: true,
      bettingLimit: BettingLimit.FIXED_LIMIT,
      fixedLimitBet: 15,
    })
  );
  assert.deepEqual(
    getAvailableActions(state).find(({ type }) => type === Transition.BET),
    {
      type: Transition.BET,
      minAdditionalChips: 25,
      maxAdditionalChips: 25,
    }
  );
  assert.throws(
    () => action(state, Transition.BET, { additionalChips: 24 }),
    /outside the legal range/
  );

  state = action(state, Transition.CALL);
  state = action(state, Transition.CALL);
  state = action(state, Transition.CHECK);
  state = executeTransition(state, { type: Transition.CARDS_DEALT });
  assert.deepEqual(
    getAvailableActions(state).find(({ type }) => type === Transition.BET),
    {
      type: Transition.BET,
      minAdditionalChips: 15,
      maxAdditionalChips: 15,
    }
  );

  state = completeRoundWithChecks(state);
  state = executeTransition(state, { type: Transition.CARDS_DEALT });
  assert.deepEqual(
    getAvailableActions(state).find(({ type }) => type === Transition.BET),
    {
      type: Transition.BET,
      minAdditionalChips: 30,
      maxAdditionalChips: 30,
    }
  );
});

test("a short all-in does not reopen raising for a player who already acted", () => {
  let state = start(game({ chips: [250, 250, 75] }));
  state = completeRoundWithCalls(state);
  state = executeTransition(state, { type: Transition.CARDS_DEALT });

  state = action(state, Transition.BET, { additionalChips: 50 });
  state = action(state, Transition.ALL_IN);
  state = action(state, Transition.CALL);

  assert.equal(state.actionPlayerId, 2);
  assert.deepEqual(getAvailableActions(state), [
    { type: Transition.FOLD },
    { type: Transition.CALL, additionalChips: 20 },
  ]);
  assert.throws(
    () => action(state, Transition.BET, { additionalChips: 70 }),
    /not reopened/
  );
  assert.throws(() => action(state, Transition.ALL_IN), /not reopened/);
});

test("heads-up gives the dealer the small blind and first preflop action", () => {
  const state = start(
    createGameState({
      players: [
        { id: 1, chips: 100 },
        { id: 2, chips: 100 },
      ],
      smallBlind: 5,
      dealerId: 1,
      useBigBlind: true,
    })
  );

  assert.equal(state.smallBlindPlayerId, 1);
  assert.equal(state.bigBlindPlayerId, 2);
  assert.equal(state.actionPlayerId, 1);
});

test("heads-up gives the big blind first action after the flop", () => {
  let state = start(
    createGameState({
      players: [
        { id: 1, chips: 100 },
        { id: 2, chips: 100 },
      ],
      smallBlind: 5,
      dealerId: 1,
      useBigBlind: true,
    })
  );
  state = action(state, Transition.CALL);
  state = action(state, Transition.CHECK);
  state = executeTransition(state, { type: Transition.CARDS_DEALT });

  assert.equal(state.actionPlayerId, state.bigBlindPlayerId);
});

test("heads-up can start with the big blind disabled", () => {
  const state = start(
    createGameState({
      players: [
        { id: 1, chips: 100 },
        { id: 2, chips: 100 },
      ],
      smallBlind: 5,
      dealerId: 1,
      useBigBlind: false,
    })
  );

  assert.equal(state.smallBlindPlayerId, 2);
  assert.equal(state.bigBlindPlayerId, null);
  assert.deepEqual(
    state.players.map((player) => player.chips),
    [100, 95]
  );
  assert.equal(state.actionPlayerId, 1);
});

test("forced blinds that put every player all-in advance directly to the runout", () => {
  let state = createGameState({
    players: [
      { id: 1, chips: 15 },
      { id: 2, chips: 4 },
    ],
    smallBlind: 10,
    dealerId: 2,
    useBigBlind: true,
  });

  state = executeTransition(state, { type: Transition.START_HAND });
  state = executeTransition(state, { type: Transition.CARDS_DEALT });

  assert.equal(state.phase, GamePhase.ALL_IN_RUNOUT);
  assert.equal(state.actionPlayerId, null);
  assert.deepEqual(getAvailableActions(state), [
    { type: Transition.CARDS_DEALT },
  ]);
});

test("a sole player with chips still acts when they owe an all-in call", () => {
  let state = createGameState({
    players: [
      { id: 1, chips: 100 },
      { id: 2, chips: 4 },
      { id: 3, chips: 15 },
    ],
    smallBlind: 10,
    dealerId: 1,
    useBigBlind: true,
  });

  state = executeTransition(state, { type: Transition.START_HAND });
  state = executeTransition(state, { type: Transition.CARDS_DEALT });

  assert.equal(state.phase, GamePhase.BETTING_PREFLOP);
  assert.equal(state.actionPlayerId, 1);
  assert.ok(
    getAvailableActions(state).some(({ type }) => type === Transition.CALL)
  );
});

test("the engine posts an ante from every active player before posting blinds", () => {
  const state = executeTransition(
    createGameState({
      players: [
        { id: 1, chips: 100 },
        { id: 2, chips: 100 },
        { id: 3, chips: 100 },
      ],
      smallBlind: 5,
      ante: 5,
      dealerId: 1,
    }),
    { type: Transition.START_HAND }
  );

  assert.deepEqual(
    state.players.map((player) => player.chips),
    [95, 90, 95]
  );
  assert.deepEqual(
    state.players.map((player) => player.handContribution),
    [5, 10, 5]
  );
  assert.equal(
    state.pots.reduce((total, pot) => total + pot.amount, 0),
    20
  );
});

test("a short blind pays the ante before using their remaining chips for the blind", () => {
  const state = executeTransition(
    createGameState({
      players: [
        { id: 1, chips: 100 },
        { id: 2, chips: 7 },
        { id: 3, chips: 100 },
      ],
      smallBlind: 5,
      ante: 5,
      dealerId: 1,
    }),
    { type: Transition.START_HAND }
  );
  const smallBlind = state.players.find((player) => player.id === 2);

  assert.equal(smallBlind.chips, 0);
  assert.equal(smallBlind.handContribution, 7);
  assert.equal(smallBlind.roundBet, 2);
});

test("an ante puts a short player all-in without making their chips negative", () => {
  const state = executeTransition(
    createGameState({
      players: [
        { id: 1, chips: 3 },
        { id: 2, chips: 100 },
        { id: 3, chips: 100 },
      ],
      smallBlind: 5,
      ante: 5,
      dealerId: 2,
    }),
    { type: Transition.START_HAND }
  );

  assert.equal(state.players.find((player) => player.id === 1).chips, 0);
  assert.equal(
    state.players.find((player) => player.id === 1).handContribution,
    3
  );
  assert.ok(state.players.every((player) => player.chips >= 0));
});

test("eliminated players do not pay an ante on the next hand", () => {
  const state = createGameState({
    players: [
      { id: 1, chips: 0 },
      { id: 2, chips: 100 },
      { id: 3, chips: 100 },
    ],
    smallBlind: 5,
    ante: 5,
    dealerId: 2,
  });
  state.phase = GamePhase.HAND_COMPLETE;
  state.players[0].eliminated = true;
  state.players[0].folded = true;

  const next = executeTransition(state, { type: Transition.START_NEXT_HAND });

  assert.equal(next.players[0].chips, 0);
  assert.equal(next.players[0].handContribution, 0);
});

test("antes create a pot even when the configured small blind is zero", () => {
  const state = executeTransition(
    createGameState({
      players: [
        { id: 1, chips: 100 },
        { id: 2, chips: 100 },
        { id: 3, chips: 100 },
      ],
      smallBlind: 0,
      ante: 5,
      dealerId: 1,
    }),
    { type: Transition.START_HAND }
  );

  assert.equal(
    state.pots.reduce((total, pot) => total + pot.amount, 0),
    15
  );
});

test("fixed-limit stops raising after one bet and three raises", () => {
  let state = start(
    game({
      chips: [500, 500, 500],
      useBigBlind: true,
      bettingLimit: BettingLimit.FIXED_LIMIT,
      fixedLimitBet: 10,
    })
  );
  state = action(state, Transition.CALL);
  state = action(state, Transition.CALL);
  state = action(state, Transition.CHECK);
  state = executeTransition(state, { type: Transition.CARDS_DEALT });

  state = action(state, Transition.BET, { additionalChips: 10 });
  state = action(state, Transition.BET, { additionalChips: 20 });
  state = action(state, Transition.BET, { additionalChips: 30 });
  state = action(state, Transition.BET, { additionalChips: 30 });

  const actions = getAvailableActions(state);
  assert.equal(
    actions.some(({ type }) => type === Transition.BET),
    false
  );
  assert.ok(actions.some(({ type }) => type === Transition.CALL));
  assert.throws(
    () => action(state, Transition.BET, { additionalChips: 30 }),
    /fixed-limit raise cap/
  );
});

test("an odd split-pot chip goes to the first tied winner left of the dealer", () => {
  const state = createDebugGameState(
    game({ chips: [100, 100, 100] }),
    "showdown"
  );
  state.pots[0].amount = 11;
  const before = state.players.map((player) => player.chips);

  const next = executeTransition(state, {
    type: Transition.SPLIT_POT,
    potIndex: 0,
    winnerIds: [3, 2],
  });

  assert.equal(next.players[1].chips - before[1], 6);
  assert.equal(next.players[2].chips - before[2], 5);
});

test("blind increases continue after the original dealer is eliminated", () => {
  let state = game();
  state.phase = GamePhase.HAND_COMPLETE;
  state.dealerId = 3;
  state.players[0].chips = 0;
  state.players[0].folded = true;
  state.players[0].eliminated = true;

  state = executeTransition(state, { type: Transition.START_NEXT_HAND });
  assert.equal(state.dealerId, 2);
  state.phase = GamePhase.HAND_COMPLETE;
  state = executeTransition(state, { type: Transition.START_NEXT_HAND });

  assert.equal(state.dealerId, 3);
  assert.equal(state.smallBlind, 10);
});

test("heads-up dealer rotation wraps safely from the first seat", () => {
  const state = createGameState({
    players: [
      { id: 1, chips: 100 },
      { id: 2, chips: 100 },
      { id: 3, chips: 0 },
    ],
    smallBlind: 5,
    dealerId: 1,
    useBigBlind: true,
  });
  state.phase = GamePhase.HAND_COMPLETE;
  state.players[2].folded = true;
  state.players[2].eliminated = true;

  const next = executeTransition(state, { type: Transition.START_NEXT_HAND });

  assert.equal(next.dealerId, 2);
  assert.equal(next.smallBlindPlayerId, 2);
  assert.equal(next.bigBlindPlayerId, 1);
});

test("reordering seats mid-round skips players whose matched action is complete", () => {
  let state = start(game({ useBigBlind: true }));
  state = action(state, Transition.CALL);
  state.players = [state.players[1], state.players[0], state.players[2]];

  state = action(state, Transition.CALL);

  assert.equal(state.actionPlayerId, 3);
});
