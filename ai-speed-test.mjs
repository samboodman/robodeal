#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const folderName = basename(scriptDir);

function parseEnv(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    values[key] = value;
  }
  return values;
}

function loadEnv() {
  const preexisting = { ...process.env };
  const merged = {};
  for (const file of ['.env', '.env.local']) {
    const path = join(scriptDir, file);
    if (existsSync(path)) Object.assign(merged, parseEnv(readFileSync(path, 'utf8')));
  }
  for (const [key, value] of Object.entries(merged)) {
    if (!(key in preexisting)) process.env[key] = value;
  }
}

function readArgs(argv) {
  const options = { runs: 5, warmups: 1, transcript: "I'll call.", json: false, help: false };
  for (const arg of argv) {
    if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--runs=')) options.runs = Math.max(1, Math.floor(Number(arg.split('=')[1])) || options.runs);
    else if (arg.startsWith('--warmups=')) options.warmups = Math.max(0, Math.floor(Number(arg.split('=')[1])) || 0);
    else if (arg.startsWith('--transcript=')) options.transcript = arg.slice('--transcript='.length);
  }
  return options;
}

function summarize(samples) {
  const sorted = [...samples].sort((first, second) => first - second);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const at = (fraction) => sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
  return {
    count: sorted.length,
    min: sorted[0],
    median: sorted.length % 2
      ? sorted[(sorted.length - 1) / 2]
      : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2,
    mean: total / sorted.length,
    p95: at(0.95),
    max: sorted.at(-1),
  };
}

const ms = (value) => `${value.toFixed(0)} ms`;

function buildSnapshot(Transition, maxAmount) {
  return {
    pot: 150,
    round: 'flop',
    currentPlayer: { name: 'RoboDeal', amountToCall: 20, chips: maxAmount, roundBet: 0 },
    canUndo: false,
    showdown: null,
    sidePotAmounts: [],
    availableActions: [
      { type: Transition.FOLD },
      { type: Transition.CALL, additionalChips: 20 },
      { type: Transition.BET, minAdditionalChips: 40, maxAdditionalChips: maxAmount },
      { type: Transition.ALL_IN, additionalChips: maxAmount },
    ],
    players: [
      { name: 'You', number: 0, chips: 960, roundBet: 20, folded: false, eliminated: false },
      { name: 'RoboDeal', number: 1, chips: maxAmount, roundBet: 0, folded: false, eliminated: false },
      { name: 'Alex', number: 2, chips: 900, roundBet: 20, folded: false, eliminated: false },
    ],
    game: {
      dealer: { name: 'Alex' },
      smallBlind: 10,
      bigBlind: { amount: 20 },
      ante: { amount: 0 },
    },
  };
}

const options = readArgs(process.argv.slice(2));

if (options.help) {
  console.log('Usage: node ai-speed-test.mjs [--runs=5] [--warmups=1] [--transcript="..."] [--json]');
  process.exit(0);
}

loadEnv();

const { createDecisionsResponse } = await import('./openai-api.js');
const { buildPokerDecisionRequest, DECISIONS_MODEL } = await import('./decisions.js');
const { Transition } = await import('./game-state.js');
const prompts = JSON.parse(readFileSync(new URL('./Prompts.json', import.meta.url), 'utf8'));

const maxAmount = 980;
const request = buildPokerDecisionRequest({
  instructions: prompts.decisionsInstructions,
  gameState: buildSnapshot(Transition, maxAmount),
  transcript: options.transcript,
  maxAmount,
});

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error(`[ai-speed] ${folderName}: OPENAI_API_KEY is not set. Add it to .env.local in ${scriptDir}.`);
  process.exit(1);
}

async function timedCall() {
  const started = performance.now();
  const decision = await createDecisionsResponse(apiKey, request);
  return { duration: performance.now() - started, decision };
}

async function main() {
  if (!options.json) {
    console.log(`AI speed test — ${folderName}`);
    console.log(`Model: ${DECISIONS_MODEL} | Questions: ${request.questions.length} | Input: ${request.input.length} chars`);
    console.log(`Runs: ${options.runs} (+${options.warmups} warmup) | Transcript: ${JSON.stringify(options.transcript)}`);
    console.log('');
  }

  for (let index = 0; index < options.warmups; index += 1) {
    const { duration } = await timedCall();
    if (!options.json) console.log(`  warmup ${index + 1}: ${ms(duration)}`);
  }

  const samples = [];
  for (let index = 0; index < options.runs; index += 1) {
    const { duration } = await timedCall();
    samples.push(duration);
    if (!options.json) console.log(`  run ${index + 1}: ${ms(duration)}`);
  }

  const results = summarize(samples);

  if (options.json) {
    console.log(JSON.stringify({
      folder: folderName,
      model: DECISIONS_MODEL,
      transcript: options.transcript,
      samples,
      results,
    }, null, 2));
    return;
  }

  console.log('');
  console.log(`Results (${results.count} runs): min ${ms(results.min)} | median ${ms(results.median)} | mean ${ms(results.mean)} | p95 ${ms(results.p95)} | max ${ms(results.max)}`);
}

main().catch((error) => {
  console.error(`[ai-speed] ${folderName}: ${error.message || error}`);
  process.exit(1);
});
