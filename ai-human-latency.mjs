#!/usr/bin/env node
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium } from 'playwright';

const scriptDir = dirname(fileURLToPath(import.meta.url));
const folderName = basename(scriptDir);
const fixturesDir = join(scriptDir, 'voice-fixtures');
const tempDir = join(tmpdir(), 'robodeal-human');

function readArgs(argv) {
  const options = { url: null, port: 5178, repeats: 1, timeout: 30000, json: false, help: false, only: null };
  for (const arg of argv) {
    if (arg === '--json') options.json = true;
    else if (arg === '--help' || arg === '-h') options.help = true;
    else if (arg.startsWith('--url=')) options.url = arg.slice('--url='.length);
    else if (arg.startsWith('--port=')) options.port = Number(arg.slice('--port='.length)) || options.port;
    else if (arg.startsWith('--repeats=')) options.repeats = Math.max(1, Math.floor(Number(arg.split('=')[1])) || options.repeats);
    else if (arg.startsWith('--timeout=')) options.timeout = Math.max(1000, Number(arg.split('=')[1]) || options.timeout);
    else if (arg.startsWith('--only=')) options.only = arg.slice('--only='.length);
  }
  return options;
}

function summarize(values) {
  const clean = values.filter((value) => Number.isFinite(value));
  if (clean.length === 0) return null;
  const sorted = [...clean].sort((first, second) => first - second);
  const total = sorted.reduce((sum, value) => sum + value, 0);
  const at = (fraction) => sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))];
  return { count: sorted.length, min: sorted[0], median: sorted.length % 2 ? sorted[(sorted.length - 1) / 2] : (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2, mean: total / sorted.length, p95: at(0.95), max: sorted.at(-1) };
}
const ms = (value) => (Number.isFinite(value) ? `${value.toFixed(0)}` : '—');

function appendSilence(wav, silenceSeconds = 300, sampleRate = 24000) {
  const pcm = wav.subarray(44);
  const silence = Buffer.alloc(sampleRate * 2 * silenceSeconds);
  const merged = Buffer.concat([pcm, silence]);
  const header = Buffer.from(wav.subarray(0, 44));
  header.writeUInt32LE(36 + merged.length, 4);
  header.writeUInt32LE(merged.length, 40);
  return Buffer.concat([header, merged]);
}

async function startServer(port) {
  const viteBin = join(scriptDir, 'node_modules/vite/bin/vite.js');
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

const INIT_SCRIPT = `
(() => {
  window.__lastSoundAt = null;
  window.__gameStateChangedAt = null;
  window.__responseSpeakingAt = null;
  window.__outputSoundAt = null;
  window.__micStartAt = null;
  const md = navigator.mediaDevices;
  if (md && !md.__patched) {
    md.__patched = true;
    const original = md.getUserMedia.bind(md);
    md.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      if (constraints && constraints.audio) {
        window.__micStartAt = performance.now();
        try {
          const ctx = new AudioContext();
          const source = ctx.createMediaStreamSource(stream);
          const analyser = ctx.createAnalyser();
          analyser.fftSize = 512;
          source.connect(analyser);
          const buf = new Float32Array(analyser.fftSize);
          const poll = () => {
            analyser.getFloatTimeDomainData(buf);
            let sum = 0;
            for (let i = 0; i < buf.length; i += 1) sum += buf[i] * buf[i];
            if (Math.sqrt(sum / buf.length) > 0.01) window.__lastSoundAt = performance.now();
            requestAnimationFrame(poll);
          };
          poll();
        } catch {}
      }
      return stream;
    };
  }
  const install = () => {
    const target = document.querySelector('#game-screen');
    if (!target) { setTimeout(install, 150); return; }
    const mark = () => { if (!window.__gameStateChangedAt && window.__lastSoundAt) window.__gameStateChangedAt = performance.now(); };
    new MutationObserver((mutations) => {
      for (const m of mutations) {
        const el = m.target;
        if (m.type === 'attributes' && el.nodeType === 1 && el.classList && el.classList.contains('player-seat')) { mark(); return; }
        if (m.type === 'characterData' && el.parentElement && el.parentElement.id === 'pot-value') { mark(); return; }
        if (m.type === 'childList' && el.nodeType === 1 && el.id === 'pot-value') { mark(); return; }
      }
    }).observe(target, { subtree: true, attributes: true, childList: true, characterData: true });
  };
  install();
  const installStatus = () => {
    const el = document.querySelector('#voice-status');
    if (!el) { setTimeout(installStatus, 150); return; }
    new MutationObserver(() => {
      if (!window.__responseSpeakingAt && window.__lastSoundAt && /speaking/i.test(el.textContent || '')) window.__responseSpeakingAt = performance.now();
    }).observe(el, { subtree: true, characterData: true, childList: true });
  };
  installStatus();
  const installOutput = () => {
    const el = document.querySelector('audio');
    if (!el || typeof el.captureStream !== 'function') { setTimeout(installOutput, 150); return; }
    try {
      const ctx = new AudioContext();
      const src = ctx.createMediaStreamSource(el.captureStream());
      const an = ctx.createAnalyser();
      an.fftSize = 512;
      src.connect(an);
      const buf = new Float32Array(an.fftSize);
      const poll = () => {
        an.getFloatTimeDomainData(buf);
        let s = 0;
        for (let i = 0; i < buf.length; i += 1) s += buf[i] * buf[i];
        if (Math.sqrt(s / buf.length) > 0.01 && window.__lastSoundAt) window.__outputSoundAt = performance.now();
        requestAnimationFrame(poll);
      };
      poll();
    } catch {}
  };
  installOutput();
})();
`;

async function runFixture(url, name, options) {
  const capturePath = join(tempDir, `${name}-loop.wav`);
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--autoplay-policy=no-user-gesture-required',
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      `--use-file-for-fake-audio-capture=${capturePath}`,
    ],
  });
  try {
    const context = await browser.newContext({ permissions: ['microphone'] });
    const page = await context.newPage();
    await page.addInitScript(INIT_SCRIPT);
    await page.route('**/api/balance', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ balanceCents: 1_000_000 }) }));
    await page.route('**/api/debit', (route) => route.fulfill({ status: 200, contentType: 'application/json', body: JSON.stringify({ balanceCents: 1_000_000 }) }));
    await page.goto(url, { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => { window.__robodealVoiceStages = {}; });
    const before = await page.evaluate(() => (window.__robodealLatencyHistory || []).length);
    await page.click('#setup-form button[type="submit"]');
    await page.waitForSelector('#lock-seats-button:not([hidden])', { timeout: 15000 });
    await page.click('#lock-seats-button');
    if (await page.locator('#deal-ok-button').isVisible().catch(() => false)) await page.click('#deal-ok-button').catch(() => {});

    await page.waitForFunction(() => Boolean(window.__lastSoundAt), { timeout: options.timeout }).catch(() => {});
    await page.waitForFunction(() => Boolean(window.__gameStateChangedAt), { timeout: options.timeout }).catch(() => {});
    await page.waitForFunction(() => Boolean(window.__responseSpeakingAt), { timeout: options.timeout }).catch(() => {});
    await page.waitForFunction(() => Boolean(window.__outputSoundAt), { timeout: options.timeout }).catch(() => {});

    const markers = await page.evaluate(() => ({
      lastSoundAt: window.__lastSoundAt,
      gameStateChangedAt: window.__gameStateChangedAt,
      responseSpeakingAt: window.__responseSpeakingAt,
      outputSoundAt: window.__outputSoundAt,
      micStartAt: window.__micStartAt,
      stages: window.__robodealVoiceStages || {},
      telemetry: (window.__robodealLatencyHistory || []).at(-1) || null,
    }));
    const audioAt = markers.outputSoundAt ?? markers.responseSpeakingAt;
    return {
      fixture: name,
      totalToGameState: markers.lastSoundAt && markers.gameStateChangedAt ? markers.gameStateChangedAt - markers.lastSoundAt : null,
      totalToAudio: markers.lastSoundAt && audioAt ? audioAt - markers.lastSoundAt : null,
      markers,
    };
  } finally {
    await browser.close().catch(() => {});
  }
}

