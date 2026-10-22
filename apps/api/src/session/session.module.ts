/**
 * Session module: session lifecycle, cookies and CSRF.
 *
 * @see D-06, T-1.3
 */
import { Module } from '@nestjs/common';
import { SessionService } from './session.service.js';
import { SessionCookies } from './session-cookie.js';
import { TokenCipher } from './token-cipher.js';
import { CsrfGuard } from './csrf.guard.js';
import { IdentityModule } from '../identity/identity.module.js';

@Module({
  imports: [IdentityModule],
  providers: [SessionService, SessionCookies, TokenCipher, CsrfGuard],
  exports: [SessionService, SessionCookies, TokenCipher, CsrfGuard],
})
export class SessionModule {}
