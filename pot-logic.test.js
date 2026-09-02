import assert from "node:assert/strict";
import test from "node:test";
import {
  calculatePots,
  hasBettingRoundFinished,
  maximumAdditionalBet,
  potsForBettingDisplay,
  splitPotAmount,
} from "./pot-logic.js";

function player(
  number,
  handContribution,
  { chips = 0, folded = false, eliminated = false } = {}
) {
  return { number, handContribution, chips, folded, eliminated };
}

test("limits a wager to the amount a heads-up opponent can cover", () => {
  assert.equal(
    maximumAdditionalBet(
      [player(1, 0, { chips: 170 }), player(2, 0, { chips: 120 })],
      1
    ),
    120
  );
});

test("includes chips already contributed when calculating effective stacks", () => {
  assert.equal(
    maximumAdditionalBet(
      [player(1, 5, { chips: 170 }), player(2, 20, { chips: 120 })],
      1
    ),
    135
  );
});

test("uses the richest active opponent and ignores folded stacks", () => {
  assert.equal(
    maximumAdditionalBet(
      [
        player(1, 10, { chips: 200 }),
        player(2, 10, { chips: 40 }),
        player(3, 25, { chips: 75 }),
        player(4, 10, { chips: 500, folded: true }),
      ],
      1
    ),
    90
  );
});

test("keeps unequal active bets in one pot when nobody is all-in", () => {
  assert.deepEqual(
    calculatePots([player(1, 15, { chips: 85 }), player(2, 5, { chips: 95 })]),
    [{ amount: 20, contributionCap: 15, eligiblePlayerNumbers: [1, 2] }]
  );
});

test("creates the correct main pot and one side pot", () => {
  assert.deepEqual(
    calculatePots([player(1, 15), player(2, 20), player(3, 20)]),
    [
      { amount: 45, contributionCap: 15, eligiblePlayerNumbers: [1, 2, 3] },
      { amount: 10, contributionCap: 20, eligiblePlayerNumbers: [2, 3] },
    ]
  );
});

test("creates an arbitrary number of side-pot layers", () => {
  assert.deepEqual(
    calculatePots([player(1, 5), player(2, 10), player(3, 15), player(4, 20)]),
    [
      { amount: 20, contributionCap: 5, eligiblePlayerNumbers: [1, 2, 3, 4] },
      { amount: 15, contributionCap: 10, eligiblePlayerNumbers: [2, 3, 4] },
      { amount: 10, contributionCap: 15, eligiblePlayerNumbers: [3, 4] },
      { amount: 5, contributionCap: 20, eligiblePlayerNumbers: [4] },
    ]
  );
});

test("does not display a one-player uncalled layer as a side pot during betting", () => {
  assert.deepEqual(
    potsForBettingDisplay([
      { amount: 10, contributionCap: 5, eligiblePlayerNumbers: [1, 2] },
      { amount: 245, contributionCap: 250, eligiblePlayerNumbers: [1] },
    ]),
    [{ amount: 255, contributionCap: 250, eligiblePlayerNumbers: [1, 2] }]
  );
});

test("continues to display a real side pot with multiple eligible players", () => {
  const pots = [
    { amount: 45, contributionCap: 15, eligiblePlayerNumbers: [1, 2, 3] },
    { amount: 10, contributionCap: 20, eligiblePlayerNumbers: [2, 3] },
  ];

  assert.deepEqual(potsForBettingDisplay(pots), pots);
});

test("counts folded chips but removes the folded player from eligibility", () => {
  assert.deepEqual(
    calculatePots([
      player(1, 5, { folded: true }),
      player(2, 15),
      player(3, 20),
      player(4, 20),
    ]),
    [
      { amount: 50, contributionCap: 15, eligiblePlayerNumbers: [2, 3, 4] },
      { amount: 10, contributionCap: 20, eligiblePlayerNumbers: [3, 4] },
    ]
  );
});

test("merges a folded-only contribution layer into the preceding eligible pot", () => {
  assert.deepEqual(
    calculatePots([
      player(1, 3),
      player(2, 13),
      player(3, 23, { chips: 10, folded: true }),
      player(4, 23, { chips: 10, folded: true }),
    ]),
    [
      { amount: 12, contributionCap: 3, eligiblePlayerNumbers: [1, 2] },
      { amount: 50, contributionCap: 23, eligiblePlayerNumbers: [2] },
    ]
  );
});

test("preserves every chip across all distinct contribution levels", () => {
  const players = Array.from({ length: 8 }, (_, index) =>
    player(index + 1, index + 1)
  );
  const pots = calculatePots(players);

  assert.equal(pots.length, 8);
  assert.equal(
    pots.reduce((total, potLayer) => total + potLayer.amount, 0),
    36
  );
});

test("finishes a betting round when every remaining player is all-in", () => {
  assert.equal(
    hasBettingRoundFinished(
      [
        {
          chips: 0,
          folded: false,
          eliminated: false,
          hasActedThisRound: true,
          roundBet: 5,
        },
        {
          chips: 0,
          folded: false,
          eliminated: false,
          hasActedThisRound: true,
          roundBet: 10,
        },
      ],
      10
    ),
    true
  );
});

test("does not finish while the sole player with chips still owes a call", () => {
  assert.equal(
    hasBettingRoundFinished(
      [
        {
          chips: 5,
          folded: false,
          eliminated: false,
          hasActedThisRound: true,
          roundBet: 10,
        },
        {
          chips: 0,
          folded: false,
          eliminated: false,
          hasActedThisRound: true,
          roundBet: 15,
        },
      ],
      15
    ),
    false
  );
});

test("splits a pot evenly and awards odd chips in the supplied table order", () => {
  assert.deepEqual(splitPotAmount(11, [3, 1, 2]), [
    { number: 3, amount: 4 },
    { number: 1, amount: 4 },
    { number: 2, amount: 3 },
  ]);
});

test("does not duplicate a winner when splitting a pot", () => {
  assert.deepEqual(splitPotAmount(10, [2, 2, 3]), [
    { number: 2, amount: 5 },
    { number: 3, amount: 5 },
  ]);
});