async function main() {
  const options = readArgs(process.argv.slice(2));
  if (options.help) {
    console.log('Usage: node ai-human-latency.mjs [--url=http://host/] [--repeats=1] [--timeout=30000] [--only=name] [--json]');
    process.exit(0);
  }
  if (!existsSync(fixturesDir)) { console.error(`[human] ${folderName}: no voice-fixtures/`); process.exit(1); }
  if (!existsSync(tempDir)) mkdirSync(tempDir, { recursive: true });
  let fixtures = readdirSync(fixturesDir).filter((name) => name.endsWith('.wav')).sort();
  if (options.only) fixtures = fixtures.filter((name) => name.replace(/\.wav$/, '') === options.only);

  for (const name of fixtures) {
    writeFileSync(join(tempDir, `${name.replace(/\.wav$/, '')}-loop.wav`), appendSilence(readFileSync(join(fixturesDir, name))));
  }

  let server = null;
  let url = options.url;
  if (!url) { server = await startServer(options.port); url = server.url; }
  if (!options.json) console.log(`HUMAN-latency (real mic, last-sound -> game-state change) — ${folderName}\nURL: ${url} | Fixtures: ${fixtures.length} | Repeats: ${options.repeats}\n`);

  const turns = [];
  try {
    for (let repeat = 0; repeat < options.repeats; repeat += 1) {
      for (const name of fixtures) {
        const turn = await runFixture(url, name.replace(/\.wav$/, ''), options);
        turns.push(turn);
        if (!options.json) {
          console.log(`  ${turn.fixture.padEnd(16)} last-sound -> AI-speaks: ${ms(turn.totalToAudio).padStart(6)} ms   (last-sound -> game-state ${ms(turn.totalToGameState)} ms)`);
        }
      }
    }
  } finally {
    if (server) server.child.kill('SIGTERM');
  }

  const stats = summarize(turns.map((turn) => turn.totalToAudio));
  const statsGameState = summarize(turns.map((turn) => turn.totalToGameState));
  if (options.json) { console.log(JSON.stringify({ folder: folderName, url, turns, stats, statsGameState }, null, 2)); return; }
  console.log('');
  console.log(`HUMAN total (last sound -> AI starts speaking): median ${ms(stats?.median)} ms | mean ${ms(stats?.mean)} | min ${ms(stats?.min)} | max ${ms(stats?.max)} | n ${stats?.count ?? 0}`);
  console.log(`HUMAN total (last sound -> game-state change):  median ${ms(statsGameState?.median)} ms | mean ${ms(statsGameState?.mean)} | n ${statsGameState?.count ?? 0}`);
}

main().catch((error) => { console.error(`[human] ${folderName}: ${error.message || error}`); process.exit(1); });
