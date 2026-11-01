import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SAMPLE_FEEDBACK_CASE_ID, SAMPLE_HANDLER_FEEDBACK_CASE, SAMPLE_MY_FEEDBACK_CASE } from '@nestself/sample-data';
import { apiError, employeeAuth, makeAuth, makeListeningApi, renderWithProviders, t } from '../listening/listening-test-harness';
import { HandlerCaseScreen } from './handler-case-screen';
import { InboxScreen } from './inbox-screen';
import { MyCaseScreen } from './my-case-screen';
import { MyFeedbackScreen } from './my-feedback-screen';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const INTERNAL = SAMPLE_HANDLER_FEEDBACK_CASE.messages.find((m) => m.internal)!;

describe('MyFeedbackScreen and MyCaseScreen', () => {
  it('lists own cases with state text and opens one showing only the visible thread', async () => {
    renderWithProviders(<MyFeedbackScreen listeningApi={makeListeningApi()} sampleMode={false} />, employeeAuth());
    expect(await screen.findByRole('link', { name: 'Reporter-K7PQ' })).toHaveAttribute('href', `/feedback/${SAMPLE_FEEDBACK_CASE_ID}`);
    expect(screen.getByText(t('listening:feedback.state.in_review'))).toBeInTheDocument();
    expect(screen.getByText(t('listening:feedback.state.resolved'))).toBeInTheDocument();
    cleanup();

    renderWithProviders(<MyCaseScreen listeningApi={makeListeningApi()} sampleMode={false} caseId={SAMPLE_FEEDBACK_CASE_ID} />, employeeAuth());
    expect(await screen.findByRole('heading', { name: t('listening:feedback.case.title', { pseudonym: 'Reporter-K7PQ' }) })).toBeInTheDocument();
    const log = screen.getByRole('log');
    expect(within(log).getByText(SAMPLE_MY_FEEDBACK_CASE.messages[0]!.body)).toBeInTheDocument();
    expect(within(log).getByText(SAMPLE_MY_FEEDBACK_CASE.messages[1]!.body)).toBeInTheDocument();
    expect(screen.queryByText(INTERNAL.body)).not.toBeInTheDocument();
    expect(screen.getByText(new RegExp(t('listening:feedback.function.alternate')))).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/user_ivana|Ivana/);
  });

  it('sends a reply with an idempotency key and shows the translated error when the case is closed', async () => {
    const user = userEvent.setup();
    const api = makeListeningApi();
    renderWithProviders(<MyCaseScreen listeningApi={api} sampleMode={false} caseId={SAMPLE_FEEDBACK_CASE_ID} />, employeeAuth());
    await screen.findByRole('log');
    await user.type(screen.getByRole('textbox'), 'It happened again on Monday.');
    await user.click(screen.getByRole('button', { name: t('listening:feedback.case.send') }));
    await waitFor(() => expect(api.replyToMyCase).toHaveBeenCalledTimes(1));
    const [id, body, key] = (api.replyToMyCase as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(id).toBe(SAMPLE_FEEDBACK_CASE_ID);
    expect(body).toEqual({ body: 'It happened again on Monday.' });
    expect(String(key)).toMatch(/^[0-9a-f-]{36}$/);
    cleanup();

    const failing = makeListeningApi({ replyToMyCase: vi.fn().mockRejectedValue(apiError(409, 'invalid_state')) });
    renderWithProviders(<MyCaseScreen listeningApi={failing} sampleMode={false} caseId={SAMPLE_FEEDBACK_CASE_ID} />, employeeAuth());
    await screen.findByRole('log');
    await user.type(screen.getByRole('textbox'), 'x');
    await user.click(screen.getByRole('button', { name: t('listening:feedback.case.send') }));
    expect(await screen.findByText(t('listening:errors.invalid_state'))).toBeInTheDocument();
  });
});

