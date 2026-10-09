import { Transition } from './game-state.js';

export const DECISIONS_MODEL = 'gpt-6-luna';

// The user's three names for the three Decisions question types.
export const DecisionQuestionType = Object.freeze({
  MULTIPLE_CHOICE: 'choice',
  QBIT_ANSWER: 'predicate',
  WEIRD_ANSWER: 'score',
});

// The bounded set of things the current player can want to do.
export const PokerDecision = Object.freeze({
  CHECK: 'check',
  CALL: 'call',
  BET: 'bet',
  RAISE: 'raise',
  FOLD: 'fold',
  ALL_IN: 'allIn',
  CARDS_DEALT: 'cardsDealt',
  UNDO: 'undo',
  NEXT_HAND: 'nextHand',
  NARRATE_VALUES: 'narrateValues',
  NOTHING: 'nothing',
});

export const RaiseTarget = Object.freeze({
  RAISE_TO: 'raiseTo',
  RAISE_BY: 'raiseBy',
});

const decisionForTransition = Object.freeze({
  [Transition.CHECK]: PokerDecision.CHECK,
  [Transition.CALL]: PokerDecision.CALL,
  [Transition.BET]: PokerDecision.BET,
  [Transition.FOLD]: PokerDecision.FOLD,
  [Transition.ALL_IN]: PokerDecision.ALL_IN,
  [Transition.CARDS_DEALT]: PokerDecision.CARDS_DEALT,
  [Transition.START_NEXT_HAND]: PokerDecision.NEXT_HAND,
});

const decisionsThatNeedAmount = Object.freeze([PokerDecision.BET, PokerDecision.RAISE]);

const placeNames = Object.freeze({
  1: 'ones',
  10: 'tens',
  100: 'hundreds',
  1000: 'thousands',
  10000: 'ten thousands',
  100000: 'hundred thousands',
  1000000: 'millions',
  10000000: 'ten millions',
  100000000: 'hundred millions',
  1000000000: 'billions',
});

export const DIGIT_CHOICES = Object.freeze(['0', '1', '2', '3', '4', '5', '6', '7', '8', '9']);

export const NARRATION_PREFIX = 'DEALER FACTS:';

export function narrationContent(facts) {
  return `${NARRATION_PREFIX} ${JSON.stringify(facts)}`;
}

export function multipleChoiceQuestion({ name, instructions, choices }) {
  return {
    type: DecisionQuestionType.MULTIPLE_CHOICE,
    name,
    instructions,
    choices: choices.map((choice) => (typeof choice === 'string'
      ? { value: choice }
      : { value: choice.value, description: choice.description })),
  };
}

export function qbitAnswerQuestion({ name, instructions }) {
  return {
    type: DecisionQuestionType.QBIT_ANSWER,
    name,
    instructions,
  };
}

export function weirdAnswerQuestion({ name, instructions, levels }) {
  return {
    type: DecisionQuestionType.WEIRD_ANSWER,
    name,
    instructions,
    levels,
  };
}

export function placeValueName(place) {
  return placeNames[place] || String(place);
}

export function placeValuesUpTo(maxAmount) {
  const limit = Math.max(0, Math.floor(Number(maxAmount) || 0));
  const places = [];
  for (let place = 1; place <= limit; place *= 10) places.push(place);
  return places.length > 0 ? places : [1];
}

export function amountDigitQuestionName(field, place) {
  return `${field}_digit_${place}`;
}

export function amountDigitQuestions({ places, field = 'amount' }) {
  return places.map((place) => multipleChoiceQuestion({
    name: amountDigitQuestionName(field, place),
    instructions: `In the ${field} the user stated, what digit is in the ${placeValueName(place)} place?`,
    choices: DIGIT_CHOICES,
  }));
}

export function legalActionChoices(snapshot) {
  const choices = (snapshot?.availableActions || [])
    .map((action) => decisionForTransition[action.type])
    .filter(Boolean);
  if (snapshot?.canUndo) choices.push(PokerDecision.UNDO);
  choices.push(PokerDecision.NARRATE_VALUES, PokerDecision.NOTHING);
  return [...new Set(choices)];
}

export function actionChoiceQuestion({ snapshot }) {
  return multipleChoiceQuestion({
    name: 'action',
    instructions: 'What does the current player want to do? Choose narrateValues when they ask about the state of the game. Choose nextHand to deal the next hand after a hand has finished. Choose undo only for a clear request to undo the last confirmed turn. Choose nothing for background chatter or unclear speech.',
    choices: legalActionChoices(snapshot),
  });
}

export function raiseTargetQuestion() {
  return multipleChoiceQuestion({
    name: 'raise_target',
    instructions: 'If the player is raising or betting, did they mean a total for the round (raiseTo) or an amount on top of the call (raiseBy)?',
    choices: [RaiseTarget.RAISE_TO, RaiseTarget.RAISE_BY],
  });
}

export function buildPokerDecisionQuestions({ snapshot, maxAmount, field = 'amount' }) {
  return [
    actionChoiceQuestion({ snapshot }),
    raiseTargetQuestion(),
    ...amountDigitQuestions({ places: placeValuesUpTo(maxAmount), field }),
  ];
}

