#!/usr/bin/env node
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const folderName = basename(scriptDir);
const fixturesDir = join(scriptDir, 'voice-fixtures');
const REALTIME_MODEL = 'gpt-realtime';
const TRANSCRIPTION_MODEL = 'gpt-4o-mini-transcribe';

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
  const options = { repeats: 1, model: REALTIME_MODEL, json: false, help: false };
  for (const arg of argv) {
    if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--repeats=')) options.repeats = Math.max(1, Math.floor(Number(arg.split('=')[1])) || options.repeats);
    else if (arg.startsWith('--model=')) options.model = arg.slice('--model='.length);
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

const ms = (value) => (value == null ? '—' : `${value.toFixed(0)} ms`);

const ACTION_TOOL = {
  type: 'function',
  name: 'poker_action',
  description: 'Record the poker action the player spoke.',
  parameters: {
    type: 'object',
    properties: {
      action: { type: 'string', enum: ['fold', 'check', 'call', 'raise', 'all_in'] },
      amount: { type: 'number' },
    },
    required: ['action'],
  },
};

const INSTRUCTIONS = 'You are a poker dealer listening to a player. When they speak a poker action, immediately call poker_action with what they said. Never speak.';

const SESSION_UPDATE = {
  type: 'session.update',
  session: {
    type: 'realtime',
    instructions: INSTRUCTIONS,
    tools: [ACTION_TOOL],
    tool_choice: 'required',
    output_modalities: ['text'],
    audio: {
      input: {
        transcription: { model: TRANSCRIPTION_MODEL },
        turn_detection: null,
      },
    },
  },
};

function connect(apiKey, model) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket(`wss://api.openai.com/v1/realtime?model=${encodeURIComponent(model)}`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    });
    const listeners = new Set();
    ws.onmessage = (event) => {
      let parsed;
      try { parsed = JSON.parse(String(event.data)); } catch { return; }
      for (const listener of [...listeners]) listener(parsed);
    };
    ws.onerror = (event) => reject(new Error(event.message || 'WebSocket error'));

    const on = (listener) => listeners.add(listener);
    const off = (listener) => listeners.delete(listener);
    const send = (value) => ws.send(JSON.stringify(value));

    const settle = (event) => {
      if (event.type === 'session.created') {
        send(SESSION_UPDATE);
      } else if (event.type === 'session.updated') {
        off(settle);
        resolve({ send, on, off, close: () => ws.close() });
      } else if (event.type === 'error') {
        off(settle);
        reject(new Error(event.error?.message || 'session error'));
      }
    };
    on(settle);
    setTimeout(() => reject(new Error('timed out creating session')), 15000);
  });
}

function runTurn(client, audio) {
  return new Promise((resolve, reject) => {
    let commitAt = 0;
    let actionMs = null;
    let sttMs = null;
    let transcript = null;
    let action = null;
    let args = null;

    const done = (result) => {
      client.off(handler);
      resolve(result);
    };
    const fail = (error) => {
      client.off(handler);
      reject(error);
    };
    const handler = (event) => {
      if (event.type === 'conversation.item.input_audio_transcription.completed') {
        sttMs = performance.now() - commitAt;
        transcript = event.transcript;
      } else if (event.type === 'response.function_call_arguments.done') {
        actionMs = performance.now() - commitAt;
        action = event.name;
        try { args = JSON.parse(event.arguments); } catch { args = event.arguments; }
      } else if (event.type === 'response.done') {
        done({ actionMs, sttMs, transcript, action, args });
      } else if (event.type === 'error') {
        fail(new Error(event.error?.message || 'turn error'));
      }
    };
    client.on(handler);

    const base64 = audio.toString('base64');
    for (let index = 0; index < base64.length; index += 24000) {
      client.send({ type: 'input_audio_buffer.append', audio: base64.slice(index, index + 24000) });
    }
    commitAt = performance.now();
    client.send({ type: 'input_audio_buffer.commit' });
    client.send({ type: 'response.create', response: { output_modalities: ['text'] } });

    setTimeout(() => fail(new Error('timed out waiting for action')), 30000);
  });
}

const options = readArgs(process.argv.slice(2));

if (options.help) {
  console.log('Usage: node ai-voice-speed-test.mjs [--repeats=1] [--model=gpt-realtime] [--json]');
  process.exit(0);
}

loadEnv();

if (!existsSync(fixturesDir)) {
  console.error(`[ai-voice-speed] ${folderName}: no voice-fixtures/ folder with .pcm clips.`);
  process.exit(1);
}
const fixtures = readdirSync(fixturesDir).filter((name) => name.endsWith('.pcm')).sort();
if (fixtures.length === 0) {
  console.error(`[ai-voice-speed] ${folderName}: voice-fixtures/ has no .pcm clips.`);
  process.exit(1);
}

const apiKey = process.env.OPENAI_API_KEY;
if (!apiKey) {
  console.error(`[ai-voice-speed] ${folderName}: OPENAI_API_KEY is not set. Add it to .env.local in ${scriptDir}.`);
  process.exit(1);
}

async function main() {
  if (!options.json) {
    console.log(`AI voice speed test — ${folderName}`);
    console.log(`Model: ${options.model} | Fixtures: ${fixtures.length} | Repeats: ${options.repeats}`);
    console.log('Measures end-of-speech (audio commit) to the model\'s action call.');
    console.log('');
  }

  const client = await connect(apiKey, options.model);
  const turns = [];

  try {
    for (let repeat = 0; repeat < options.repeats; repeat += 1) {
      for (const name of fixtures) {
        const audio = readFileSync(join(fixturesDir, name));
        const result = await runTurn(client, audio);
        turns.push({ fixture: name.replace(/\.pcm$/, ''), ...result });
        if (!options.json) {
          console.log(
            `  ${name.replace(/\.pcm$/, '').padEnd(16)} action ${ms(result.actionMs).padStart(7)}  stt ${ms(result.sttMs).padStart(7)}  ${JSON.stringify(result.transcript ?? '')} ${result.action ? `-> ${result.action}${result.args?.amount ? ' ' + result.args.amount : ''}` : ''}`,
          );
        }
      }
    }
  } finally {
    client.close();
  }

  const actionStats = summarize(turns.map((turn) => turn.actionMs).filter((value) => value != null));
  const sttStats = summarize(turns.map((turn) => turn.sttMs).filter((value) => value != null));

  if (options.json) {
    console.log(JSON.stringify({ folder: folderName, model: options.model, turns, actionStats, sttStats }, null, 2));
    return;
  }

  console.log('');
  console.log(`Action (end-of-speech -> action), ${actionStats.count} turns: min ${ms(actionStats.min)} | median ${ms(actionStats.median)} | mean ${ms(actionStats.mean)} | p95 ${ms(actionStats.p95)} | max ${ms(actionStats.max)}`);
  console.log(`Transcript (end-of-speech -> text), ${sttStats.count} turns: min ${ms(sttStats.min)} | median ${ms(sttStats.median)} | mean ${ms(sttStats.mean)} | p95 ${ms(sttStats.p95)} | max ${ms(sttStats.max)}`);
}

main().catch((error) => {
  console.error(`[ai-voice-speed] ${folderName}: ${error.message || error}`);
  process.exit(1);
});
