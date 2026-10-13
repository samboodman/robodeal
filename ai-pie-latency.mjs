#!/usr/bin/env node
// Runs the real microphone → GPT-Live → Decisions → game → GPT-Live path and
// prints non-overlapping slices suitable for a pie chart. It delegates browser
// setup, recorded speech, and the actual remote API calls to ai-human-latency.
import { execFile } from 'node:child_process';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';

const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));

function argsForRunner(argv) {
  return argv.filter((arg) => (
    arg === '--json'
    || arg.startsWith('--url=')
    || arg.startsWith('--port=')
    || arg.startsWith('--repeats=')
    || arg.startsWith('--timeout=')
    || arg.startsWith('--only=')
  ));
}

function milliseconds(value) {
  return Number.isFinite(value) ? Math.max(0, value) : null;
}

function sliceTurn(turn) {
  const markers = turn.markers || {};
  const stages = markers.stages || {};
  const lastSound = markers.lastSoundAt;
  const gameApplied = stages.gameActionApplied ?? markers.gameStateChangedAt;
  const outputSound = markers.outputSoundAt ?? markers.responseSpeakingAt;
  const e2eSlices = {
    'Voice to text': milliseconds(stages.delegationReceived - lastSound),
    'Text to decisions': milliseconds(stages.decisionReady - stages.delegationFlushed),
    Code: milliseconds(gameApplied - stages.decisionReady),
    'Decisions to voice': milliseconds(outputSound - gameApplied),
  };
  const realNetworkRoundTripMs = milliseconds(markers.telemetry?.serverMs);
  // This is the requested chart form. Ping overlaps speech recognition when
  // speculative Decisions work starts early, so its sum is not wall-clock E2E.
  const pieSlices = { Ping: realNetworkRoundTripMs, ...e2eSlices };
  const usable = Object.values(e2eSlices).every(Number.isFinite);
  return {
    fixture: turn.fixture,
    pieSlicesMs: pieSlices,
    e2eSlicesMs: e2eSlices,
    e2eTotalMs: usable ? Object.values(e2eSlices).reduce((total, value) => total + value, 0) : null,
    // Real browser → app server → Decisions API → browser round trip.
    realNetworkRoundTripMs,
  };
}

function median(values) {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function summary(turns) {
  const labels = ['Ping', 'Voice to text', 'Text to decisions', 'Code', 'Decisions to voice'];
  return Object.fromEntries(labels.map((label) => [
    label,
    median(turns.map((turn) => turn.pieSlicesMs[label])),
  ]));
}

async function main() {
  const argv = process.argv.slice(2);
  if (argv.includes('--help') || argv.includes('-h')) {
    console.log('Usage: node ai-pie-latency.mjs [--url=http://host/] [--repeats=3] [--only=call] [--timeout=30000] [--json]');
    return;
  }

  const runnerArgs = ['ai-human-latency.mjs', ...argsForRunner(argv.filter((arg) => arg !== '--json')), '--json'];
  const { stdout } = await run(process.execPath, runnerArgs, { cwd: here, maxBuffer: 2 * 1024 * 1024 });
  const raw = JSON.parse(stdout);
  const turns = raw.turns.map(sliceTurn);
  const result = {
    source: 'real end-to-end recorded-speech run',
    url: raw.url,
    turns,
    medianPieSlicesMs: summary(turns),
    note: 'Ping is the real Decisions request round trip. It can overlap Voice to text because Decisions speculation begins before speech ends; use e2eSlicesMs when the slices must sum to wall-clock end-to-end time.',
  };
  if (argv.includes('--json')) {
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  console.log('Pie-chart slices (ms, medians):');
  for (const [label, value] of Object.entries(result.medianPieSlicesMs)) console.log(`  ${label}: ${value === null ? '—' : value.toFixed(1)}`);
  console.log('Ping overlaps voice-to-text when speculative Decisions work starts early.');
}

main().catch((error) => {
  console.error(`[ai-pie-latency] ${error.message || error}`);
  process.exit(1);
});
