export const MAX_INTENT_CHARS = parseInt(process.env.MAX_INTENT_CHARS ?? '500', 10);
const MIN_INTENT_CHARS = 5;
const MAX_LOCATION_CHARS = 100;

// C0/C1 control characters except tab/newline, plus zero-width and bidi overrides
// that can hide text from reviewers while still reaching the model.
const INVISIBLE = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F​-‏‪-‮⁠-⁤﻿]/g;

export function stripInvisible(s: string): string {
  return s.replace(INVISIBLE, '');
}

export type ValidationResult =
  | { ok: true; value: string }
  | { ok: false; error: string };

export function validateIntent(raw: unknown): ValidationResult {
  if (typeof raw !== 'string') return { ok: false, error: 'intent must be a string' };
  const value = stripInvisible(raw).replace(/\s+/g, ' ').trim();
  if (value.length < MIN_INTENT_CHARS) {
    return { ok: false, error: `intent must be at least ${MIN_INTENT_CHARS} characters` };
  }
  if (value.length > MAX_INTENT_CHARS) {
    return { ok: false, error: `intent must be at most ${MAX_INTENT_CHARS} characters` };
  }
  return { ok: true, value };
}

/**
 * Location is interpolated into prompts and search queries, so it is held to a
 * strict place-name shape ("Brooklyn, NY, US") rather than screened.
 * Returns undefined for empty input.
 */
export function validateLocation(raw: unknown): ValidationResult | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'string') return { ok: false, error: 'location must be a string' };
  const value = stripInvisible(raw).replace(/\s+/g, ' ').trim();
  if (!value) return undefined;
  if (value.length > MAX_LOCATION_CHARS) {
    return { ok: false, error: `location must be at most ${MAX_LOCATION_CHARS} characters` };
  }
  if (!/^[\p{L}\p{M}\d .,'()\-]+$/u.test(value)) {
    return { ok: false, error: 'location may only contain letters, numbers, spaces and , . \' ( ) -' };
  }
  return { ok: true, value };
}
