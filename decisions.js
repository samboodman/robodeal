import config from './Questions.json' with { type: 'json' };
import { Transition } from './game-state.js';

export const DECISIONS_MODEL = config.model;

// The user's three names for the three Decisions question types.
export const DecisionQuestionType = Object.freeze({
  MULTIPLE_CHOICE: 'choice',
  QBIT_ANSWER: 'predicate',
  WEIRD_ANSWER: 'score',
});

const actionConfig = config.action;
const raiseTargetConfig = config.raiseTarget;
const winnerConfig = config.winner;
const amountConfig = config.amount;
const valuesConfig = config.values;

// The bounded set of things the current player can want to do.
export const PokerDecision = Object.freeze({
  CHECK: actionConfig.fromTransition[Transition.CHECK],
  CALL: actionConfig.fromTransition[Transition.CALL],
  BET: actionConfig.fromTransition[Transition.BET],
  RAISE: actionConfig.raiseChoice,
  FOLD: actionConfig.fromTransition[Transition.FOLD],
  ALL_IN: actionConfig.fromTransition[Transition.ALL_IN],
  CARDS_DEALT: actionConfig.fromTransition[Transition.CARDS_DEALT],
  UNDO: actionConfig.undoChoice,
  NEXT_HAND: actionConfig.fromTransition[Transition.START_NEXT_HAND],
  PICK_WINNER: actionConfig.pickWinnerChoice,
  NARRATE_VALUES: actionConfig.narrateValuesChoice,
  NOTHING: actionConfig.nothingChoice,
});

export const RaiseTarget = Object.freeze({
  RAISE_TO: raiseTargetConfig.toChoice,
  RAISE_BY: raiseTargetConfig.byChoice,
});

function fillTemplate(template, values) {
  return String(template).replace(/\{(\w+)\}/g, (placeholder, key) => (
    Object.hasOwn(values, key) ? String(values[key]) : placeholder
  ));
}

function normalizeChoices(choices) {
  if (Array.isArray(choices)) {
    return choices.map((choice) => (typeof choice === 'string'
      ? { value: choice }
      : { value: choice.value, description: choice.description }));
  }
  return Object.entries(choices).map(([value, meta]) => (
    meta && meta.description ? { value, description: meta.description } : { value }
  ));
}

export function narrationContent(facts) {
  return `${config.narrationPrefix} ${JSON.stringify(facts)}`;
}

