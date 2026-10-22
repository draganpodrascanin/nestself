/**
 * Cognito identity provider adapter (T-1.15).
 *
 * Calls the AWS Cognito SDK using the confidential web client
 * (COGNITO_WEB_CLIENT_ID / COGNITO_WEB_CLIENT_SECRET). SECRET_HASH
 * is passed in AuthParameters/ChallengeResponses on every call.
 *
 * @see D-05, D-06, D-09, D-12, 3.5.3 Cognito API operations
 */
import { Injectable } from '@nestjs/common';
import { createHmac } from 'node:crypto';
import {
  CognitoIdentityProviderClient,
  AdminInitiateAuthCommand,
  AdminRespondToAuthChallengeCommand,
  GetTokensFromRefreshTokenCommand,
  RevokeTokenCommand,
  AdminUserGlobalSignOutCommand,
  AssociateSoftwareTokenCommand,
  VerifySoftwareTokenCommand,
  AdminSetUserMFAPreferenceCommand,
} from '@aws-sdk/client-cognito-identity-provider';
import {
  IdentityProviderService,
} from './identity-provider.service.js';
import type {
  AuthOutcome,
  TokenSet,
  IdpUser,
} from './identity-provider.service.js';
import { mapCognitoError } from './cognito-error-map.js';
import { parseAuthResult } from './cognito-helpers.js';
import {
  cognitoDisableUser,
  cognitoEnableUser,
  cognitoCreateUser,
  cognitoDeleteUser,
  cognitoFindUserByEmail,
  cognitoForgotPassword,
  cognitoConfirmForgotPassword,
  type CognitoClientConfig,
} from './cognito-user-ops.js';

// ---------------------------------------------------------------------------
// Implementation
// ---------------------------------------------------------------------------

@Injectable()
export class CognitoIdentityProvider extends IdentityProviderService {
  private readonly client: CognitoIdentityProviderClient;

  constructor(
    private readonly region: string,
    private readonly userPoolId: string,
    private readonly webClientId: string,
    private readonly webClientSecret: string,
  ) {
    super();
    this.client = new CognitoIdentityProviderClient({ region });
  }

  // -- Helpers --------------------------------------------------------------

  private get cfg(): CognitoClientConfig {
    return {
      client: this.client,
      userPoolId: this.userPoolId,
      webClientId: this.webClientId,
      computeSecretHash: (u) => this.computeSecretHash(u),
    };
  }

  private computeSecretHash(username: string): string {
    return createHmac('sha256', this.webClientSecret)
      .update(username + this.webClientId)
      .digest('base64');
  }

  // -- Auth flows -----------------------------------------------------------

  /** @see SESS-R-03, D-05 */
  async startEmailOtp(input: {
    email: string;
    locale?: string;
  }): Promise<{ session: string; username: string } | null> {
    try {
      const res = await this.client.send(
        new AdminInitiateAuthCommand({
          UserPoolId: this.userPoolId,
          ClientId: this.webClientId,
          AuthFlow: 'USER_AUTH',
          AuthParameters: {
            USERNAME: input.email,
            PREFERRED_CHALLENGE: 'EMAIL_OTP',
            SECRET_HASH: this.computeSecretHash(input.email),
          },
          ClientMetadata: input.locale ? { locale: input.locale } : undefined,
        }),
      );
      return {
        session: res.Session ?? '',
        username:
          res.ChallengeParameters?.['USER_ID_FOR_SRP'] ?? input.email,
      };
    } catch (err) {
      if ((err as { name?: string }).name === 'UserNotFoundException') {
        return null;
      }
      mapCognitoError(err, 'auth');
    }
  }

  async respondEmailOtp(input: {
    session: string;
    username: string;
    code: string;
  }): Promise<AuthOutcome> {
    try {
      const res = await this.client.send(
        new AdminRespondToAuthChallengeCommand({
          UserPoolId: this.userPoolId,
          ClientId: this.webClientId,
          ChallengeName: 'EMAIL_OTP',
          Session: input.session,
          ChallengeResponses: {
            USERNAME: input.username,
            EMAIL_OTP_CODE: input.code,
            SECRET_HASH: this.computeSecretHash(input.username),
          },
        }),
      );
      return parseAuthResult(res, input.username);
    } catch (err) {
      mapCognitoError(err, 'auth');
    }
  }

  async startPassword(input: {
    email: string;
    password: string;
  }): Promise<AuthOutcome> {
    try {
      const res = await this.client.send(
        new AdminInitiateAuthCommand({
          UserPoolId: this.userPoolId,
          ClientId: this.webClientId,
          AuthFlow: 'ADMIN_USER_PASSWORD_AUTH',
          AuthParameters: {
            USERNAME: input.email,
            PASSWORD: input.password,
            SECRET_HASH: this.computeSecretHash(input.email),
          },
        }),
      );
      return parseAuthResult(res, input.email);
    } catch (err) {
      mapCognitoError(err, 'auth');
    }
  }

  async respondTotp(input: {
    session: string;
    username: string;
    code: string;
  }): Promise<AuthOutcome> {
    try {
      const res = await this.client.send(
        new AdminRespondToAuthChallengeCommand({
          UserPoolId: this.userPoolId,
          ClientId: this.webClientId,
          ChallengeName: 'SOFTWARE_TOKEN_MFA',
          Session: input.session,
          ChallengeResponses: {
            USERNAME: input.username,
            SOFTWARE_TOKEN_MFA_CODE: input.code,
            SECRET_HASH: this.computeSecretHash(input.username),
          },
        }),
      );
      return parseAuthResult(res, input.username);
    } catch (err) {
      mapCognitoError(err, 'auth');
    }
  }

