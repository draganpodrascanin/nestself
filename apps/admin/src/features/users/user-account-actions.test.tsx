import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import { OrgAccessScreen } from '../access/org-access-screen';
import { PlatformAccessScreen } from '../access/platform-access-screen';
import { UserAccessLookup } from '../access/user-access-lookup';
import { OPS_PRINCIPAL, ORG_ID, apiError, makeAuth, makeOpsApi, renderOps, t } from '../organizations/ops-test-harness';
import type { RenderOpts } from '../organizations/ops-test-harness';

const renderLookup = (opts: RenderOpts = {}) =>
  renderOps(
    (opsApi, sampleMode) => <UserAccessLookup opsApi={opsApi} enabled sampleMode={sampleMode} headingLevel={2} />,
    opts,
  );

async function lookUp(user: UserEvent, userId = 'user_stefan') {
  const region = await screen.findByRole('region', { name: t('admin:access.lookup.title') });
  await user.click(within(region).getByLabelText(new RegExp(`^${t('admin:access.lookup.userId')}`)));
  await user.paste(userId);
  await user.click(within(region).getByRole('button', { name: t('admin:access.lookup.submit') }));
  return within(region).findByRole('region', { name: t('admin:users.title') });
}

const SUSPEND = () => t('admin:users.suspend.open');
const REINSTATE = () => t('admin:users.reinstate.open');

async function suspendWith(user: UserEvent, reason: string) {
  await user.click(screen.getByRole('button', { name: SUSPEND() }));
  const dialog = await screen.findByRole('alertdialog', { name: t('admin:users.suspend.title') });
  if (reason) {
    await user.click(within(dialog).getByLabelText(new RegExp(`^${t('admin:access.reason.label')}`)));
    await user.paste(reason);
  }
  await user.click(within(dialog).getByRole('button', { name: t('admin:users.suspend.confirm') }));
  return dialog;
}

async function reinstate(user: UserEvent) {
  await user.click(screen.getByRole('button', { name: REINSTATE() }));
  const dialog = await screen.findByRole('alertdialog', { name: t('admin:users.reinstate.title') });
  await user.click(within(dialog).getByRole('button', { name: t('admin:users.reinstate.confirm') }));
  return dialog;
}

