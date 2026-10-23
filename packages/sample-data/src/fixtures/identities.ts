import { SAMPLE_PEOPLE } from './people.ts';

/**
 * Development password for sample staff and experts in the fake identity
 * provider (AUTH_MODE=stub only). Employees sign in with the email code that
 * the API logs. Never used in production: the fake provider refuses to start
 * there.
 */
export const SAMPLE_DEV_PASSWORD = 'Nestself-dev-1234!';

/**
 * One pool-native external identity per sample person, with deterministic
 * subjects so that the fake identity provider and the database seed agree
 * (auth-strategy.md A.3.3, D-04). Emails follow the seed convention
 * `<id>@example.com`.
 */
export const SAMPLE_EXTERNAL_IDENTITIES = SAMPLE_PEOPLE.map((p) => ({
  userId: p.id,
  email: `${p.id}@example.com`,
  provider: 'cognito' as const,
  subject: `sample-sub-${p.id}`,
  cognitoUsername: `sample-${p.id}`,
  /** Staff and experts use the password flow; employees use email codes [D-05]. */
  signIn: p.platformRole ? ('password' as const) : ('email_otp' as const),
  sample: true as const,
}));
