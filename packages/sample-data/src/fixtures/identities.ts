import { SAMPLE_PEOPLE } from './people.ts';
import { SAMPLE_EDITORIAL_STAFF } from './editorial-staff.ts';

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
type SignIn = 'password' | 'email_otp';

function identityFor(person: { id: string }, signIn: SignIn) {
  return {
    userId: person.id,
    email: `${person.id}@example.com`,
    provider: 'cognito' as const,
    subject: `sample-sub-${person.id}`,
    cognitoUsername: `sample-${person.id}`,
    signIn,
    sample: true as const,
  };
}

export const SAMPLE_EXTERNAL_IDENTITIES = [
  /** Staff and experts use the password flow; employees use email codes [D-05]. */
  ...SAMPLE_PEOPLE.map((p) => identityFor(p, p.platformRole ? 'password' : 'email_otp')),
  /** Editorial staff are operations staff: password plus authenticator. */
  ...SAMPLE_EDITORIAL_STAFF.map((p) => identityFor(p, 'password')),
];
