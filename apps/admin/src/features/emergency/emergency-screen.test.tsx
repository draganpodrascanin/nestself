import { describe, it, expect, vi } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { UserEvent } from '@testing-library/user-event';
import type { EmergencyAccessResponse, EmergencyRecordResponse } from '@nestself/contracts';
import { SAMPLE_EMERGENCY_ACCESS } from '@nestself/sample-data';
import { EmergencyScreen } from './emergency-screen';
import { OPS_PRINCIPAL, STAFF_ACTIONS, apiError, choose, makeAuth, makeOpsApi, renderOps, t } from '../organizations/ops-test-harness';
import type { RenderOpts } from '../organizations/ops-test-harness';

const ME = OPS_PRINCIPAL.userId;
const OTHER = 'user_nikola';
const iso = (offsetMinutes: number) => new Date(Date.now() + offsetMinutes * 60_000).toISOString();

function access(id: string, overrides: Partial<EmergencyAccessResponse> = {}): EmergencyAccessResponse {
  return {
    id,
    userId: OTHER,
    approvedByUserId: null,
    approvedAt: null,
    purpose: `Purpose of ${id} for the test`,
    scopeKind: 'CASE',
    scopeId: 'case_sample',
    durationMinutes: 60,
    grantedAt: iso(-5),
    expiresAt: iso(55),
    revokedAt: null,
    ...overrides,
  };
}

const approved = (by: string) => ({ approvedByUserId: by, approvedAt: iso(-5) });

const PENDING_OTHER = access('ea_pending_other');
const PENDING_MINE = access('ea_pending_mine', { userId: ME });
const ACTIVE_MINE = access('ea_active_mine', { userId: ME, ...approved(OTHER), expiresAt: iso(90) });
const ACTIVE_OTHER = access('ea_active_other', { ...approved(ME), scopeKind: 'USER_RECORDS', scopeId: 'user_jovan' });
const EXPIRED = access('ea_expired', { userId: ME, ...approved(OTHER), expiresAt: iso(-10) });
const REVOKED = access('ea_revoked', { ...approved(ME), revokedAt: iso(-1) });
const ALL = [PENDING_OTHER, PENDING_MINE, ACTIVE_MINE, ACTIVE_OTHER, EXPIRED, REVOKED];

const CONVERSATION: EmergencyRecordResponse = {
  emergencyAccessId: ACTIVE_MINE.id,
  recordType: 'conversation',
  recordId: 'conv_sample',
  content: {
    id: 'conv_sample',
    caseId: 'case_sample',
    orgId: 'org_sample',
    messages: [{ id: 'm1', authorUserId: 'user_jovan', body: 'Confidential test message body', createdAt: iso(-60) }],
  },
};
const INTAKE: EmergencyRecordResponse = {
  emergencyAccessId: ACTIVE_MINE.id,
  recordType: 'intake',
  recordId: 'intake_sample',
  content: { id: 'intake_sample', caseId: 'case_sample', orgId: 'org_sample', body: 'Confidential intake body', createdAt: iso(-90) },
};

function emergencyApi(overrides: Record<string, unknown> = {}) {
  return makeOpsApi({
    listEmergencyAccess: vi.fn().mockResolvedValue({ items: ALL }),
    requestEmergencyAccess: vi.fn().mockResolvedValue(access('ea_new', { userId: ME })),
    approveEmergencyAccess: vi.fn().mockResolvedValue(access(PENDING_OTHER.id, approved(ME))),
    denyEmergencyAccess: vi.fn().mockResolvedValue(undefined),
    revokeEmergencyAccess: vi.fn().mockResolvedValue(access(ACTIVE_OTHER.id, { ...approved(ME), revokedAt: iso(0) })),
    readEmergencyRecord: vi.fn().mockResolvedValue(CONVERSATION),
    ...overrides,
  });
}

const renderScreen = (opts: RenderOpts = {}) =>
  renderOps((opsApi, sampleMode) => <EmergencyScreen opsApi={opsApi} sampleMode={sampleMode} />, {
    opsApi: opts.opsApi ?? emergencyApi(),
    ...(opts.auth ? { auth: opts.auth } : {}),
    ...(opts.sampleMode !== undefined ? { sampleMode: opts.sampleMode } : {}),
  });

