/**
 * Cognito user-management operations extracted from the main provider class.
 *
 * Each function takes the SDK client and pool/client config, so the
 * parent class can delegate without exposing its internals.
 *
 * @see D-03, T-1.5
 */
import { randomUUID } from 'node:crypto';
import type { CognitoIdentityProviderClient } from '@aws-sdk/client-cognito-identity-provider';
import {
  AdminCreateUserCommand,
  AdminDeleteUserCommand,
  AdminDisableUserCommand,
  AdminEnableUserCommand,
  AdminGetUserCommand,
  ListUsersCommand,
  ForgotPasswordCommand,
  ConfirmForgotPasswordCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import type { IdpUser } from './identity-provider.service.js';
import { mapCognitoError } from './cognito-error-map.js';
import { getUserAttr } from './cognito-helpers.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface CognitoClientConfig {
  client: CognitoIdentityProviderClient;
  userPoolId: string;
  webClientId: string;
  computeSecretHash: (username: string) => string;
}

// ---------------------------------------------------------------------------
// User lifecycle
// ---------------------------------------------------------------------------

export async function cognitoDisableUser(
  cfg: CognitoClientConfig,
  username: string,
): Promise<void> {
  try {
    await cfg.client.send(
      new AdminDisableUserCommand({
        UserPoolId: cfg.userPoolId,
        Username: username,
      }),
    );
  } catch (err) {
    mapCognitoError(err);
  }
}

export async function cognitoEnableUser(
  cfg: CognitoClientConfig,
  username: string,
): Promise<void> {
  try {
    await cfg.client.send(
      new AdminEnableUserCommand({
        UserPoolId: cfg.userPoolId,
        Username: username,
      }),
    );
  } catch (err) {
    mapCognitoError(err);
  }
}

export async function cognitoCreateUser(
  cfg: CognitoClientConfig,
  input: {
    email: string;
    locale: string;
    emailVerified: boolean;
    temporaryPassword?: string;
    suppressMessage: boolean;
  },
): Promise<{ username: string; sub: string }> {
  try {
    const username = randomUUID();
    const res = await cfg.client.send(
      new AdminCreateUserCommand({
        UserPoolId: cfg.userPoolId,
        Username: username,
        UserAttributes: [
          { Name: 'email', Value: input.email },
          { Name: 'email_verified', Value: String(input.emailVerified) },
          { Name: 'custom:locale', Value: input.locale },
        ],
        TemporaryPassword: input.temporaryPassword,
        MessageAction: input.suppressMessage ? 'SUPPRESS' : undefined,
      }),
    );
    const sub = getUserAttr(res.User?.Attributes, 'sub') ?? username;
    return { username, sub };
  } catch (err) {
    mapCognitoError(err);
  }
}

export async function cognitoDeleteUser(
  cfg: CognitoClientConfig,
  username: string,
): Promise<void> {
  try {
    await cfg.client.send(
      new AdminDeleteUserCommand({
        UserPoolId: cfg.userPoolId,
        Username: username,
      }),
    );
  } catch (err) {
    mapCognitoError(err);
  }
}

export async function cognitoFindUserByEmail(
  cfg: CognitoClientConfig,
  email: string,
): Promise<IdpUser | null> {
  // Reject emails that could inject into the Cognito filter grammar
  if (/[\s"\\]/.test(email)) return null;

  try {
    const res = await cfg.client.send(
      new ListUsersCommand({
        UserPoolId: cfg.userPoolId,
        Filter: `email = "${email}"`,
        Limit: 1,
      }),
    );
    const user = res.Users?.[0];
    if (!user) return null;

    const attrs = user.Attributes;
    const status = user.UserStatus ?? 'UNKNOWN';
    const username = user.Username ?? '';

    // ListUsers does not return MFA settings; AdminGetUser does. A user
    // deleted between the two calls is reported as not found, like before.
    let mfaList: string[];
    try {
      const detail = await cfg.client.send(
        new AdminGetUserCommand({ UserPoolId: cfg.userPoolId, Username: username }),
      );
      mfaList = detail?.UserMFASettingList ?? [];
    } catch (err) {
      if ((err as { name?: string } | null)?.name === 'UserNotFoundException') return null;
      throw err;
    }

    return {
      username,
      sub: getUserAttr(attrs, 'sub') ?? '',
      email: getUserAttr(attrs, 'email') ?? email,
      emailVerified: getUserAttr(attrs, 'email_verified') === 'true',
      enabled: user.Enabled ?? true,
      status,
      hasPassword: status === 'EXTERNAL_PROVIDER' ? false : null,
      mfaEnrolled: mfaList.includes('SOFTWARE_TOKEN_MFA'),
      locale: getUserAttr(attrs, 'custom:locale'),
    };
  } catch (err) {
    mapCognitoError(err);
  }
}

// ---------------------------------------------------------------------------
// Password reset
// ---------------------------------------------------------------------------

export async function cognitoForgotPassword(
  cfg: CognitoClientConfig,
  email: string,
): Promise<void> {
  try {
    await cfg.client.send(
      new ForgotPasswordCommand({
        ClientId: cfg.webClientId,
        Username: email,
        SecretHash: cfg.computeSecretHash(email),
      }),
    );
  } catch (err) {
    // Suppress UserNotFoundException to avoid leaking existence
    if ((err as { name?: string }).name === 'UserNotFoundException') return;
    mapCognitoError(err);
  }
}

export async function cognitoConfirmForgotPassword(
  cfg: CognitoClientConfig,
  input: { email: string; code: string; newPassword: string },
): Promise<void> {
  try {
    await cfg.client.send(
      new ConfirmForgotPasswordCommand({
        ClientId: cfg.webClientId,
        Username: input.email,
        ConfirmationCode: input.code,
        Password: input.newPassword,
        SecretHash: cfg.computeSecretHash(input.email),
      }),
    );
  } catch (err) {
    mapCognitoError(err, 'auth');
  }
}