export function multipleChoiceQuestion({ name, instructions, choices }) {
  return {
    type: DecisionQuestionType.MULTIPLE_CHOICE,
    name,
    instructions,
    choices: normalizeChoices(choices),
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
  return config.placeNames[place] || String(place);
}

export function placeValuesUpTo(maxAmount) {
  const limit = Math.max(0, Math.floor(Number(maxAmount) || 0));
  const places = [];
  for (let place = 1; place <= limit; place *= 10) places.push(place);
  return places.length > 0 ? places : [1];
}

export function amountDigitQuestionName(field, place) {
  return fillTemplate(amountConfig.questionName, { field, place });
}

export function amountDigitQuestions({ places, field = amountConfig.field }) {
  return places.map((place) => multipleChoiceQuestion({
    name: amountDigitQuestionName(field, place),
    instructions: fillTemplate(amountConfig.instructions, { field, place: placeValueName(place) }),
    choices: amountConfig.choices,
  }));
}

export function legalActionChoices(snapshot) {
  const choices = (snapshot?.availableActions || [])
    .map((action) => actionConfig.fromTransition[action.type])
    .filter(Boolean);
  if (snapshot?.canUndo) choices.push(actionConfig.undoChoice);
  if (snapshot?.showdown) choices.push(actionConfig.pickWinnerChoice);
  choices.push(actionConfig.narrateValuesChoice, actionConfig.nothingChoice);
  return [...new Set(choices)];
}

export function actionChoiceQuestion({ snapshot }) {
  const allowed = legalActionChoices(snapshot);
  const choices = Object.fromEntries(allowed.map((value) => [value, actionConfig.choices[value] || {}]));
  return multipleChoiceQuestion({
    name: actionConfig.name,
    instructions: actionConfig.instructions,
    choices,
  });
}

export function raiseTargetQuestion() {
  return multipleChoiceQuestion({
    name: raiseTargetConfig.name,
    instructions: raiseTargetConfig.instructions,
    choices: raiseTargetConfig.choices,
  });
}

export function buildPokerDecisionQuestions({ snapshot, maxAmount, field = amountConfig.field }) {
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
  field = amountConfig.field,
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

export function digitAnswersByPlace(decision, places, field = amountConfig.field) {
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
  return actionConfig.amountChoices.includes(action);
}

export function readPokerDecision(decision, { places, field = amountConfig.field }) {
  const action = choiceFor(decision, actionConfig.name);
  const raiseTarget = choiceFor(decision, raiseTargetConfig.name);
  const digits = digitAnswersByPlace(decision, places, field);
  return {
    action,
    raiseTarget,
    amount: decisionNeedsAmount(action) ? digitsToNumber(digits) : null,
    digits,
  };
}

function fillReportable(spec, context) {
  return {
    kind: spec.kind,
    name: fillTemplate(spec.name, context),
    label: fillTemplate(spec.label, context),
    context,
  };
}

export function reportableValues(snapshot) {
  const entries = [];
  valuesConfig.reportable.forEach((spec) => {
    if (spec.from === 'players') {
      (snapshot?.players || []).forEach((player) => {
        entries.push(fillReportable(spec, {
          number: player.number,
          name: player.name,
          chips: player.chips,
          roundBet: player.roundBet,
        }));
      });
    } else if (spec.from === 'sidePots') {
      (snapshot?.sidePotAmounts || []).forEach((amount, index) => {
        entries.push(fillReportable(spec, { index: index + 1, amount }));
      });
    } else {
      entries.push(fillReportable(spec, {}));
    }
  });
  return entries;
}

export function valueQuestionsFor(snapshot) {
  return reportableValues(snapshot).map((entry) => multipleChoiceQuestion({
    name: fillTemplate(valuesConfig.questionName, { name: entry.name }),
    instructions: fillTemplate(valuesConfig.instructions, { label: entry.label }),
    choices: valuesConfig.choices,
  }));
}

function valueForKind(entry, snapshot) {
  switch (entry.kind) {
    case 'pot': return snapshot?.pot ?? null;
    case 'playerCount': return (snapshot?.players || []).length;
    case 'currentPlayer': return snapshot?.currentPlayer?.name ?? null;
    case 'round': return snapshot?.round ?? null;
    case 'dealer': return snapshot?.game?.dealer?.name ?? null;
    case 'smallBlind': return snapshot?.game?.smallBlind ?? null;
    case 'bigBlind': return snapshot?.game?.bigBlind?.amount ?? null;
    case 'ante': return snapshot?.game?.ante?.amount ?? null;
    case 'sidePotCount': return (snapshot?.sidePotAmounts || []).length;
    case 'nonEliminatedPlayerCount': return (snapshot?.players || []).filter((player) => !player.eliminated).length;
    case 'inHandPlayerCount': return (snapshot?.players || []).filter((player) => !player.folded && !player.eliminated).length;
    case 'amountToCall': return snapshot?.currentPlayer?.amountToCall ?? 0;
    case 'nonEliminatedPlayerCount': return (snapshot?.players || []).filter((player) => !player.eliminated).length;
    case 'inHandPlayerCount': return (snapshot?.players || []).filter((player) => !player.folded && !player.eliminated).length;
    case 'amountToCall': return snapshot?.currentPlayer?.amountToCall ?? 0;
    case 'playerChips': return { name: entry.context.name, chips: entry.context.chips };
    case 'playerRoundBet': return { name: entry.context.name, round_bet: entry.context.roundBet };
    case 'sidePotAmount': return entry.context.amount ?? null;
    default: return null;
  }
}

export function valueFactsFor(snapshot) {
  const facts = {};
  reportableValues(snapshot).forEach((entry) => {
    facts[entry.name] = valueForKind(entry, snapshot);
  });
  return facts;
}

export function selectedValueFacts(decision, snapshot) {
  const facts = valueFactsFor(snapshot);
  const selected = {};
  reportableValues(snapshot).forEach((entry) => {
    const questionName = fillTemplate(valuesConfig.questionName, { name: entry.name });
    if (choiceFor(decision, questionName) === valuesConfig.yesChoice) selected[entry.name] = facts[entry.name];
  });
  return selected;
}

export function winnerQuestions(snapshot) {
  const eligible = snapshot?.showdown?.eligiblePlayers || [];
  return eligible.map((player) => multipleChoiceQuestion({
    name: fillTemplate(winnerConfig.questionName, { number: player.number, name: player.name }),
    instructions: fillTemplate(winnerConfig.instructions, { name: player.name, number: player.number }),
    choices: winnerConfig.choices,
  }));
}

export function winnersFromDecision(decision, snapshot) {
  const eligible = snapshot?.showdown?.eligiblePlayers || [];
  return eligible.filter((player) => (
    choiceFor(decision, fillTemplate(winnerConfig.questionName, { number: player.number, name: player.name }))
      === winnerConfig.yesChoice
  ));
}
