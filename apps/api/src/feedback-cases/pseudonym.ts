/**
 * The case-specific pseudonym a reporter is shown as (spec FBK-01): a label
 * handlers can refer to in conversation that carries nothing about the
 * person. Four base32 characters give about a million labels per
 * organization; collisions are harmless because the case id is the key.
 */
import { randomBytes } from 'node:crypto';

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export const PSEUDONYM_PREFIX = 'Reporter-';

export function casePseudonym(length = 4): string {
  const bytes = randomBytes(length);
  let suffix = '';
  for (let i = 0; i < length; i += 1) suffix += ALPHABET[bytes[i]! % ALPHABET.length];
  return `${PSEUDONYM_PREFIX}${suffix}`;
}