const rowOf = async (id: string) => screen.findByTestId(`emergency-row-${id}`);
const button = (row: HTMLElement, key: string) => within(row).queryByRole('button', { name: t(key) });

// ---------------------------------------------------------------------------
// List
// ---------------------------------------------------------------------------

describe('EmergencyScreen list', () => {
  it('shows status, requester, approver, scope, purpose and a countdown', async () => {
    const { opsApi } = renderScreen();
    const active = await rowOf(ACTIVE_MINE.id);
    expect(opsApi.listEmergencyAccess).toHaveBeenCalled();
    expect(within(active).getByText(t('admin:emergency.statuses.active'))).toBeInTheDocument();
    expect(within(active).getByText(t('admin:emergency.you', { userId: ME }))).toBeInTheDocument();
    expect(within(active).getByText(OTHER)).toBeInTheDocument();
    expect(within(active).getByText(t('admin:emergency.scopeKinds.CASE'))).toBeInTheDocument();
    expect(within(active).getByText('case_sample')).toBeInTheDocument();
    expect(within(active).getByText(ACTIVE_MINE.purpose)).toBeInTheDocument();
    expect(within(active).getByText(/1 h 30 min left/)).toBeInTheDocument();

    const pending = await rowOf(PENDING_OTHER.id);
    expect(within(pending).getByText(t('admin:emergency.statuses.pending'))).toBeInTheDocument();
    expect(within(pending).getByText(t('admin:emergency.notApproved'))).toBeInTheDocument();
    expect(within(pending).getByText(t('admin:emergency.expiry.pending', { minutes: 60 }))).toBeInTheDocument();

    expect(within(await rowOf(EXPIRED.id)).getByText(t('admin:emergency.statuses.expired'))).toBeInTheDocument();
    expect(within(await rowOf(REVOKED.id)).getByText(t('admin:emergency.statuses.revoked'))).toBeInTheDocument();
  });

  it('offers Approve and Deny only on pending requests by someone else, Revoke on active ones', async () => {
    renderScreen();
    const pendingOther = await rowOf(PENDING_OTHER.id);
    expect(button(pendingOther, 'admin:emergency.approve.open')).toBeInTheDocument();
    expect(button(pendingOther, 'admin:emergency.deny.open')).toBeInTheDocument();

    const pendingMine = await rowOf(PENDING_MINE.id);
    expect(button(pendingMine, 'admin:emergency.approve.open')).not.toBeInTheDocument();
    expect(button(pendingMine, 'admin:emergency.deny.open')).not.toBeInTheDocument();
    expect(within(pendingMine).getByText(t('admin:emergency.waiting'))).toBeInTheDocument();

    expect(button(await rowOf(ACTIVE_OTHER.id), 'admin:emergency.revoke.open')).toBeInTheDocument();
    expect(button(await rowOf(ACTIVE_MINE.id), 'admin:emergency.revoke.open')).toBeInTheDocument();
    for (const id of [EXPIRED.id, REVOKED.id]) {
      const row = await rowOf(id);
      expect(within(row).queryAllByRole('button')).toHaveLength(0);
    }
  });

  it('filters by status', async () => {
    const user = userEvent.setup();
    renderScreen();
    await rowOf(PENDING_OTHER.id);
    await choose(user, t('admin:emergency.filter'), t('admin:emergency.statuses.active'));
    await waitFor(() => expect(screen.queryByTestId(`emergency-row-${PENDING_OTHER.id}`)).not.toBeInTheDocument());
    expect(screen.getByTestId(`emergency-row-${ACTIVE_MINE.id}`)).toBeInTheDocument();
    expect(screen.getByTestId(`emergency-row-${ACTIVE_OTHER.id}`)).toBeInTheDocument();
    expect(screen.queryByTestId(`emergency-row-${EXPIRED.id}`)).not.toBeInTheDocument();
  });

  it('says when no record has the chosen status', async () => {
    const user = userEvent.setup();
    renderScreen({ opsApi: emergencyApi({ listEmergencyAccess: vi.fn().mockResolvedValue({ items: [PENDING_OTHER] }) }) });
    await rowOf(PENDING_OTHER.id);
    await choose(user, t('admin:emergency.filter'), t('admin:emergency.statuses.revoked'));
    expect(await screen.findByText(t('admin:emergency.noMatch'))).toBeInTheDocument();
  });

  it('says when nothing was requested', async () => {
    renderScreen({ opsApi: emergencyApi({ listEmergencyAccess: vi.fn().mockResolvedValue({ items: [] }) }) });
    expect(await screen.findByText(t('admin:emergency.empty'))).toBeInTheDocument();
  });

  it.each([
    [apiError(403, 'forbidden'), 'admin:emergency.errors.forbidden'],
    [apiError(429, 'rate_limited'), 'admin:emergency.errors.rateLimited'],
    [apiError(500, 'internal'), 'admin:emergency.errors.unknown'],
  ])('shows a failed list load as translated copy (%s)', async (err, key) => {
    renderScreen({ opsApi: emergencyApi({ listEmergencyAccess: vi.fn().mockRejectedValue(err) }) });
    expect(await screen.findByText(t(key))).toBeInTheDocument();
    expect(screen.getByText(t('admin:emergency.errors.loadTitle'))).toBeInTheDocument();
    expect(screen.queryByText(/English/)).not.toBeInTheDocument();
  });

  it('shows the permission block without audit.read and never calls the API', async () => {
    const opsApi = emergencyApi();
    renderScreen({ opsApi, auth: makeAuth({ effectiveActions: STAFF_ACTIONS.filter((a) => a !== 'audit.read') }) });
    expect(await screen.findByText(t('common:state.permission.title'))).toBeInTheDocument();
    expect(opsApi.listEmergencyAccess).not.toHaveBeenCalled();
  });

  it('hides Request without access.emergency.request and the decisions without access.emergency.approve', async () => {
    renderScreen({
      auth: makeAuth({
        effectiveActions: STAFF_ACTIONS.filter((a) => a !== 'access.emergency.request' && a !== 'access.emergency.approve'),
      }),
    });
    const pendingOther = await rowOf(PENDING_OTHER.id);
    expect(button(pendingOther, 'admin:emergency.approve.open')).not.toBeInTheDocument();
    expect(button(await rowOf(ACTIVE_OTHER.id), 'admin:emergency.revoke.open')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('admin:emergency.request.open') })).not.toBeInTheDocument();
    // The requester can still read under their own active access.
    expect(button(await rowOf(ACTIVE_MINE.id), 'admin:emergency.record.open')).toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

describe('EmergencyScreen request dialog', () => {
  async function openRequest(user: UserEvent) {
    await rowOf(PENDING_OTHER.id);
    await user.click(screen.getByRole('button', { name: t('admin:emergency.request.open') }));
    return screen.findByRole('dialog', { name: t('admin:emergency.request.title') });
  }

  async function fill(user: UserEvent, dialog: HTMLElement, purpose: string, scopeId: string) {
    if (purpose) {
      await user.click(within(dialog).getByRole('textbox', { name: new RegExp(`^${t('admin:emergency.request.purpose')}`) }));
      await user.paste(purpose);
    }
    if (scopeId) {
      await user.click(within(dialog).getByRole('textbox', { name: new RegExp(`^${t('admin:emergency.request.caseId')}`) }));
      await user.paste(scopeId);
    }
  }

  const submit = (user: UserEvent, dialog: HTMLElement) =>
    user.click(within(dialog).getByRole('button', { name: t('admin:emergency.request.submit') }));

  it('requires a purpose of at least 10 characters and a scope id', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderScreen();
    const dialog = await openRequest(user);
    await fill(user, dialog, 'too short', '');
    await submit(user, dialog);
    expect((await within(dialog).findAllByText(t('admin:emergency.errors.purposeLength'))).length).toBeGreaterThan(0);
    expect(within(dialog).getAllByText(t('admin:emergency.errors.scopeIdRequired')).length).toBeGreaterThan(0);
    expect(opsApi.requestEmergencyAccess).not.toHaveBeenCalled();
  });

  it('sends purpose, scope kind, scope id and duration, retrying once after step-up', async () => {
    const user = userEvent.setup();
    const requestEmergencyAccess = vi
      .fn()
      .mockRejectedValueOnce(apiError(403, 'step_up_required'))
      .mockResolvedValueOnce(access('ea_new', { userId: ME }));
    const { opsApi, auth } = renderScreen({ opsApi: emergencyApi({ requestEmergencyAccess }) });
    const dialog = await openRequest(user);
    await fill(user, dialog, '  Safety concern reported on this case  ', '');
    await user.click(within(dialog).getByRole('radio', { name: t('admin:emergency.scopeKinds.USER_RECORDS') }));
    await user.click(within(dialog).getByRole('textbox', { name: new RegExp(`^${t('admin:emergency.request.userId')}`) }));
    await user.paste('user_jovan');
    await choose(user, t('admin:emergency.request.duration'), t('admin:emergency.minutes', { minutes: 60 }));
    await submit(user, dialog);

    await waitFor(() => expect(requestEmergencyAccess).toHaveBeenCalledTimes(2));
    expect(auth.stepUp).toHaveBeenCalledTimes(1);
    expect(requestEmergencyAccess).toHaveBeenLastCalledWith({
      purpose: 'Safety concern reported on this case',
      scopeKind: 'USER_RECORDS',
      scopeId: 'user_jovan',
      durationMinutes: 60,
    });
    expect(await screen.findByText(t('admin:emergency.request.success'))).toBeInTheDocument();
    await waitFor(() => expect(opsApi.listEmergencyAccess).toHaveBeenCalledTimes(2));
  });

  it('defaults the duration to four hours', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderScreen();
    const dialog = await openRequest(user);
    await fill(user, dialog, 'Safety concern reported on this case', 'case_sample');
    await submit(user, dialog);
    await waitFor(() =>
      expect(opsApi.requestEmergencyAccess).toHaveBeenCalledWith(expect.objectContaining({ scopeKind: 'CASE', durationMinutes: 240 })),
    );
  });

  it.each([
    [apiError(400, 'validation'), 'admin:emergency.errors.validation'],
    [apiError(403, 'forbidden'), 'admin:emergency.errors.forbidden'],
    [apiError(429, 'rate_limited'), 'admin:emergency.errors.rateLimited'],
    [apiError(500, 'internal'), 'admin:emergency.errors.unknown'],
  ])('shows a failed request in the dialog (%s)', async (err, key) => {
    const user = userEvent.setup();
    renderScreen({ opsApi: emergencyApi({ requestEmergencyAccess: vi.fn().mockRejectedValue(err) }) });
    const dialog = await openRequest(user);
    await fill(user, dialog, 'Safety concern reported on this case', 'case_sample');
    await submit(user, dialog);
    expect((await within(dialog).findAllByText(t(key))).length).toBeGreaterThan(0);
  });

  it('closes quietly when step-up is cancelled', async () => {
    const user = userEvent.setup();
    const requestEmergencyAccess = vi.fn().mockRejectedValue(apiError(403, 'step_up_required'));
    renderScreen({
      opsApi: emergencyApi({ requestEmergencyAccess }),
      auth: makeAuth({ stepUp: vi.fn().mockResolvedValue(false) }),
    });
    const dialog = await openRequest(user);
    await fill(user, dialog, 'Safety concern reported on this case', 'case_sample');
    await submit(user, dialog);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: t('admin:emergency.request.title') })).not.toBeInTheDocument());
    expect(screen.queryByText(t('admin:emergency.errors.unknown'))).not.toBeInTheDocument();
    expect(requestEmergencyAccess).toHaveBeenCalledTimes(1);
  });
});