describe('user account actions on the access lookup', () => {
  it('appear on the organization access screen', async () => {
    const user = userEvent.setup();
    renderOps((opsApi, sampleMode) => <OrgAccessScreen opsApi={opsApi} orgId={ORG_ID} sampleMode={sampleMode} />);
    const account = await lookUp(user);
    expect(within(account).getByText(t('admin:users.state.active'))).toBeInTheDocument();
    expect(within(account).getByRole('button', { name: SUSPEND() })).toBeInTheDocument();
  });

  it('appear on the platform access screen', async () => {
    const user = userEvent.setup();
    renderOps((opsApi, sampleMode) => <PlatformAccessScreen opsApi={opsApi} sampleMode={sampleMode} />, {
      opsApi: makeOpsApi({ listPlatformGrants: vi.fn().mockResolvedValue({ items: [] }) }),
    });
    const account = await lookUp(user);
    expect(within(account).getByRole('button', { name: SUSPEND() })).toBeInTheDocument();
  });

  it('shows a suspended user with Reinstate instead of Suspend', async () => {
    const user = userEvent.setup();
    renderLookup({
      opsApi: makeOpsApi({ userAccess: vi.fn().mockResolvedValue({ userId: 'user_stefan', suspended: true, contexts: [] }) }),
    });
    const account = await lookUp(user);
    expect(within(account).getByText(t('admin:users.state.suspended'))).toBeInTheDocument();
    expect(within(account).getByRole('button', { name: REINSTATE() })).toBeInTheDocument();
    expect(within(account).queryByRole('button', { name: SUSPEND() })).not.toBeInTheDocument();
  });

  it('offers no Suspend on the signed-in user\'s own account and says why', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderLookup({
      opsApi: makeOpsApi({ userAccess: vi.fn().mockResolvedValue({ userId: OPS_PRINCIPAL.userId, suspended: false, contexts: [] }) }),
    });
    const account = await lookUp(user, OPS_PRINCIPAL.userId);
    expect(within(account).getByText(t('admin:users.suspend.self'))).toBeInTheDocument();
    expect(within(account).queryByRole('button', { name: SUSPEND() })).not.toBeInTheDocument();
    expect(opsApi.suspendUser).not.toHaveBeenCalled();
  });

  it('hides both actions without people.deactivate', async () => {
    const user = userEvent.setup();
    renderLookup({ auth: makeAuth({ effectiveActions: ['access.preview'] }) });
    const account = await lookUp(user);
    expect(within(account).getByText(t('admin:users.state.active'))).toBeInTheDocument();
    expect(within(account).queryByRole('button')).not.toBeInTheDocument();
  });

  it('asks for a reason of 3 to 500 characters before suspending', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderLookup();
    await lookUp(user);
    const dialog = await suspendWith(user, 'no');
    expect(await within(dialog).findAllByText(t('admin:access.errors.reasonLength'))).not.toHaveLength(0);
    expect(opsApi.suspendUser).not.toHaveBeenCalled();
  });

  it('suspends with the reason after a verified step-up, then refetches the lookup', async () => {
    const user = userEvent.setup();
    const suspendUser = vi
      .fn()
      .mockRejectedValueOnce(apiError(403, 'step_up_required'))
      .mockResolvedValueOnce({ userId: 'user_stefan', suspendedAt: '2026-10-25T00:00:00.000Z' });
    const userAccess = vi
      .fn()
      .mockResolvedValueOnce({ userId: 'user_stefan', suspended: false, contexts: [] })
      .mockResolvedValue({ userId: 'user_stefan', suspended: true, contexts: [] });
    const auth = makeAuth();
    renderLookup({ auth, opsApi: makeOpsApi({ suspendUser, userAccess }) });
    const account = await lookUp(user);

    await suspendWith(user, 'Left the client, offboarding');

    await waitFor(() => expect(suspendUser).toHaveBeenCalledTimes(2));
    expect(suspendUser).toHaveBeenLastCalledWith('user_stefan', { reason: 'Left the client, offboarding' });
    expect(auth.stepUp).toHaveBeenCalledTimes(1);
    await waitFor(() => expect(userAccess).toHaveBeenCalledTimes(2));
    expect(await within(account).findByText(t('admin:users.state.suspended'))).toBeInTheDocument();
    expect(within(account).getByRole('button', { name: REINSTATE() })).toBeInTheDocument();
    expect(screen.getByText(t('admin:users.suspend.success', { userId: 'user_stefan' }))).toBeInTheDocument();
  });

  it('reinstates through withStepUp and refetches the lookup', async () => {
    const user = userEvent.setup();
    const reinstateUser = vi
      .fn()
      .mockRejectedValueOnce(apiError(403, 'step_up_required'))
      .mockResolvedValueOnce({ userId: 'user_stefan', reinstatedAt: '2026-10-25T00:00:00.000Z' });
    const userAccess = vi
      .fn()
      .mockResolvedValueOnce({ userId: 'user_stefan', suspended: true, contexts: [] })
      .mockResolvedValue({ userId: 'user_stefan', suspended: false, contexts: [] });
    const auth = makeAuth();
    renderLookup({ auth, opsApi: makeOpsApi({ reinstateUser, userAccess }) });
    const account = await lookUp(user);

    await reinstate(user);

    await waitFor(() => expect(reinstateUser).toHaveBeenCalledTimes(2));
    expect(reinstateUser).toHaveBeenCalledWith('user_stefan');
    expect(auth.stepUp).toHaveBeenCalledTimes(1);
    expect(await within(account).findByText(t('admin:users.state.active'))).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('closes quietly when step-up is cancelled', async () => {
    const user = userEvent.setup();
    renderLookup({
      auth: makeAuth({ stepUp: vi.fn().mockResolvedValue(false) }),
      opsApi: makeOpsApi({ suspendUser: vi.fn().mockRejectedValue(apiError(403, 'step_up_required')) }),
    });
    await lookUp(user);
    await suspendWith(user, 'Offboarding request');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it.each([
    ['not_found', 404, 'notFound'],
    ['conflict', 409, 'conflict'],
    ['cannot_suspend_self', 409, 'cannotSuspendSelf'],
    ['forbidden', 403, 'forbidden'],
    ['rate_limited', 429, 'rateLimited'],
    ['internal_error', 500, 'unknown'],
  ] as const)('keeps the suspend dialog open with the %s failure as users.errors.%s', async (code, status, key) => {
    const user = userEvent.setup();
    renderLookup({ opsApi: makeOpsApi({ suspendUser: vi.fn().mockRejectedValue(apiError(status, code)) }) });
    await lookUp(user);
    const dialog = await suspendWith(user, 'Offboarding request');
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(t(`admin:users.errors.${key}`));
    expect(screen.queryByText(`English ${code}`)).not.toBeInTheDocument();
  });

  it.each([
    ['not_found', 404, 'notFound'],
    ['conflict', 409, 'conflict'],
    ['rate_limited', 429, 'rateLimited'],
    ['internal_error', 500, 'unknown'],
  ] as const)('keeps the reinstate dialog open with the %s failure as users.errors.%s', async (code, status, key) => {
    const user = userEvent.setup();
    renderLookup({
      opsApi: makeOpsApi({
        userAccess: vi.fn().mockResolvedValue({ userId: 'user_stefan', suspended: true, contexts: [] }),
        reinstateUser: vi.fn().mockRejectedValue(apiError(status, code)),
      }),
    });
    await lookUp(user);
    const dialog = await reinstate(user);
    expect(await within(dialog).findByRole('alert')).toHaveTextContent(t(`admin:users.errors.${key}`));
  });

  it('shows the sample user as active with Suspend disabled in sample mode', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderLookup({ sampleMode: true });
    const account = await lookUp(user, 'user_ivana');
    expect(within(account).getByText(t('admin:users.state.active'))).toBeInTheDocument();
    expect(within(account).getByRole('button', { name: SUSPEND() })).toBeDisabled();
    expect(opsApi.userAccess).not.toHaveBeenCalled();
  });
});
