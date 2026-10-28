// Per-process bounded limiter. Shipment-level limits cannot be bypassed by
// changing the submitted phone or spoofing a forwarded IP address.
const attempts = new Map<string, { count: number; expires: number }>();
export function allowTrackingAttempt(key: string, now = Date.now()): boolean {
  for (const [id, entry] of attempts) if (entry.expires <= now) attempts.delete(id);
  const entry = attempts.get(key);
  if (entry) {
    if (entry.count >= 10) return false;
    entry.count++;
    return true;
  }
  if (attempts.size >= 10000) return false;
  attempts.set(key, { count: 1, expires: now + 15 * 60 * 1000 });
  return true;
}
