/**
 * /sign-in route -- validates `return` search param and renders SignInPage.
 */
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { SSO_SIGN_IN_REASONS } from '@nestself/contracts';
import { SignInPage } from '../../auth/screens/sign-in-page';

const searchSchema = z.object({
  return: z
    .string()
    .refine((v) => v.startsWith('/') && !v.startsWith('//'), 'Must be a relative path')
    .optional(),
  step: z.enum(['totp_enrol', 'new_password']).optional(),
  /** Set by the API's SSO callback when a federated sign-in could not finish. */
  reason: z.enum(SSO_SIGN_IN_REASONS).optional().catch(undefined),
  /**
   * With `reason=sso_email_unverified`: the opaque handle of the pending
   * sign-in (never the address), sent back to `POST /auth/sso/bind/start`.
   */
  bind: z.string().regex(/^[A-Za-z0-9_-]{32,128}$/).optional().catch(undefined),
});

export const Route = createFileRoute('/_public/sign-in')({
  validateSearch: searchSchema,
  component: SignInRoute,
});

function SignInRoute() {
  const { return: returnPath, reason, bind } = Route.useSearch();
  return <SignInPage returnPath={returnPath} reason={reason} bind={bind} />;
}