export function buildDecisionInput({ instructions, gameState, transcript }) {
  return [
    instructions,
    '',
    'Current game state:',
    JSON.stringify(gameState),
    '',
    'What the user said:',
    String(transcript || '').trim(),
  ].join('\n');
}

export function buildDecisionRequest({ input, questions }) {
  return {
    model: DECISIONS_MODEL,
    input,
    questions,
  };
}

export function buildPokerDecisionRequest({
  instructions,
  gameState,
  transcript,
  maxAmount,
  field = 'amount',
}) {
  return buildDecisionRequest({
    input: buildDecisionInput({ instructions, gameState, transcript }),
    questions: buildPokerDecisionQuestions({ snapshot: gameState, maxAmount, field }),
  });
}

export function answerNamed(decision, name) {
  return (decision?.answers || []).find((answer) => answer.name === name) || null;
}

export function choiceFor(decision, name) {
  const answer = answerNamed(decision, name);
  return answer?.type === DecisionQuestionType.MULTIPLE_CHOICE ? answer.choice : null;
}

export function probabilityFor(decision, name) {
  const answer = answerNamed(decision, name);
  return answer?.type === DecisionQuestionType.QBIT_ANSWER ? answer.probability : null;
}

export function scoreFor(decision, name) {
  const answer = answerNamed(decision, name);
  return answer?.type === DecisionQuestionType.WEIRD_ANSWER ? answer.score : null;
}

export function digitAnswersByPlace(decision, places, field = 'amount') {
  return Object.fromEntries(places.map((place) => [
    place,
    choiceFor(decision, amountDigitQuestionName(field, place)),
  ]));
}

export function digitsToNumber(digits) {
  let output = '';
  Object.keys(digits)
    .map(Number)
    .sort((first, second) => first - second)
    .forEach((place) => {
      const digit = digits[place];
      output = (Number.isFinite(Number(digit)) ? String(Math.trunc(Number(digit))) : '0') + output;
    });
  return Number(output);
}

export function decisionNeedsAmount(action) {
  return decisionsThatNeedAmount.includes(action);
}

export function readPokerDecision(decision, { places, field = 'amount' }) {
  const action = choiceFor(decision, 'action');
  const raiseTarget = choiceFor(decision, 'raise_target');
  const digits = digitAnswersByPlace(decision, places, field);
  return {
    action,
    raiseTarget,
    amount: decisionNeedsAmount(action) ? digitsToNumber(digits) : null,
    digits,
  };
}

const YES_NO_CHOICES = Object.freeze([{ value: 'yes' }, { value: 'no' }]);

export function reportableValues(snapshot) {
  const values = [
    { name: 'pot', label: 'the total pot' },
    { name: 'player_count', label: 'how many players are at the table' },
    { name: 'current_player', label: 'whose turn it is' },
    { name: 'round', label: 'the current betting round' },
    { name: 'dealer', label: 'who the dealer is' },
    { name: 'small_blind', label: 'the small blind amount' },
    { name: 'big_blind', label: 'the big blind amount' },
    { name: 'ante', label: 'the ante amount' },
    { name: 'side_pot_count', label: 'how many side pots there are' },
  ];
  (snapshot?.players || []).forEach((player) => {
    values.push({ name: `player_${player.number}_chips`, label: `how many chips ${player.name} has` });
    values.push({ name: `player_${player.number}_round_bet`, label: `how much ${player.name} has bet this round` });
  });
  (snapshot?.sidePotAmounts || []).forEach((amount, index) => {
    values.push({ name: `side_pot_${index + 1}`, label: `the amount in side pot ${index + 1}` });
  });
  return values;
}

export function valueQuestionsFor(snapshot) {
  return reportableValues(snapshot).map(({ name, label }) => multipleChoiceQuestion({
    name: `value_${name}`,
    instructions: `Does the user want to know ${label}?`,
    choices: YES_NO_CHOICES,
  }));
}

export function valueFactsFor(snapshot) {
  const facts = {
    pot: snapshot?.pot ?? null,
    player_count: (snapshot?.players || []).length,
    current_player: snapshot?.currentPlayer?.name ?? null,
    round: snapshot?.round ?? null,
    dealer: snapshot?.game?.dealer?.name ?? null,
    small_blind: snapshot?.game?.smallBlind ?? null,
    big_blind: snapshot?.game?.bigBlind?.amount ?? null,
    ante: snapshot?.game?.ante?.amount ?? null,
    side_pot_count: (snapshot?.sidePotAmounts || []).length,
  };
  (snapshot?.players || []).forEach((player) => {
    facts[`player_${player.number}_chips`] = { name: player.name, chips: player.chips };
    facts[`player_${player.number}_round_bet`] = { name: player.name, round_bet: player.roundBet };
  });
  (snapshot?.sidePotAmounts || []).forEach((amount, index) => {
    facts[`side_pot_${index + 1}`] = amount;
  });
  return facts;
}

export function selectedValueFacts(decision, snapshot) {
  const facts = valueFactsFor(snapshot);
  const selected = {};
  reportableValues(snapshot).forEach(({ name }) => {
    if (choiceFor(decision, `value_${name}`) === 'yes') selected[name] = facts[name];
  });
  return selected;
}
