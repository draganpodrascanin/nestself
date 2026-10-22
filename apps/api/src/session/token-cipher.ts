/**
 * AES-256-GCM encryption for Cognito tokens stored in Redis session records.
 *
 * Output format: `v1.<iv>.<ciphertext>.<tag>` (all segments base64url).
 * Supports dual-key rotation: decrypt tries the current key first, then the
 * previous key. A successful decryption with the previous key sets
 * `usedPreviousKey` so the caller can re-encrypt on the next write.
 *
 * @see SESS-R-09, D-06, D-27, 10.6 Key and secret rotation
 */
import { Injectable, Logger } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ConfigService } from '@nestjs/config';
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

const ALGO = 'aes-256-gcm';
const IV_BYTES = 12;
const TAG_BYTES = 16;

function toBase64Url(buf: Buffer): string {
  return buf.toString('base64url');
}

function fromBase64Url(str: string): Buffer {
  return Buffer.from(str, 'base64url');
}

function hexToKey(hex: string, label: string): Buffer {
  if (!/^[0-9a-f]{64}$/i.test(hex)) {
    throw new Error(
      `${label} must be exactly 64 hex characters (256 bits); got ${hex.length} characters`,
    );
  }
  return Buffer.from(hex, 'hex');
}

export interface DecryptResult {
  plaintext: string;
  /** True when decryption succeeded with the previous (rotated-out) key. */
  usedPreviousKey: boolean;
}

@Injectable()
export class TokenCipher {
  private readonly logger = new Logger(TokenCipher.name);
  private readonly currentKey: Buffer;
  private readonly previousKey: Buffer | null;

  constructor(config: ConfigService) {
    let rawKey = config.get<string>('SESSION_ENCRYPTION_KEY');

    if (!rawKey) {
      const jwtSecret = config.get<string>('JWT_SECRET');
      if (!jwtSecret) {
        throw new Error(
          'SESSION_ENCRYPTION_KEY is required when JWT_SECRET is not available',
        );
      }
      rawKey = createHash('sha256').update(jwtSecret).digest('hex');
      this.logger.warn(
        'SESSION_ENCRYPTION_KEY not set; derived a deterministic dev key from JWT_SECRET. ' +
          'Do NOT use this in production.',
      );
    }

    this.currentKey = hexToKey(rawKey, 'SESSION_ENCRYPTION_KEY');

    const rawPrev = config.get<string>('SESSION_ENCRYPTION_KEY_PREVIOUS');
    this.previousKey = rawPrev ? hexToKey(rawPrev, 'SESSION_ENCRYPTION_KEY_PREVIOUS') : null;
  }

  /** Encrypt a plaintext string. Returns `v1.<iv>.<ciphertext>.<tag>`. */
  encrypt(plaintext: string): string {
    const iv = randomBytes(IV_BYTES);
    const cipher = createCipheriv(ALGO, this.currentKey, iv);
    const encrypted = Buffer.concat([
      cipher.update(plaintext, 'utf8'),
      cipher.final(),
    ]);
    const tag = cipher.getAuthTag();
    return `v1.${toBase64Url(iv)}.${toBase64Url(encrypted)}.${toBase64Url(tag)}`;
  }

  /**
   * Decrypt a ciphertext string produced by {@link encrypt}.
   * Tries the current key first; on GCM authentication failure, retries with
   * the previous key (if configured). Returns which key succeeded.
   *
   * @see 10.6 Key and secret rotation — dual acceptance
   */
  decrypt(ciphertext: string): DecryptResult {
    const result = this.tryDecrypt(ciphertext, this.currentKey);
    if (result !== null) {
      return { plaintext: result, usedPreviousKey: false };
    }
    if (this.previousKey) {
      const prev = this.tryDecrypt(ciphertext, this.previousKey);
      if (prev !== null) {
        return { plaintext: prev, usedPreviousKey: true };
      }
    }
    throw new Error('Decryption failed: invalid ciphertext or wrong key');
  }

  private tryDecrypt(ciphertext: string, key: Buffer): string | null {
    const parts = ciphertext.split('.');
    if (parts.length !== 4 || parts[0] !== 'v1') {
      throw new Error('Invalid ciphertext format: expected v1.<iv>.<data>.<tag>');
    }
    const iv = fromBase64Url(parts[1]!);
    const data = fromBase64Url(parts[2]!);
    const tag = fromBase64Url(parts[3]!);
    if (tag.length !== TAG_BYTES) {
      throw new Error(`Invalid auth tag length: expected ${TAG_BYTES}, got ${tag.length}`);
    }
    try {
      const decipher = createDecipheriv(ALGO, key, iv);
      decipher.setAuthTag(tag);
      const decrypted = Buffer.concat([decipher.update(data), decipher.final()]);
      return decrypted.toString('utf8');
    } catch {
      return null;
    }
  }
}