  async respondNewPassword(input: {
    session: string;
    username: string;
    newPassword: string;
  }): Promise<AuthOutcome> {
    try {
      const res = await this.client.send(
        new AdminRespondToAuthChallengeCommand({
          UserPoolId: this.userPoolId,
          ClientId: this.webClientId,
          ChallengeName: 'NEW_PASSWORD_REQUIRED',
          Session: input.session,
          ChallengeResponses: {
            USERNAME: input.username,
            NEW_PASSWORD: input.newPassword,
            SECRET_HASH: this.computeSecretHash(input.username),
          },
        }),
      );
      return parseAuthResult(res, input.username);
    } catch (err) {
      mapCognitoError(err, 'auth');
    }
  }

  async completeMfaSetup(input: {
    session: string;
    username: string;
  }): Promise<AuthOutcome> {
    try {
      const res = await this.client.send(
        new AdminRespondToAuthChallengeCommand({
          UserPoolId: this.userPoolId,
          ClientId: this.webClientId,
          ChallengeName: 'MFA_SETUP',
          Session: input.session,
          ChallengeResponses: {
            USERNAME: input.username,
            SECRET_HASH: this.computeSecretHash(input.username),
          },
        }),
      );
      return parseAuthResult(res, input.username);
    } catch (err) {
      mapCognitoError(err, 'auth');
    }
  }

  // -- TOTP management ------------------------------------------------------

  async associateSoftwareToken(input: {
    session?: string;
    accessToken?: string;
  }): Promise<{ secretCode: string; session?: string }> {
    try {
      const res = await this.client.send(
        new AssociateSoftwareTokenCommand({
          Session: input.session,
          AccessToken: input.accessToken,
        }),
      );
      return {
        secretCode: res.SecretCode!,
        session: res.Session ?? undefined,
      };
    } catch (err) {
      mapCognitoError(err);
    }
  }

  async verifySoftwareToken(input: {
    session?: string;
    accessToken?: string;
    code: string;
    friendlyDeviceName?: string;
  }): Promise<{ session?: string }> {
    try {
      const res = await this.client.send(
        new VerifySoftwareTokenCommand({
          Session: input.session,
          AccessToken: input.accessToken,
          UserCode: input.code,
          FriendlyDeviceName: input.friendlyDeviceName,
        }),
      );
      return { session: res.Session ?? undefined };
    } catch (err) {
      mapCognitoError(err);
    }
  }

  async setTotpPreferred(_input: { accessToken: string }): Promise<void> {
    try {
      await this.client.send(
        new AdminSetUserMFAPreferenceCommand({
          UserPoolId: this.userPoolId,
          Username: 'unused', // SDK requires it but uses access token
          SoftwareTokenMfaSettings: {
            Enabled: true,
            PreferredMfa: true,
          },
        }),
      );
    } catch (err) {
      mapCognitoError(err);
    }
  }

  // -- Token management -----------------------------------------------------

  /** @see SESS-R-14, 3.6.5 Renewal */
  async refresh(input: {
    refreshToken: string;
    username?: string;
  }): Promise<TokenSet> {
    try {
      const res = await this.client.send(
        new GetTokensFromRefreshTokenCommand({
          ClientId: this.webClientId,
          ClientSecret: this.webClientSecret,
          RefreshToken: input.refreshToken,
        }),
      );
      return {
        accessToken: res.AuthenticationResult!.AccessToken!,
        idToken: res.AuthenticationResult!.IdToken!,
        refreshToken: res.AuthenticationResult!.RefreshToken ?? null,
        expiresIn: res.AuthenticationResult!.ExpiresIn ?? 900,
      };
    } catch (err) {
      mapCognitoError(err, 'auth');
    }
  }

  async revokeRefreshToken(refreshToken: string): Promise<void> {
    try {
      await this.client.send(
        new RevokeTokenCommand({
          Token: refreshToken,
          ClientId: this.webClientId,
          ClientSecret: this.webClientSecret,
        }),
      );
    } catch (err) {
      mapCognitoError(err);
    }
  }

  async globalSignOut(username: string): Promise<void> {
    try {
      await this.client.send(
        new AdminUserGlobalSignOutCommand({
          UserPoolId: this.userPoolId,
          Username: username,
        }),
      );
    } catch (err) {
      mapCognitoError(err);
    }
  }

  // -- User management (delegated to cognito-user-ops.ts) -------------------

  async disableUser(username: string): Promise<void> {
    return cognitoDisableUser(this.cfg, username);
  }

  async enableUser(username: string): Promise<void> {
    return cognitoEnableUser(this.cfg, username);
  }

  /** @see D-03, T-1.5 */
  async createUser(input: {
    email: string;
    locale: string;
    emailVerified: boolean;
    temporaryPassword?: string;
    suppressMessage: boolean;
  }): Promise<{ username: string; sub: string }> {
    return cognitoCreateUser(this.cfg, input);
  }

  async deleteUser(username: string): Promise<void> {
    return cognitoDeleteUser(this.cfg, username);
  }

  async findUserByEmail(email: string): Promise<IdpUser | null> {
    return cognitoFindUserByEmail(this.cfg, email);
  }

  async forgotPassword(email: string): Promise<void> {
    return cognitoForgotPassword(this.cfg, email);
  }

  async confirmForgotPassword(input: {
    email: string;
    code: string;
    newPassword: string;
  }): Promise<void> {
    return cognitoConfirmForgotPassword(this.cfg, input);
  }
}
