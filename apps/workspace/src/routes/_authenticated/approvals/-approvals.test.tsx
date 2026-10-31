/**
 * The approver's dashboard in API mode (T-CW-1.10, D-CW-37): the four facts
 * per item and nothing else, approve, decline with a reason, and every
 * failure as translated copy (load, approve, self-approval, decline). The
 * route is reachable only with `approval.decide`.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SAMPLE_PRINCIPALS } from '@nestself/sample-data';
import en from '@nestself/i18n/locales/en/calls.json';
import common from '@nestself/i18n/locales/en/common.json';

const fetchMock = vi.hoisted(() => {
  const fn = vi.fn<typeof fetch>();
  globalThis.fetch = fn;
  return fn;
});

vi.mock('../../../data-source', () => ({
  dataSource: 'api',
  isSampleDataMode: false,
  resolveDataSource: () => 'api',
}));

vi.mock('../../../calls/user-room-client', () => ({
  userRoomClient: { subscribe: () => () => undefined },
}));

import { routeTree } from '../../../routeTree.gen';
import { api } from '../../../api';
import { initialSnapshot } from '../../../auth';

/** A sample principal switched to the organization context of `orgId`. */
function withOrgContext<T extends { principal: { context: unknown } }>(sample: T, orgId: string): T {
  return { ...sample, principal: { ...sample.principal, context: { kind: 'organization', orgId } } };
}

// Approvals are an organization-workspace screen: the manager has switched to
// "Manage" (Ruling E: managers start in their personal context).
const manager = withOrgContext(SAMPLE_PRINCIPALS.manager, 'org_sample');
const ORG = 'org_sample';
const LIST = `/api/orgs/${ORG}/appointment-approvals`;

function item(overrides: Record<string, unknown> = {}) {
  return {
    id: 'appr_1',
    appointmentId: 'appt_2',
    status: 'pending',
    employeeDisplayName: 'Jovan Petrović',
    description: 'follow-up session with a NestSelf expert',
    startsAt: '2030-03-05T14:00:00.000Z',
    durationMinutes: 50,
    timeZone: 'Europe/Belgrade',
    ...overrides,
  };
}

const json = (status: number, body: unknown) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

interface Sent {
  method: string;
  path: string;
  body: unknown;
}

function serve(routes: Record<string, () => Response>, effectiveActions: readonly string[] = [...manager.effectiveActions, 'approval.decide']) {
  const sent: Sent[] = [];
  fetchMock.mockImplementation((input, init) => {
    if (input === undefined) return Promise.resolve(json(404, { code: 'not_found', message: 'Not found' }));
    const url = new URL(typeof input === 'string' ? input : input instanceof URL ? input.href : input.url, 'http://localhost');
    const method = init?.method ?? 'GET';
    sent.push({ method, path: url.pathname, body: typeof init?.body === 'string' ? JSON.parse(init.body) : undefined });
    if (url.pathname === '/api/auth/me') return Promise.resolve(json(200, { principal: manager.principal, effectiveActions, availableContexts: [manager.principal.context] }));
    const handler = routes[`${method} ${url.pathname}`];
    return Promise.resolve(handler ? handler() : json(404, { code: 'not_found', message: 'Not found' }));
  });
  return sent;
}

