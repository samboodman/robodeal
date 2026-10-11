#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const folderName = basename(scriptDir);
const fixturesDir = join(scriptDir, 'voice-fixtures');

function parseEnv(text) {
  const values = {};
  for (const rawLine of text.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const separator = line.indexOf('=');
    if (separator === -1) continue;
    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
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
  for (const [key, value] of Object.entries(merged)) if (!(key in preexisting)) process.env[key] = value;
}

function readArgs(argv) {
  const options = { url: null, port: 5179, repeats: 1, timeout: 25000, headful: false, json: false, help: false };
  for (const arg of argv) {
    if (arg === '--json') options.json = true;
    else if (arg === '--headful') options.headful = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--url=')) options.url = arg.slice('--url='.length);
    else if (arg.startsWith('--port=')) options.port = Number(arg.slice('--port='.length)) || options.port;
    else if (arg.startsWith('--repeats=')) options.repeats = Math.max(1, Math.floor(Number(arg.split('=')[1])) || options.repeats);
    else if (arg.startsWith('--timeout=')) options.timeout = Math.max(1000, Number(arg.split('=')[1]) || options.timeout);
  }
  return options;
}

function summarize(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length === 0) return null;
  const sorted = [...clean].sort((first, second) => first - second);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const at = (fraction) => sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
  return {
    count: sorted.length,
    min: sorted[0],
    median: sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2,
    mean: total / sorted.length,
    p95: at(0.95),
    max: sorted.at(-1),
  };
}

const ms = (value) => (Number.isFinite(value) ? `${value.toFixed(0)}` : '—');

async function startServer(port) {
  const viteBin = join(scriptDir, 'node_modules/vite/bin/vite.js');
  if (!existsSync(viteBin)) throw new Error(`vite not installed in ${scriptDir}; run npm install.`);
  const child = spawn(process.execPath, [viteBin, '--port', String(port), '--strictPort'], { cwd: scriptDir, stdio: ['ignore', 'ignore', 'pipe'] });
  child.stderr.on('data', (chunk) => process.stderr.write(chunk));
  const url = `http://localhost:${port}/`;
  const deadline = Date.now() + 30000;
  while (Date.now() < deadline) {
    try { if ((await fetch(url)).ok) return { child, url }; } catch {}
    await new Promise((resolve) => setTimeout(resolve, 300));
  }
  child.kill('SIGTERM');
  throw new Error('dev server did not start in time');
}

async function freshGameAndConnect(page, url) {
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  if (await page.locator('#debug-features').count()) {
    await page.check('#debug-features').catch(() => {});
    await page.check('#enable-audio-file-input').catch(() => {});
  }
  await page.uncheck('#start-microphone-automatically').catch(() => {});
  await page.click('#setup-form button[type="submit"]');
  await page.waitForSelector('#lock-seats-button:not([hidden])', { timeout: 15000 });
  await page.click('#lock-seats-button');
  if (await page.locator('#deal-ok-button').isVisible().catch(() => false)) await page.click('#deal-ok-button').catch(() => {});
  await page.waitForFunction(() => /connected|listening|microphone off|speaking/i.test(document.querySelector('#voice-status')?.textContent || ''), { timeout: 30000 });
  await page.waitForTimeout(800);
  return page.textContent('#voice-status').catch(() => '?');
}

async function runFixture(page, fixturePath, timeout) {
  const before = await page.evaluate(() => (window.__robodealLatencyHistory || []).length);
  await page.evaluate(() => {
    const panel = document.querySelector('#voice-audio-test');
    if (panel) { panel.hidden = false; panel.style.display = ''; }
  });
  await page.setInputFiles('#voice-audio-file', fixturePath);
  await page.evaluate(() => document.querySelector('#voice-audio-test-button')?.click());
  try {
    await page.waitForFunction((previous) => (window.__robodealLatencyHistory || []).length > previous, before, { timeout });
    return await page.evaluate(() => window.__robodealLatencyHistory.at(-1));
  } catch {
    return null;
  }
}

