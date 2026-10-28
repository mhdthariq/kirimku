/** Hide the latter half, including short values, without preserving raw PII. */
export function maskResiValue(value: string | null | undefined): string | null {
  const text = value?.trim();
  if (!text) return null;
  const chars = Array.from(text);
  const visible = Math.floor(chars.length / 2);
  return chars.slice(0, visible).join("") + "*".repeat(chars.length - visible);
}

/** Compare complete numbers; Indonesian 08…, 628…, and +628… are equivalent. */
export function normalizeResiPhone(value: unknown): string | null {
  if (typeof value !== "string" || value.length > 40 || !/^[+\d\s().-]+$/.test(value)) return null;
  let digits = value.replace(/\D/g, "");
  if (digits.startsWith("62")) digits = "0" + digits.slice(2);
  return digits.length >= 8 && digits.length <= 15 ? digits : null;
}
