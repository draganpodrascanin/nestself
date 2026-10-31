/**
 * PendingBindStore: a federated sign-in waiting for the user to confirm the
 * address with a code (SSO-R-08, phase 4 design 5.6). The OIDC provider did
 * not mark the address verified, so the callback keeps the pool user and
 * stores what the binding needs once the mailbox is proven: the connection,
 * the provider name, the `sub` and pool username, the address, where the
 * sign-in continues, whether it was a staff test sign-in, and the token set
 * of the code exchange.
 *
 * - `open` stores the record for `SSO_PENDING_BIND_TTL` (15 minutes) and
 *   answers its handle: 32 random bytes, base64url, the only thing the
 *   browser carries (`/sign-in?reason=sso_email_unverified&bind=<handle>`).
 * - The record lives at `sso_pending_bind:{sha256(handle)}` (`pendingBindId`),
 *   so a copy of the store holds no handle.
 * - The three tokens are encrypted with the session `TokenCipher`, as in a
 *   session record; `take` decrypts them.
 * - `peek` reads the record and leaves it (a new code from the same screen);
 *   `take` takes it out with GETDEL, so one binding at most comes of it.
 */
import { Inject, Injectable, Logger, forwardRef } from '@nestjs/common';
import { createHash, randomBytes } from 'node:crypto';
import type { TokenSet } from '../identity/identity-provider.service.js';
import { KEY_VALUE_STORE, type KeyValueStore } from '../redis/key-value-store.js';
import { SSO_PENDING_BIND_TTL, ssoPendingBindKey } from '../redis/redis-keys.js';
import { TokenCipher } from '../session/token-cipher.js';

/** What `sso_pending_bind:{id}` holds. Never logged or audited. */
export interface PendingBind {
  connectionId: string;
  /** The connection's `cognitoProviderName` the sign-in came through. */
  providerName: string;
  /** The pool user's `sub` (the identity's subject once bound). */
  sub: string;
  /** The pool username (`<providerName>_<IdP subject>`), deleted when the binding is refused. */
  username: string;
  /** The asserted address, lowercased and trimmed; the code goes there. */
  email: string;
  surface: 'workspace' | 'admin';
  returnPath: string | null;
  /**
   * The sign-in came through a staff test link of the connection (its
   * single-use nonce was valid): the binding may finish while the connection
   * is TESTING, and marks it tested.
   */
  testSignIn: boolean;
  /** The token set of the code exchange; the three token strings are `TokenCipher` ciphertexts. */
  tokens: { accessToken: string; idToken: string; refreshToken: string; expiresIn: number };
  createdAt: string;
}

/** What `open` is given: the record with the exchange's tokens in the clear. */
export type PendingBindInput = Omit<PendingBind, 'tokens' | 'createdAt'> & { tokens: TokenSet };

/** A pending binding taken out of the store, its tokens decrypted. */
export type TakenPendingBind = Omit<PendingBind, 'tokens'> & { tokens: TokenSet };

/** The record's id: the sha256 (hex) of its handle. */
export function pendingBindId(handle: string): string {
  return createHash('sha256').update(handle).digest('hex');
}

const isString = (value: unknown): value is string => typeof value === 'string';

/** The stored record, or null when it is missing a field (never trusted blindly). */
function parse(raw: string | null): PendingBind | null {
  if (!raw) return null;
  let r: Partial<PendingBind>;
  try {
    r = JSON.parse(raw) as Partial<PendingBind>;
  } catch {
    return null;
  }
  const t = r.tokens;
  if (
    !isString(r.connectionId) ||
    !isString(r.providerName) ||
    !isString(r.sub) ||
    !isString(r.username) ||
    !isString(r.email) ||
    (r.surface !== 'workspace' && r.surface !== 'admin') ||
    (r.returnPath !== null && !isString(r.returnPath)) ||
    typeof r.testSignIn !== 'boolean' ||
    !isString(r.createdAt) ||
    !Number.isFinite(Date.parse(r.createdAt)) ||
    !t ||
    !isString(t.accessToken) ||
    !isString(t.idToken) ||
    !isString(t.refreshToken) ||
    typeof t.expiresIn !== 'number'
  ) {
    return null;
  }
  return {
    connectionId: r.connectionId,
    providerName: r.providerName,
    sub: r.sub,
    username: r.username,
    email: r.email,
    surface: r.surface,
    returnPath: r.returnPath,
    testSignIn: r.testSignIn,
    tokens: { accessToken: t.accessToken, idToken: t.idToken, refreshToken: t.refreshToken, expiresIn: t.expiresIn },
    createdAt: r.createdAt,
  };
}

@Injectable()
export class PendingBindStore {
  private readonly logger = new Logger(PendingBindStore.name);

  constructor(
    @Inject(KEY_VALUE_STORE) private readonly store: KeyValueStore,
    @Inject(forwardRef(() => TokenCipher)) private readonly cipher: TokenCipher,
  ) {}

  /** Stores the pending binding and answers its handle. */
  async open(input: PendingBindInput): Promise<string> {
    const handle = randomBytes(32).toString('base64url');
    const record: PendingBind = {
      connectionId: input.connectionId,
      providerName: input.providerName,
      sub: input.sub,
      username: input.username,
      email: input.email,
      surface: input.surface,
      returnPath: input.returnPath,
      testSignIn: input.testSignIn,
      tokens: {
        accessToken: this.cipher.encrypt(input.tokens.accessToken),
        idToken: this.cipher.encrypt(input.tokens.idToken),
        // Empty when the exchange returned none, as the session stores it.
        refreshToken: this.cipher.encrypt(input.tokens.refreshToken ?? ''),
        expiresIn: input.tokens.expiresIn,
      },
      createdAt: new Date().toISOString(),
    };
    await this.store.set(ssoPendingBindKey(pendingBindId(handle)), JSON.stringify(record), {
      ttlSeconds: SSO_PENDING_BIND_TTL,
    });
    return handle;
  }

  /** The pending binding, left in the store; null when unknown, expired or unreadable. */
  async peek(id: string): Promise<PendingBind | null> {
    return parse(await this.store.get(ssoPendingBindKey(id)));
  }

  /**
   * Takes the pending binding out of the store (single use) with its tokens
   * decrypted; null when unknown, expired, already taken or unreadable.
   * `expiresIn` is what the tokens have left: they are as old as the record,
   * and a session counts their expiry from the moment it is created.
   */
  async take(id: string): Promise<TakenPendingBind | null> {
    const record = parse(await this.store.getDel(ssoPendingBindKey(id)));
    if (!record) return null;
    const ageSeconds = Math.max(0, Math.floor((Date.now() - Date.parse(record.createdAt)) / 1000));
    try {
      const refreshToken = this.cipher.decrypt(record.tokens.refreshToken).plaintext;
      return {
        ...record,
        tokens: {
          accessToken: this.cipher.decrypt(record.tokens.accessToken).plaintext,
          idToken: this.cipher.decrypt(record.tokens.idToken).plaintext,
          refreshToken: refreshToken || null,
          expiresIn: Math.max(0, record.tokens.expiresIn - ageSeconds),
        },
      };
    } catch {
      // The session key changed and the previous one is gone: the sign-in has to start again.
      this.logger.warn('Pending SSO binding unreadable: its tokens do not decrypt');
      return null;
    }
  }
}
