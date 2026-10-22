/**
 * /sign-in route -- validates `return` search param and renders SignInPage.
 */
import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { SignInPage } from '../../auth/screens/sign-in-page';

const searchSchema = z.object({
  return: z
    .string()
    .refine((v) => v.startsWith('/') && !v.startsWith('//'), 'Must be a relative path')
    .optional(),
  step: z.enum(['totp_enrol', 'new_password']).optional(),
});

export const Route = createFileRoute('/_public/sign-in')({
  validateSearch: searchSchema,
  component: SignInRoute,
});

function SignInRoute() {
  const { return: returnPath } = Route.useSearch();
  return <SignInPage returnPath={returnPath} />;
}
