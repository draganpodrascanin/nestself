import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { UserMenu } from './user-menu';
import { EMPLOYEE, SIGN_IN_TEXT, makeAuth, passwordPrincipal, renderAccount, t } from './account-test-harness';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const trigger = (name: string) =>
  screen.findByRole('button', { name: t('auth:account.userMenu.open', { name }) });

describe('UserMenu', () => {
  it('shows the display name and context label', async () => {
    const user = userEvent.setup();
    renderAccount(<UserMenu />, makeAuth({ principal: EMPLOYEE }), '/');
    await user.click(await trigger(EMPLOYEE.displayName));
    const menu = await screen.findByRole('menu');
    expect(menu).toHaveTextContent(EMPLOYEE.displayName);
    expect(menu).toHaveTextContent(t(`auth:account.userMenu.context.${EMPLOYEE.context.kind}`));
  });

  it('labels the operations context', async () => {
    const user = userEvent.setup();
    const principal = passwordPrincipal(true);
    renderAccount(<UserMenu />, makeAuth({ principal: { ...principal, context: { kind: 'operations' } } }), '/');
    await user.click(await trigger(principal.displayName));
    expect(await screen.findByRole('menu')).toHaveTextContent(t('auth:account.userMenu.context.operations'));
  });

  it('opens Settings', async () => {
    const user = userEvent.setup();
    const { router } = renderAccount(<UserMenu />, makeAuth(), '/');
    await user.click(await trigger(EMPLOYEE.displayName));
    await user.click(await screen.findByRole('menuitem', { name: t('auth:account.userMenu.settings') }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/settings'));
  });

  it('signs out and lands on /sign-in', async () => {
    const user = userEvent.setup();
    const auth = makeAuth();
    const { router } = renderAccount(<UserMenu />, auth, '/');
    await user.click(await trigger(EMPLOYEE.displayName));
    await user.click(await screen.findByRole('menuitem', { name: t('auth:account.userMenu.signOut') }));
    expect(await screen.findByText(SIGN_IN_TEXT)).toBeInTheDocument();
    expect(auth.signOut).toHaveBeenCalledTimes(1);
    expect(router.state.location.pathname).toBe('/sign-in');
  });

  it('renders nothing without a principal', async () => {
    renderAccount(
      <>
        <p>ready</p>
        <UserMenu />
      </>,
      makeAuth({ principal: null, status: 'unauthenticated' }),
      '/',
    );
    await screen.findByText('ready');
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});