function renderAt(path: string) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    context: { queryClient, auth: { principal: null, effectiveActions: [], availableContexts: [], settled: false, ensure: () => initialSnapshot(api) } },
    history: createMemoryHistory({ initialEntries: [path] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
  return router;
}

const approveButton = () => screen.findByRole('button', { name: en.approval.approve }, { timeout: 5000 });

describe('the approvals dashboard (API mode)', () => {
  beforeEach(() => fetchMock.mockReset());
  afterEach(() => cleanup());

  it('lists pending and decided items with the four facts only', async () => {
    serve({ [`GET ${LIST}`]: () => json(200, { items: [item(), item({ id: 'appr_0', status: 'rejected', employeeDisplayName: 'Ana Ilić' })] }) });
    renderAt('/approvals');

    expect(await screen.findByRole('heading', { name: en.approval.title }, { timeout: 5000 })).toBeInTheDocument();
    const pending = await screen.findByRole('region', { name: en.approval.pendingTitle });
    const [card] = within(pending).getAllByRole('listitem');
    expect(within(card!).getByRole('heading', { name: 'Jovan Petrović' })).toBeInTheDocument();
    expect(within(card!).getByText(en.approval.followUpLabel)).toBeInTheDocument();
    expect(within(card!).getByText('50 minutes')).toBeInTheDocument();
    // The time in the appointment's own zone, named next to it (D-CW-37, T-CW-1.5).
    expect(within(card!).getByText(/ at .*\(Europe\/Belgrade\)$/)).toBeInTheDocument();
    expect(within(card!).getByText(en.approval.pending)).toBeInTheDocument();

    const decided = screen.getByRole('region', { name: en.approval.decidedTitle });
    expect(within(decided).getByText('Ana Ilić')).toBeInTheDocument();
    expect(within(decided).getByText(en.approval.rejected)).toBeInTheDocument();
    expect(within(decided).queryByRole('button')).not.toBeInTheDocument();
  });

  it('shows the empty state when nothing waits', async () => {
    serve({ [`GET ${LIST}`]: () => json(200, { items: [] }) });
    renderAt('/approvals');
    expect(await screen.findByText(en.approval.emptyTitle, {}, { timeout: 5000 })).toBeInTheDocument();
  });

  it('approves: the call, the toast and a refreshed list', async () => {
    let items = [item()];
    const sent = serve({
      [`GET ${LIST}`]: () => json(200, { items }),
      'POST /api/appointment-approvals/appr_1/approve': () => {
        items = [item({ status: 'approved' })];
        return json(200, item({ status: 'approved' }));
      },
    });
    renderAt('/approvals');
    const user = userEvent.setup();
    await user.click(await approveButton());

    expect(await screen.findByText(en.approval.approvedToast.replace('{{name}}', 'Jovan Petrović'))).toBeInTheDocument();
    expect(sent.find((s) => s.path === '/api/appointment-approvals/appr_1/approve')).toMatchObject({ method: 'POST', body: {} });
    const decided = await screen.findByRole('region', { name: en.approval.decidedTitle });
    expect(within(decided).getByText(en.approval.approved)).toBeInTheDocument();
  });

  it.each([
    ['self_approval_denied', 403, en.approval.errors.selfApprovalDenied],
    ['approval_not_pending', 409, en.errors.approvalNotPending],
    ['something_new', 500, en.errors.unknown],
  ])('renders a refused approval (%s) as translated copy', async (code, status, message) => {
    serve({
      [`GET ${LIST}`]: () => json(200, { items: [item()] }),
      'POST /api/appointment-approvals/appr_1/approve': () => json(status, { code, message: 'English text for developers' }),
    });
    renderAt('/approvals');
    const user = userEvent.setup();
    await user.click(await approveButton());
    expect(await screen.findByText(message)).toBeInTheDocument();
    expect(screen.getByText(en.approval.decideFailedTitle)).toBeInTheDocument();
    expect(screen.queryByText('English text for developers')).not.toBeInTheDocument();
  });

  it('declines with a reason the dialog checks, and shows a refused decline inside the dialog', async () => {
    let refuse = true;
    const sent = serve({
      [`GET ${LIST}`]: () => json(200, { items: [item()] }),
      'POST /api/appointment-approvals/appr_1/reject': () =>
        refuse
          ? json(409, { code: 'approval_not_pending', message: 'English text for developers' })
          : json(200, item({ status: 'rejected' })),
    });
    renderAt('/approvals');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: en.approval.reject }, { timeout: 5000 }));

    const dialog = await screen.findByRole('alertdialog', { name: en.approval.rejectTitle });
    expect(within(dialog).getByText(en.approval.rejectDescription.replace('{{name}}', 'Jovan Petrović'))).toBeInTheDocument();
    const confirm = within(dialog).getByRole('button', { name: en.approval.reject });
    await user.click(confirm);
    expect((await within(dialog).findAllByText(en.approval.reasonRequired)).length).toBeGreaterThan(0);
    expect(sent.some((s) => s.path.endsWith('/reject'))).toBe(false);

    const reason = within(dialog).getByRole('textbox', { name: new RegExp(en.approval.reasonLabel) });
    await user.click(reason);
    await user.paste('x'.repeat(301));
    await user.click(confirm);
    expect((await within(dialog).findAllByText(en.approval.reasonTooLong)).length).toBeGreaterThan(0);

    await user.clear(reason);
    await user.paste('  Not this month.  ');
    await user.click(confirm);
    expect((await within(dialog).findAllByText(en.errors.approvalNotPending)).length).toBeGreaterThan(0);
    expect(screen.queryByText('English text for developers')).not.toBeInTheDocument();

    refuse = false;
    await user.click(confirm);
    expect(await screen.findByText(en.approval.rejectedToast.replace('{{name}}', 'Jovan Petrović'))).toBeInTheDocument();
    const posted = sent.filter((s) => s.path === '/api/appointment-approvals/appr_1/reject');
    expect(posted.at(-1)?.body).toEqual({ safeReason: 'Not this month.' });
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  }, 20_000);

  it('clears "write a short reason" as soon as the approver types one, and checks again on the next decline', async () => {
    const sent = serve({ [`GET ${LIST}`]: () => json(200, { items: [item()] }) });
    renderAt('/approvals');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: en.approval.reject }, { timeout: 5000 }));
    const dialog = await screen.findByRole('alertdialog', { name: en.approval.rejectTitle });
    const confirm = within(dialog).getByRole('button', { name: en.approval.reject });

    await user.click(confirm);
    expect((await within(dialog).findAllByText(en.approval.reasonRequired)).length).toBeGreaterThan(0);
    const reason = within(dialog).getByRole('textbox', { name: new RegExp(en.approval.reasonLabel) });
    await user.type(reason, 'N');
    // The field message goes at once; the summary animates out, then unmounts.
    await waitFor(() => expect(within(dialog).queryByText(en.approval.reasonRequired)).not.toBeInTheDocument());
    await waitFor(() => expect(within(dialog).queryByText(common.form.errorSummaryTitle)).not.toBeInTheDocument());

    await user.clear(reason);
    await user.type(reason, '   ');
    await user.click(confirm);
    expect((await within(dialog).findAllByText(en.approval.reasonRequired)).length).toBeGreaterThan(0);
    expect(sent.some((s) => s.path.endsWith('/reject'))).toBe(false);
  });

  it('keeps the name in the decline dialog while it closes (exit animation)', async () => {
    serve({ [`GET ${LIST}`]: () => json(200, { items: [item()] }) });
    renderAt('/approvals');
    const user = userEvent.setup();
    await user.click(await screen.findByRole('button', { name: en.approval.reject }, { timeout: 5000 }));
    const dialog = await screen.findByRole('alertdialog', { name: en.approval.rejectTitle });
    const description = en.approval.rejectDescription.replace('{{name}}', 'Jovan Petrović');
    await user.click(within(dialog).getByRole('button', { name: en.approval.cancel }));
    // The dialog stays mounted for its exit animation and keeps its copy meanwhile.
    expect(screen.getByText(description)).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
  });

  it('renders a failed load as translated copy with a retry', async () => {
    let fail = true;
    serve({ [`GET ${LIST}`]: () => (fail ? json(500, { code: 'internal', message: 'English' }) : json(200, { items: [] })) });
    renderAt('/approvals');
    expect(await screen.findByText(en.approval.loadFailedTitle, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText(en.errors.unknown)).toBeInTheDocument();
    fail = false;
    await userEvent.setup().click(screen.getByRole('button', { name: en.approval.retry }));
    expect(await screen.findByText(en.approval.emptyTitle)).toBeInTheDocument();
  });

  it('is not reachable without approval.decide', async () => {
    serve({}, manager.effectiveActions);
    const router = renderAt('/approvals');
    await waitFor(() => expect(router.state.location.pathname).toBe('/'), { timeout: 5000 });
    expect(await screen.findByText(common.state.permission.title)).toBeInTheDocument();
  });

  it('the navigation shows Approvals only with approval.decide', async () => {
    serve({ [`GET ${LIST}`]: () => json(200, { items: [] }) });
    renderAt('/approvals');
    expect((await screen.findAllByRole('link', { name: common.nav.approvals }, { timeout: 5000 })).length).toBeGreaterThan(0);
  });
});
