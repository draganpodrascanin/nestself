/**
 * SPIKE-01: can email OTP run headlessly against a Cognito Essentials pool?
 *
 * Calls AdminInitiateAuth (USER_AUTH, PREFERRED_CHALLENGE=EMAIL_OTP) on the confidential web
 * client, waits for the code on stdin, then AdminRespondToAuthChallenge (EMAIL_OTP).
 * Go: tokens are returned without any managed-login interaction (D-05, SESS-R-03).
 *
 * Usage (from the repo root, with apps/api/.env filled in):
 *   pnpm --filter @nestself/api exec tsx scripts/spikes/spike-01-email-otp.ts <email> [--create]
 *
 * --create first provisions the user with AdminCreateUser (MessageAction SUPPRESS, email_verified true),
 * which is exactly how invitation acceptance creates employees (D-03). Never prints tokens or secrets.
 */
import 'dotenv/config';
import { createHmac } from 'node:crypto';
import { createInterface } from 'node:readline/promises';
import { stdin, stdout } from 'node:process';
import {
  AdminCreateUserCommand,
  AdminInitiateAuthCommand,
  AdminRespondToAuthChallengeCommand,
  CognitoIdentityProviderClient,
  GetTokensFromRefreshTokenCommand,
  RevokeTokenCommand,
  UsernameExistsException,
} from '@aws-sdk/client-cognito-identity-provider';

function required(name: string): string {
  const value = process.env[name];
  if (!value) {
    console.error(`Missing ${name} in apps/api/.env`);
    process.exit(2);
  }
  return value;
}

const region = required('COGNITO_REGION');
const userPoolId = required('COGNITO_USER_POOL_ID');
const clientId = required('COGNITO_WEB_CLIENT_ID');
const clientSecret = required('COGNITO_WEB_CLIENT_SECRET');

const [, , emailArg, ...flags] = process.argv;
if (!emailArg) {
  console.error('Usage: spike-01-email-otp.ts <email> [--create]');
  process.exit(2);
}
const email = emailArg.trim().toLowerCase();
const create = flags.includes('--create');

const client = new CognitoIdentityProviderClient({ region });

function secretHash(username: string): string {
  return createHmac('sha256', clientSecret).update(username + clientId).digest('base64');
}

function claims(jwt: string): Record<string, unknown> {
  const payload = jwt.split('.')[1] ?? '';
  return JSON.parse(Buffer.from(payload, 'base64url').toString('utf8')) as Record<string, unknown>;
}

async function main(): Promise<void> {
  const startedAt = Date.now();
  if (create) {
    try {
      await client.send(
        new AdminCreateUserCommand({
          UserPoolId: userPoolId,
          Username: email,
          MessageAction: 'SUPPRESS',
          UserAttributes: [
            { Name: 'email', Value: email },
            { Name: 'email_verified', Value: 'true' },
          ],
        }),
      );
      console.log(`created ${email} (no welcome email sent)`);
    } catch (error) {
      if (error instanceof UsernameExistsException) {
        console.log(`${email} already exists; continuing`);
      } else {
        throw error;
      }
    }
  }

  const initiate = await client.send(
    new AdminInitiateAuthCommand({
      UserPoolId: userPoolId,
      ClientId: clientId,
      AuthFlow: 'USER_AUTH',
      AuthParameters: {
        USERNAME: email,
        PREFERRED_CHALLENGE: 'EMAIL_OTP',
        SECRET_HASH: secretHash(email),
      },
    }),
  );
  console.log(`AdminInitiateAuth -> challenge=${initiate.ChallengeName ?? 'none'} in ${Date.now() - startedAt} ms`);
  if (initiate.ChallengeName !== 'EMAIL_OTP' || !initiate.Session) {
    console.error('NO-GO: expected an EMAIL_OTP challenge. Response parameters:', initiate.ChallengeParameters);
    process.exit(1);
  }
  const username = initiate.ChallengeParameters?.USERNAME ?? email;

  const rl = createInterface({ input: stdin, output: stdout });
  const code = (await rl.question('Enter the 6-digit code from the email: ')).trim();
  rl.close();

  const respond = await client.send(
    new AdminRespondToAuthChallengeCommand({
      UserPoolId: userPoolId,
      ClientId: clientId,
      ChallengeName: 'EMAIL_OTP',
      Session: initiate.Session,
      ChallengeResponses: {
        USERNAME: username,
        EMAIL_OTP_CODE: code,
        SECRET_HASH: secretHash(username),
      },
    }),
  );
  const result = respond.AuthenticationResult;
  if (!result?.AccessToken || !result.IdToken) {
    console.error('NO-GO: no tokens returned; next challenge:', respond.ChallengeName);
    process.exit(1);
  }
  const access = claims(result.AccessToken);
  const id = claims(result.IdToken);
  console.log('GO: tokens issued headlessly.');
  console.log({
    access: { sub: access.sub, token_use: access.token_use, exp: access.exp, jti: access.jti, origin_jti: access.origin_jti },
    id: { email: id.email, email_verified: id.email_verified, auth_time: id.auth_time },
    refreshTokenPresent: Boolean(result.RefreshToken),
    expiresIn: result.ExpiresIn,
  });

  // Refresh token rotation (D-06, D-09): the web client has rotation on with a 10 s grace period and,
  // per the CDK L2, no ALLOW_REFRESH_TOKEN_AUTH flow; the session service relies on this API instead.
  if (result.RefreshToken) {
    const refreshed = await client.send(
      new GetTokensFromRefreshTokenCommand({
        ClientId: clientId,
        ClientSecret: clientSecret,
        RefreshToken: result.RefreshToken,
      }),
    );
    const rotated = refreshed.AuthenticationResult?.RefreshToken;
    console.log({
      refresh: rotated ? 'GO: GetTokensFromRefreshToken rotated the refresh token' : 'WARN: no new refresh token (rotation off?)',
      newAccessToken: Boolean(refreshed.AuthenticationResult?.AccessToken),
    });
    await client.send(
      new RevokeTokenCommand({ ClientId: clientId, ClientSecret: clientSecret, Token: rotated ?? result.RefreshToken }),
    );
    console.log('revoked the refresh token (RevokeToken)');
  }
}

main().catch((error: unknown) => {
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : String(error);
  console.error(`${name}: ${message}`);
  process.exit(1);
});
