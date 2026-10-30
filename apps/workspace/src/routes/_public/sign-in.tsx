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
  /** The address the identity provider asserted (sso_email_unverified only). */
  email: z.string().email().optional().catch(undefined),
});

export const Route = createFileRoute('/_public/sign-in')({
  validateSearch: searchSchema,
  component: SignInRoute,
});

function SignInRoute() {
  const { return: returnPath, reason, email } = Route.useSearch();
  return <SignInPage returnPath={returnPath} reason={reason} email={email} />;
}