describe('InboxScreen and HandlerCaseScreen', () => {
  it('lists assigned cases with overdue and escalated badges, overdue first', async () => {
    renderWithProviders(<InboxScreen listeningApi={makeListeningApi()} sampleMode={false} />);
    const rows = await screen.findAllByRole('row');
    expect(within(rows[1]!).getByText('Reporter-9QWD')).toBeInTheDocument();
    expect(within(rows[1]!).getByText(t('listening:feedback.inbox.overdue'))).toBeInTheDocument();
    expect(within(rows[1]!).getByText(t('listening:feedback.inbox.escalated'))).toBeInTheDocument();
    expect(within(rows[2]!).getByText('Reporter-K7PQ')).toBeInTheDocument();
    expect(document.body.textContent).not.toMatch(/user_jovan|Jovan/);
  });

  it('marks internal notes apart in the thread and saves a note without a reporter message', async () => {
    const user = userEvent.setup();
    const api = makeListeningApi();
    renderWithProviders(<HandlerCaseScreen listeningApi={api} sampleMode={false} caseId={SAMPLE_FEEDBACK_CASE_ID} />);
    expect(await screen.findByRole('heading', { name: t('listening:feedback.handler.title', { pseudonym: 'Reporter-K7PQ' }) })).toBeInTheDocument();
    const note = screen.getByText(INTERNAL.body).closest('li')!;
    expect(note).toHaveAttribute('data-internal', 'true');
    expect(within(note).getByText(t('listening:feedback.handler.internalNote'))).toBeInTheDocument();
    expect(screen.getByText(SAMPLE_HANDLER_FEEDBACK_CASE.messages[0]!.body).closest('li')).not.toHaveAttribute('data-internal');

    await user.type(screen.getByRole('textbox', { name: new RegExp(`^${t('listening:feedback.handler.message')}`) }), 'Check with scheduling.');
    await user.click(screen.getByRole('switch', { name: t('listening:feedback.handler.asInternal') }));
    await user.click(screen.getByRole('button', { name: t('listening:feedback.handler.sendInternal') }));
    await waitFor(() => expect(api.handlerMessage).toHaveBeenCalledTimes(1));
    expect((api.handlerMessage as ReturnType<typeof vi.fn>).mock.calls[0]![1]).toEqual({ body: 'Check with scheduling.', internal: true });
  });

  it('resolving without an explanation shows the field error; with one it sends the state change', async () => {
    const user = userEvent.setup();
    const api = makeListeningApi();
    renderWithProviders(<HandlerCaseScreen listeningApi={api} sampleMode={false} caseId={SAMPLE_FEEDBACK_CASE_ID} />);
    await screen.findByRole('heading', { name: t('listening:feedback.handler.title', { pseudonym: 'Reporter-K7PQ' }) });
    await user.click(screen.getByRole('combobox', { name: t('listening:feedback.handler.newState') }));
    await user.click(await screen.findByRole('option', { name: t('listening:feedback.stateHandler.resolved') }));
    await user.click(screen.getByRole('button', { name: t('listening:feedback.handler.apply') }));
    expect(await screen.findByText(t('listening:feedback.handler.errors.explanationRequired'))).toBeInTheDocument();
    expect(api.setCaseState).not.toHaveBeenCalled();

    await user.type(screen.getByLabelText(new RegExp(`^${t('listening:feedback.handler.explanation')}`)), 'We agreed a two-week notice.');
    await user.click(screen.getByRole('button', { name: t('listening:feedback.handler.apply') }));
    await waitFor(() => expect(api.setCaseState).toHaveBeenCalledWith(SAMPLE_FEEDBACK_CASE_ID, { state: 'resolved', reporterExplanation: 'We agreed a two-week notice.' }));
  });

  it('hands the case over after confirmation and renders a 404 as not found', async () => {
    const user = userEvent.setup();
    const api = makeListeningApi();
    renderWithProviders(<HandlerCaseScreen listeningApi={api} sampleMode={false} caseId={SAMPLE_FEEDBACK_CASE_ID} />);
    await screen.findByRole('heading', { name: t('listening:feedback.handler.title', { pseudonym: 'Reporter-K7PQ' }) });
    await user.click(screen.getByRole('button', { name: t('listening:feedback.handler.reassign', { function: t('listening:feedback.function.primary') }) }));
    expect(await screen.findByText(t('listening:feedback.handler.reassignBody', { function: t('listening:feedback.function.primary') }))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('listening:feedback.handler.reassignConfirm') }));
    await waitFor(() => expect(api.reassignCase).toHaveBeenCalledWith(SAMPLE_FEEDBACK_CASE_ID, { to: 'primary' }));
    cleanup();

    renderWithProviders(
      <HandlerCaseScreen listeningApi={makeListeningApi({ handlerCase: vi.fn().mockRejectedValue(apiError(404, 'not_found')) })} sampleMode={false} caseId="nope" />,
      makeAuth(),
    );
    expect(await screen.findByText(t('listening:errors.notFound'))).toBeInTheDocument();
  });
});
