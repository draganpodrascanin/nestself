import { createFileRoute } from '@tanstack/react-router';
import { z } from 'zod';
import { SignInPage } from '../../auth/screens/sign-in-page';

const searchSchema = z.object({
  return: z
    .string()
    .startsWith('/')
    .refine((v) => !v.startsWith('//'), 'Invalid return path')
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