// ---------------------------------------------------------------------------
// Approve, deny, revoke
// ---------------------------------------------------------------------------

describe('EmergencyScreen decisions', () => {
  async function decide(user: UserEvent, rowId: string, decision: 'approve' | 'deny' | 'revoke') {
    const row = await rowOf(rowId);
    await user.click(button(row, `admin:emergency.${decision}.open`)!);
    const dialog = await screen.findByRole('alertdialog', { name: t(`admin:emergency.${decision}.title`) });
    await user.click(within(dialog).getByRole('button', { name: t(`admin:emergency.${decision}.confirm`) }));
    return dialog;
  }

  it('approves through step-up and refreshes the list', async () => {
    const user = userEvent.setup();
    const approveEmergencyAccess = vi
      .fn()
      .mockRejectedValueOnce(apiError(403, 'step_up_required'))
      .mockResolvedValueOnce(access(PENDING_OTHER.id, approved(ME)));
    const { opsApi, auth } = renderScreen({ opsApi: emergencyApi({ approveEmergencyAccess }) });
    await decide(user, PENDING_OTHER.id, 'approve');
    await waitFor(() => expect(approveEmergencyAccess).toHaveBeenCalledTimes(2));
    expect(approveEmergencyAccess).toHaveBeenLastCalledWith(PENDING_OTHER.id);
    expect(auth.stepUp).toHaveBeenCalledTimes(1);
    expect(await screen.findByText(t('admin:emergency.approve.success'))).toBeInTheDocument();
    await waitFor(() => expect(opsApi.listEmergencyAccess).toHaveBeenCalledTimes(2));
  });

  it('denies a pending request', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderScreen();
    await decide(user, PENDING_OTHER.id, 'deny');
    await waitFor(() => expect(opsApi.denyEmergencyAccess).toHaveBeenCalledWith(PENDING_OTHER.id));
    expect(await screen.findByText(t('admin:emergency.deny.success'))).toBeInTheDocument();
  });

  it('revokes an active window', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderScreen();
    await decide(user, ACTIVE_OTHER.id, 'revoke');
    await waitFor(() => expect(opsApi.revokeEmergencyAccess).toHaveBeenCalledWith(ACTIVE_OTHER.id));
    expect(await screen.findByText(t('admin:emergency.revoke.success'))).toBeInTheDocument();
  });

  it.each([
    ['approve', 'approveEmergencyAccess', apiError(403, 'self_approval_denied'), 'admin:emergency.errors.selfApprovalDenied'],
    ['approve', 'approveEmergencyAccess', apiError(409, 'conflict'), 'admin:emergency.errors.conflict'],
    ['approve', 'approveEmergencyAccess', apiError(404, 'not_found'), 'admin:emergency.errors.notFound'],
    ['approve', 'approveEmergencyAccess', apiError(403, 'forbidden'), 'admin:emergency.errors.forbidden'],
    ['approve', 'approveEmergencyAccess', apiError(429, 'rate_limited'), 'admin:emergency.errors.rateLimited'],
    ['approve', 'approveEmergencyAccess', apiError(500, 'internal'), 'admin:emergency.errors.unknown'],
    ['deny', 'denyEmergencyAccess', apiError(409, 'conflict'), 'admin:emergency.errors.conflict'],
    ['revoke', 'revokeEmergencyAccess', apiError(409, 'emergency_not_active'), 'admin:emergency.errors.notActive'],
  ] as const)('%s: %s rejecting with %s shows translated copy', async (decision, method, err, key) => {
    const user = userEvent.setup();
    renderScreen({ opsApi: emergencyApi({ [method]: vi.fn().mockRejectedValue(err) }) });
    const rowId = decision === 'revoke' ? ACTIVE_OTHER.id : PENDING_OTHER.id;
    const dialog = await decide(user, rowId, decision);
    expect(await within(dialog).findByText(t(key))).toBeInTheDocument();
    expect(screen.queryByText(/English/)).not.toBeInTheDocument();
  });

  it('closes quietly when step-up is cancelled', async () => {
    const user = userEvent.setup();
    renderScreen({
      opsApi: emergencyApi({ approveEmergencyAccess: vi.fn().mockRejectedValue(apiError(403, 'step_up_required')) }),
      auth: makeAuth({ stepUp: vi.fn().mockResolvedValue(false) }),
    });
    await decide(user, PENDING_OTHER.id, 'approve');
    await waitFor(() => expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument());
    expect(screen.queryByText(t('admin:emergency.errors.unknown'))).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Record view (Review Focus 5)
// ---------------------------------------------------------------------------

describe('EmergencyScreen record view', () => {
  async function openViewer(user: UserEvent) {
    const row = await rowOf(ACTIVE_MINE.id);
    await user.click(button(row, 'admin:emergency.record.open')!);
    return screen.findByRole('dialog', { name: t('admin:emergency.record.title') });
  }

  async function readRecord(user: UserEvent, dialog: HTMLElement, recordId: string, type?: 'intake') {
    if (type) await choose(user, t('admin:emergency.record.recordType'), t(`admin:emergency.recordTypes.${type}`));
    await user.click(within(dialog).getByRole('textbox', { name: new RegExp(`^${t('admin:emergency.record.recordId')}`) }));
    await user.paste(recordId);
    await user.click(within(dialog).getByRole('button', { name: t('admin:emergency.record.submit') }));
  }

  it('offers Open record only on active access the caller requested', async () => {
    renderScreen();
    expect(button(await rowOf(ACTIVE_MINE.id), 'admin:emergency.record.open')).toBeInTheDocument();
    for (const id of [PENDING_MINE.id, PENDING_OTHER.id, ACTIVE_OTHER.id, EXPIRED.id, REVOKED.id]) {
      expect(button(await rowOf(id), 'admin:emergency.record.open')).not.toBeInTheDocument();
    }
  });

  it('never renders content before an approved access exists', async () => {
    const opsApi = emergencyApi({ listEmergencyAccess: vi.fn().mockResolvedValue({ items: [PENDING_MINE] }) });
    renderScreen({ opsApi });
    const row = await rowOf(PENDING_MINE.id);
    expect(button(row, 'admin:emergency.record.open')).not.toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.queryByText(t('admin:emergency.record.audited'))).not.toBeInTheDocument();
    expect(opsApi.readEmergencyRecord).not.toHaveBeenCalled();
  });

  it('shows the audited notice before any read, and nothing else until the server answers', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderScreen();
    const dialog = await openViewer(user);
    expect(within(dialog).getByText(t('admin:emergency.record.audited'))).toBeInTheDocument();
    expect(within(dialog).getByText(t('admin:emergency.record.auditedTitle'))).toBeInTheDocument();
    expect(within(dialog).queryByRole('region', { name: t('admin:emergency.record.contentLabel') })).not.toBeInTheDocument();
    expect(opsApi.readEmergencyRecord).not.toHaveBeenCalled();
  });

  it('reads a conversation under the access record and keeps the notice beside the messages', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderScreen();
    const dialog = await openViewer(user);
    await readRecord(user, dialog, ' conv_sample ');
    const content = await within(dialog).findByRole('region', { name: t('admin:emergency.record.contentLabel') });
    expect(opsApi.readEmergencyRecord).toHaveBeenCalledWith(ACTIVE_MINE.id, 'conversation', 'conv_sample');
    expect(within(content).getByText('Confidential test message body')).toBeInTheDocument();
    expect(within(dialog).getByText(t('admin:emergency.record.audited'))).toBeInTheDocument();
    // Read-only: no field or button inside the content.
    expect(within(content).queryAllByRole('textbox')).toHaveLength(0);
    expect(within(content).queryAllByRole('button')).toHaveLength(0);
  });

  it('reads an intake', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderScreen({ opsApi: emergencyApi({ readEmergencyRecord: vi.fn().mockResolvedValue(INTAKE) }) });
    const dialog = await openViewer(user);
    await readRecord(user, dialog, 'intake_sample', 'intake');
    expect(await within(dialog).findByText('Confidential intake body')).toBeInTheDocument();
    expect(opsApi.readEmergencyRecord).toHaveBeenCalledWith(ACTIVE_MINE.id, 'intake', 'intake_sample');
  });

  it('retries a read once after step-up', async () => {
    const user = userEvent.setup();
    const readEmergencyRecord = vi
      .fn()
      .mockRejectedValueOnce(apiError(403, 'step_up_required'))
      .mockResolvedValueOnce(CONVERSATION);
    const { auth } = renderScreen({ opsApi: emergencyApi({ readEmergencyRecord }) });
    const dialog = await openViewer(user);
    await readRecord(user, dialog, 'conv_sample');
    expect(await within(dialog).findByText('Confidential test message body')).toBeInTheDocument();
    expect(auth.stepUp).toHaveBeenCalledTimes(1);
    expect(readEmergencyRecord).toHaveBeenCalledTimes(2);
  });

  it('requires a record id', async () => {
    const user = userEvent.setup();
    const { opsApi } = renderScreen();
    const dialog = await openViewer(user);
    await user.click(within(dialog).getByRole('button', { name: t('admin:emergency.record.submit') }));
    expect((await within(dialog).findAllByText(t('admin:emergency.errors.recordIdRequired'))).length).toBeGreaterThan(0);
    expect(opsApi.readEmergencyRecord).not.toHaveBeenCalled();
  });

  it.each([
    [apiError(403, 'emergency_not_active'), 'admin:emergency.errors.notActive'],
    [apiError(404, 'not_found'), 'admin:emergency.errors.notFound'],
    [apiError(403, 'forbidden'), 'admin:emergency.errors.forbidden'],
    [apiError(429, 'rate_limited'), 'admin:emergency.errors.rateLimited'],
    [apiError(500, 'internal'), 'admin:emergency.errors.unknown'],
  ])('shows a refused read as copy and no content (%s)', async (err, key) => {
    const user = userEvent.setup();
    renderScreen({ opsApi: emergencyApi({ readEmergencyRecord: vi.fn().mockRejectedValue(err) }) });
    const dialog = await openViewer(user);
    await readRecord(user, dialog, 'conv_sample');
    expect((await within(dialog).findAllByText(t(key))).length).toBeGreaterThan(0);
    expect(within(dialog).queryByRole('region', { name: t('admin:emergency.record.contentLabel') })).not.toBeInTheDocument();
    expect(within(dialog).getByText(t('admin:emergency.record.audited'))).toBeInTheDocument();
  });

  it('shows unknown copy when the content does not have the record shape', async () => {
    const user = userEvent.setup();
    renderScreen({
      opsApi: emergencyApi({ readEmergencyRecord: vi.fn().mockResolvedValue({ ...CONVERSATION, content: { id: 'x' } }) }),
    });
    const dialog = await openViewer(user);
    await readRecord(user, dialog, 'conv_sample');
    expect(await within(dialog).findByText(t('admin:emergency.errors.unknown'))).toBeInTheDocument();
    expect(within(dialog).queryByRole('region', { name: t('admin:emergency.record.contentLabel') })).not.toBeInTheDocument();
  });

  it('shows nothing when step-up for the read is cancelled', async () => {
    const user = userEvent.setup();
    renderScreen({
      opsApi: emergencyApi({ readEmergencyRecord: vi.fn().mockRejectedValue(apiError(403, 'step_up_required')) }),
      auth: makeAuth({ stepUp: vi.fn().mockResolvedValue(false) }),
    });
    const dialog = await openViewer(user);
    await readRecord(user, dialog, 'conv_sample');
    await waitFor(() => expect(within(dialog).getByRole('button', { name: t('admin:emergency.record.submit') })).toBeEnabled());
    expect(within(dialog).queryByText(t('admin:emergency.errors.unknown'))).not.toBeInTheDocument();
    expect(within(dialog).queryByRole('region', { name: t('admin:emergency.record.contentLabel') })).not.toBeInTheDocument();
  });

  it('drops the record on close and does not cache it', async () => {
    const user = userEvent.setup();
    const { queryClient } = renderScreen();
    let dialog = await openViewer(user);
    await readRecord(user, dialog, 'conv_sample');
    await within(dialog).findByText('Confidential test message body');

    await user.click(within(dialog).getByRole('button', { name: t('common:nav.close') }));
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
    expect(JSON.stringify(queryClient.getQueryCache().getAll().map((q) => q.state.data))).not.toContain('Confidential');
    await waitFor(() =>
      expect(JSON.stringify(queryClient.getMutationCache().getAll().map((m) => m.state.data))).not.toContain('Confidential'),
    );

    dialog = await openViewer(user);
    expect(within(dialog).queryByText('Confidential test message body')).not.toBeInTheDocument();
  });
});

// ---------------------------------------------------------------------------
// Sample mode
// ---------------------------------------------------------------------------

describe('EmergencyScreen in sample mode', () => {
  it('shows the sample records with every action disabled and never calls the API', async () => {
    const opsApi = emergencyApi();
    renderScreen({ opsApi, sampleMode: true });
    expect(await screen.findByText(t('admin:emergency.sampleNote'))).toBeInTheDocument();
    for (const fixture of SAMPLE_EMERGENCY_ACCESS) {
      expect(await rowOf(fixture.id)).toBeInTheDocument();
    }
    expect(screen.getByRole('button', { name: t('admin:emergency.request.open') })).toBeDisabled();
    const pending = await rowOf(SAMPLE_EMERGENCY_ACCESS[0]!.id);
    expect(button(pending, 'admin:emergency.approve.open')).toBeDisabled();
    expect(button(pending, 'admin:emergency.deny.open')).toBeDisabled();
    expect(opsApi.listEmergencyAccess).not.toHaveBeenCalled();
  });
});
