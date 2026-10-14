const buckets = new Map();

function clientAddress(request) {
  const forwarded = String(request.headers?.['x-forwarded-for'] || '').split(',')[0].trim();
  return forwarded || request.socket?.remoteAddress || 'unknown';
}

/** A small fixed-window limit for expensive payment and AI entry points. */
export function enforceRateLimit(request, response, { name, limit, windowMs, subject = '' }) {
  const now = Date.now();
  const key = `${name}:${clientAddress(request)}:${subject}`;
  const existing = buckets.get(key);
  const bucket = !existing || existing.resetAt <= now
    ? { count: 0, resetAt: now + windowMs }
    : existing;
  bucket.count += 1;
  buckets.set(key, bucket);
  if (bucket.count <= limit) return true;
  const retryAfter = Math.max(1, Math.ceil((bucket.resetAt - now) / 1000));
  response.setHeader?.('Retry-After', String(retryAfter));
  response.statusCode = 429;
  response.setHeader?.('Content-Type', 'application/json; charset=utf-8');
  response.end?.(JSON.stringify({ error: 'Too many requests. Try again later.' }));
  return false;
}