async function main() {
  const options = readArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node ai-e2e-latency.mjs [--url=http://host/] [--repeats=1] [--timeout=25000] [--headful] [--json]');
    process.exit(0);
  }
  if (!existsSync(fixturesDir)) {
    console.error(`[e2e] ${folderName}: no voice-fixtures/ folder with .wav clips.`);
    process.exit(1);
  }
  const fixtures = readdirSync(fixturesDir).filter((name) => name.endsWith('.wav')).sort();
  if (fixtures.length === 0) {
    console.error(`[e2e] ${folderName}: voice-fixtures/ has no .wav clips.`);
    process.exit(1);
  }

  let server = null;
  let url = options.url;
  if (!url) { server = await startServer(options.port); url = server.url; }
  if (!options.json) console.log(`E2E speech->speech latency — ${folderName}\nURL: ${url} | Fixtures: ${fixtures.length} | Repeats: ${options.repeats}\n`);

  const browser = await chromium.launch({ headless: !options.headful, args: ['--autoplay-policy=no-user-gesture-required', '--use-fake-ui-for-media-stream'] });
  const page = await browser.newPage();
  page.on('pageerror', (error) => process.stderr.write(`[page error] ${error.message}\n`));
  await page.route('**/api/balance', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ balanceCents: 1_000_000 }) }));
  await page.route('**/api/debit', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ balanceCents: 1_000_000 }) }));

  const turns = [];
  let ping = null;
  const stt = [];

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    ping = await page.evaluate(async (target) => {
      const samples = [];
      for (let index = 0; index < 8; index += 1) {
        const start = performance.now();
        try { await fetch(`${target}?ping=${index}`, { cache: 'no-store' }); } catch {}
        samples.push(performance.now() - start);
      }
      return samples;
    }, url);

    for (const name of fixtures) {
      const buffer = readFileSync(join(fixturesDir, name));
      const start = performance.now();
      try {
        const form = new FormData();
        form.append('model', 'gpt-4o-mini-transcribe');
        form.append('file', new Blob([buffer], { type: 'audio/wav' }), name);
        await fetch('https://api.openai.com/v1/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
          body: form,
        });
      } catch {}
      stt.push(performance.now() - start);
    }

    for (let repeat = 0; repeat < options.repeats; repeat += 1) {
      for (const name of fixtures) {
        const status = await freshGameAndConnect(page, url);
        const entry = await runFixture(page, join(fixturesDir, name), options.timeout);
        turns.push({ fixture: name.replace(/\.wav$/, ''), timing: entry });
        if (!options.json) {
          const t = entry || {};
          console.log(`  ${name.replace(/\.wav$/, '').padEnd(16)} total ${ms(t.estimatedEndOfSpeechToAudioMs).padStart(6)}  end-of-turn ${ms(t.liveTurnDetectionMs).padStart(5)}  buffer ${ms(t.transcriptBufferMs).padStart(5)}  decisions ${ms(t.serverMs).padStart(6)}  speak ${ms(t.gptLiveSpeechStartMs).padStart(6)}${entry ? '' : `  [no entry; status "${status}"]`}`);
        }
      }
    }
  } finally {
    await browser.close().catch(() => {});
    if (server) server.child.kill('SIGTERM');
  }

  const pick = (key) => turns.map((turn) => turn.timing?.[key]);
  const stages = {
    total: summarize(pick('estimatedEndOfSpeechToAudioMs')),
    endOfTurn: summarize(pick('liveTurnDetectionMs')),
    buffer: summarize(pick('transcriptBufferMs')),
    decisions: summarize(pick('serverMs')),
    decisionsInPath: summarize(pick('totalBackendMs')),
    speculate: summarize(pick('speculativeLeadMs')),
    speak: summarize(pick('gptLiveSpeechStartMs')),
  };
  const pingStats = summarize(ping || []);
  const sttStats = summarize(stt);

  if (options.json) {
    console.log(JSON.stringify({ folder: folderName, url, ping: pingStats, stt: sttStats, turns, stages }, null, 2));
    return;
  }

  console.log('');
  const line = (label, stats) => console.log(`${label.padEnd(22)} median ${ms(stats?.median).padStart(6)} ms | mean ${ms(stats?.mean).padStart(6)} | min ${ms(stats?.min).padStart(6)} | max ${ms(stats?.max).padStart(6)} | n ${stats?.count ?? 0}`);
  console.log('Per-stage (ms):');
  line('TOTAL speech->speech', stages.total);
  line('end-of-turn / VAD', stages.endOfTurn);
  line('transcript buffer', stages.buffer);
  line('decisions model call', stages.decisions);
  line('decisions in-path', stages.decisionsInPath);
  line('speculative lead', stages.speculate);
  line('speech start', stages.speak);
  console.log(`ping client->server: median ${ms(pingStats?.median)} ms | mean ${ms(pingStats?.mean)} ms (n ${pingStats?.count ?? 0})`);
  console.log(`speech->text (transcribe): median ${ms(sttStats?.median)} ms | mean ${ms(sttStats?.mean)} ms (n ${sttStats?.count ?? 0})`);
}

main().catch((error) => {
  console.error(`[e2e] ${folderName}: ${error.message || error}`);
  process.exit(1);
});
