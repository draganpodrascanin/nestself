/**
 * Stub-only stand-in for "Cognito /oauth2/authorize -> employer IdP ->
 * Cognito": `GET /api/auth/sso/_fake/authorize` asks the fake identity
 * provider for an authorization code for a federated user of the connection
 * and redirects straight to the callback (D-12 decision table).
 *
 * Registered only when `AUTH_MODE=stub` (`FakeSsoModule` through
 * `ConditionalModule` in AppModule); the handler also refuses with 404 when
 * the identity provider is not the fake, so a mis-registration cannot mint
 * codes against Cognito.
 *
 * Query: `connection, state, code_challenge, redirect_uri` (what the fake's
 * `buildAuthorizeUrl` sends) and optionally `as=<email>` to choose among the
 * seeded federated users. Without `as` the first seeded user of the provider
 * signs in. An `as` address that is not seeded is created on the fly
 * (`email_verified` true, stable subject derived from the address) so local
 * development and Playwright can sign in any address; `email_verified=false`
 * creates it unverified.
 */
import { Controller, Get, Inject, Query, Res, forwardRef } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { createHash } from 'node:crypto';
import { z } from 'zod';
import { Public } from '../authz/public.decorator.js';
import { ApiHttpException } from '../common/api-error.js';
import { IdentityProviderService } from '../identity/identity-provider.service.js';
import { FakeIdentityProvider } from '../identity/fake-identity-provider.js';
import { apiPublicUrlFrom } from './sso-start-url.js';

const FakeAuthorizeQuerySchema = z.object({
  connection: z.string().min(1).max(64),
  state: z.string().min(1).max(256),
  code_challenge: z.string().min(1).max(256),
  redirect_uri: z.string().url(),
  as: z.string().email().optional(),
  email_verified: z.enum(['true', 'false']).optional(),
});

interface RedirectRes {
  setHeader(name: string, value: string): void;
  redirect(status: number, url: string): void;
}

function notFound(): ApiHttpException {
  return new ApiHttpException({ status: 404, code: 'not_found', message: 'Not found' });
}

@Controller('auth/sso/_fake')
export class FakeSsoAuthorizeController {
  constructor(
    @Inject(forwardRef(() => IdentityProviderService)) private readonly idp: IdentityProviderService,
    @Inject(ConfigService) private readonly config: ConfigService,
  ) {}

  @Public()
  @Get('authorize')
  authorize(@Query() query: unknown, @Res() res: RedirectRes): void {
    if (!(this.idp instanceof FakeIdentityProvider) || this.config.get<string>('AUTH_MODE', 'stub') !== 'stub') {
      throw notFound();
    }
    const parsed = FakeAuthorizeQuerySchema.safeParse(query);
    if (!parsed.success) {
      throw new ApiHttpException({ status: 400, code: 'validation', message: 'Invalid authorize request' });
    }
    const q = parsed.data;
    // Only our own callback: the stub must not become an open redirect.
    const callback = `${apiPublicUrlFrom(this.config.get<string>('API_PUBLIC_URL'))}/api/auth/sso/callback`;
    if (q.redirect_uri !== callback) {
      throw new ApiHttpException({ status: 400, code: 'validation', message: 'Unexpected redirect_uri' });
    }

    const fake = this.idp;
    const users = fake.listFederatedUsers(q.connection);
    let user = q.as ? users.find((u) => u.email === q.as!.trim().toLowerCase()) : users[0];
    if (!user && q.as) {
      const email = q.as.trim().toLowerCase();
      fake.seedFederatedUsers([
        {
          providerName: q.connection,
          subject: `fake-${createHash('sha256').update(email).digest('hex').slice(0, 16)}`,
          email,
          emailVerified: q.email_verified !== 'false',
        },
      ]);
      user = fake.listFederatedUsers(q.connection).find((u) => u.email === email);
    }
    if (!user) throw notFound();

    let code: string;
    try {
      code = fake.issueAuthorizationCode(q.connection, user.subject, q.code_challenge, q.redirect_uri);
    } catch {
      throw notFound();
    }
    const target = new URL(q.redirect_uri);
    target.searchParams.set('code', code);
    target.searchParams.set('state', q.state);
    res.setHeader('Cache-Control', 'no-store');
    res.redirect(302, target.toString());
  }
}
