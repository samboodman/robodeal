import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const STRIPE_API = 'https://api.stripe.com/v1';
const PAYER_COOKIE = 'payer';

export const PRICE_CENTS = 1999;
export const PRICE_SECONDS = 5 * 3600;
export const CENTS_PER_SECOND = PRICE_CENTS / PRICE_SECONDS;
export const INITIAL_FREE_HOURS = 2;
const INITIAL_FREE_CENTS = Math.round(INITIAL_FREE_HOURS * 3600 * CENTS_PER_SECOND);
export const LIVE_SESSION_START_CENTS = Math.ceil(CENTS_PER_SECOND * 15);
export const DEALER_TURN_CENTS = 1;

let client = null;

function db() {
  if (!client) {
    const url = process.env.SUPABASE_URL;
    const key = process.env.SUPABASE_SECRET_KEY;
    if (!url || !key) throw new Error('The server is missing SUPABASE_URL / SUPABASE_SECRET_KEY.');
    client = createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
  }
  return client;
}

function parseCookies(header) {
  const cookies = {};
  String(header || '').split(';').forEach((pair) => {
    const index = pair.indexOf('=');
    if (index < 0) return;
    cookies[pair.slice(0, index).trim()] = decodeURIComponent(pair.slice(index + 1).trim());
  });
  return cookies;
}

export function ensurePayerId(request, response) {
  const cookies = parseCookies(request.headers?.cookie);
  let payerId = cookies[PAYER_COOKIE];
  if (!payerId || !/^[0-9a-f-]{36}$/.test(payerId)) {
    payerId = randomUUID();
    const secure = process.env.NODE_ENV === 'production' ? '; Secure' : '';
    if (typeof response.setHeader === 'function') {
      response.setHeader('Set-Cookie', `${PAYER_COOKIE}=${payerId}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${secure}`);
    }
  }
  return payerId;
}

async function stripeRequest(path, { method = 'POST', form } = {}) {
  const secret = process.env.SECRET_STRIPE_KEY;
  if (!secret) throw new Error('The server is missing SECRET_STRIPE_KEY.');
  const response = await fetch(`${STRIPE_API}/${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${secret}`,
      'Content-Type': 'application/x-www-form-urlencoded',
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const text = await response.text();
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    data = null;
  }
  if (!response.ok) throw new Error(data?.error?.message || text || 'Stripe request failed.');
  return data;
}

export function createTopupIntent(amountCents, payerId) {
  return stripeRequest('payment_intents', {
    form: {
      amount: String(amountCents),
      currency: 'usd',
      'automatic_payment_methods[enabled]': 'true',
      'metadata[payer_id]': payerId,
    },
  });
}

export function retrieveIntent(id) {
  return stripeRequest(`payment_intents/${encodeURIComponent(id)}`, { method: 'GET' });
}

export async function debitBalance(payerId, cents) {
  const result = await debitIfAvailable(payerId, cents);
  return result.balanceCents;
}

/**
 * Atomically-ish debits only when the current balance still covers the charge.
 * The compare-and-set update prevents two simultaneous requests from spending
 * the same balance.
 */
export async function debitIfAvailable(payerId, cents, { reason = 'usage', ref = null } = {}) {
  const amount = Math.max(0, Math.floor(cents));
  if (amount === 0) return { debited: true, balanceCents: await getBalanceCents(payerId) };
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const current = await getBalanceCents(payerId);
    if (current < amount) return { debited: false, balanceCents: current };
    const next = current - amount;
    const { data, error } = await db()
      .from('balances')
      .update({ balance_cents: next, updated_at: new Date().toISOString() })
      .eq('payer_id', payerId)
      .eq('balance_cents', current)
      .select('balance_cents');
    if (error) throw new Error(error.message);
    if (!data?.length) continue;
    const { error: ledgerError } = await db().from('ledger')
      .insert({ payer_id: payerId, delta_cents: -amount, reason, ref });
    if (ledgerError) throw new Error(ledgerError.message);
    return { debited: true, balanceCents: next };
  }
  return { debited: false, balanceCents: await getBalanceCents(payerId) };
}

export async function zeroBalance(payerId) {
  const { error } = await db()
    .from('balances')
    .upsert({ payer_id: payerId, balance_cents: 0, updated_at: new Date().toISOString() });
  if (error) throw new Error(error.message);
  return 0;
}

export async function getBalanceCents(payerId) {
  const { data, error } = await db()
    .from('balances')
    .select('balance_cents')
    .eq('payer_id', payerId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  return data?.balance_cents ?? 0;
}

export function createCardSetupIntent(payerId) {
  return stripeRequest('setup_intents', {
    form: {
      usage: 'off_session',
      'automatic_payment_methods[enabled]': 'true',
      'metadata[payer_id]': payerId,
    },
  });
}

export async function claimFreeGrant(payerId, setupIntentId) {
  const intent = await stripeRequest(`setup_intents/${encodeURIComponent(setupIntentId)}`, { method: 'GET' });
  if (intent.status !== 'succeeded') throw new Error('The card was not saved.');
  if (intent.metadata?.payer_id !== payerId) throw new Error('That card setup is not yours.');
  const methodId = typeof intent.payment_method === 'string' ? intent.payment_method : intent.payment_method?.id;
  const method = await stripeRequest(`payment_methods/${encodeURIComponent(methodId)}`, { method: 'GET' });
  const fingerprint = method.card?.fingerprint;
  if (!fingerprint) throw new Error('Could not read the card fingerprint.');
  const balanceBefore = await getBalanceCents(payerId);
  const { error } = await db().from('granted_fingerprints').insert({ fingerprint, payer_id: payerId });
  if (error) {
    if (error.code === '23505') return { granted: false, balanceCents: balanceBefore };
    throw new Error(error.message);
  }
  const balanceCents = await creditTopup(payerId, INITIAL_FREE_CENTS, `free:${payerId}`, 'grant');
  return { granted: true, balanceCents };
}

export async function creditTopup(payerId, cents, ref, reason = 'topup') {
  const { error: ledgerError } = await db()
    .from('ledger')
    .insert({ payer_id: payerId, delta_cents: cents, reason, ref });
  if (ledgerError) {
    if (ledgerError.code === '23505') return getBalanceCents(payerId);
    throw new Error(ledgerError.message);
  }
  const current = await getBalanceCents(payerId);
  const next = current + cents;
  const { error: balanceError } = await db()
    .from('balances')
    .upsert({ payer_id: payerId, balance_cents: next, updated_at: new Date().toISOString() });
  if (balanceError) throw new Error(balanceError.message);
  return next;
}
