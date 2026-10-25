import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ExpertConversationScreen, MyConversationScreen } from './conversation-screen';
import { casesKeys } from './use-cases';
import {
  CONVERSATION,
  EMPLOYEE,
  EXPERT,
  INTAKE,
  apiError,
  makeAuth,
  makePro,
  makeQueryClient,
  renderAt,
  t,
} from './cases-test-harness';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const stepUpRequired = () => apiError(403, 'step_up_required');

function renderExpert(pro = makePro(), auth = makeAuth(), queryClient = makeQueryClient()) {
  return renderAt(
    <ExpertConversationScreen pro={pro} conversationId="conv_1" sampleMode={false} />,
    '/cases/conv_1',
    auth,
    queryClient,
  );
}

describe('ExpertConversationScreen', () => {
  it('renders the messages read-only, oldest first, with the viewer labelled', async () => {
    const pro = makePro();
    renderExpert(pro);
    const list = await screen.findByRole('list', { name: t('workspace:cases.messages.label') });
    const items = within(list).getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('First test body');
    expect(items[0]).toHaveTextContent(t('workspace:cases.messages.participant', { id: 'user_jovan' }));
    expect(items[1]).toHaveTextContent('Second test body');
    expect(items[1]).toHaveTextContent(t('workspace:cases.messages.you'));
    expect(screen.getByRole('heading', { level: 1, name: t('workspace:cases.detailTitle', { id: 'case_1' }) })).toBeInTheDocument();
    expect(screen.queryByRole('textbox', { name: /message/i })).not.toBeInTheDocument();
    expect(pro.getConversation).toHaveBeenCalledWith('conv_1');
  });

  it('asks for step-up and retries once when the read needs it', async () => {
    const stepUp = vi.fn().mockResolvedValue(true);
    const getConversation = vi.fn().mockRejectedValueOnce(stepUpRequired()).mockResolvedValueOnce(CONVERSATION);
    renderExpert(makePro({ getConversation }), makeAuth({ stepUp }));
    expect(await screen.findByText('First test body')).toBeInTheDocument();
    expect(stepUp).toHaveBeenCalledTimes(1);
    expect(getConversation).toHaveBeenCalledTimes(2);
  });

  it('shows that nothing was opened when step-up is cancelled, and can try again', async () => {
    const user = userEvent.setup();
    const stepUp = vi.fn().mockResolvedValueOnce(false).mockResolvedValueOnce(true);
    const getConversation = vi
      .fn()
      .mockRejectedValueOnce(stepUpRequired())
      .mockRejectedValueOnce(stepUpRequired())
      .mockResolvedValueOnce(CONVERSATION);
    renderExpert(makePro({ getConversation }), makeAuth({ stepUp }));
    expect(await screen.findByText(t('workspace:cases.errors.stepUpCancelled'))).toBeInTheDocument();
    expect(screen.queryByText('First test body')).not.toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('workspace:cases.retry') }));
    expect(await screen.findByText('First test body')).toBeInTheDocument();
  });

  it.each([
    [apiError(403, 'forbidden'), 'forbidden'],
    [apiError(404, 'not_found'), 'notFound'],
    [apiError(429, 'rate_limited'), 'rateLimited'],
    [apiError(500, 'internal'), 'unknown'],
  ])('shows translated copy when the read fails (%s)', async (err, key) => {
    renderExpert(makePro({ getConversation: vi.fn().mockRejectedValue(err) }));
    expect(await screen.findByText(t('workspace:cases.errors.readTitle'))).toBeInTheDocument();
    expect(screen.getByText(t(`workspace:cases.errors.${key}`))).toBeInTheDocument();
    expect(screen.queryByText(/^English /)).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: t('workspace:cases.intake.heading') })).not.toBeInTheDocument();
  });

  it('keeps no conversation in the cache once the screen is gone', async () => {
    const queryClient = makeQueryClient();
    const { unmount } = renderExpert(makePro(), makeAuth(), queryClient);
    await screen.findByText('First test body');
    unmount();
    await waitFor(() => expect(queryClient.getQueryData(casesKeys.conversation('conv_1'))).toBeUndefined());
    expect(queryClient.getQueryCache().find({ queryKey: casesKeys.conversation('conv_1') })).toBeUndefined();
  });

  it('opens the intake record by id through the assigned-expert path', async () => {
    const user = userEvent.setup();
    const stepUp = vi.fn().mockResolvedValue(true);
    const getIntake = vi.fn().mockRejectedValueOnce(stepUpRequired()).mockResolvedValueOnce(INTAKE);
    renderExpert(makePro({ getIntake }), makeAuth({ stepUp }));
    await screen.findByText('First test body');
    await user.type(screen.getByRole('textbox', { name: new RegExp(t('workspace:cases.intake.idLabel')) }), 'intake_1');
    await user.click(screen.getByRole('button', { name: t('workspace:cases.intake.open') }));
    expect(await screen.findByText('Intake test body')).toBeInTheDocument();
    expect(getIntake).toHaveBeenCalledWith('intake_1');
    expect(stepUp).toHaveBeenCalledTimes(1);
  });

  it('requires an intake id', async () => {
    const user = userEvent.setup();
    const pro = makePro();
    renderExpert(pro);
    await screen.findByText('First test body');
    await user.click(screen.getByRole('button', { name: t('workspace:cases.intake.open') }));
    expect(await screen.findByText(t('workspace:cases.intake.required'))).toBeInTheDocument();
    expect(pro.getIntake).not.toHaveBeenCalled();
  });

  it.each([
    [apiError(403, 'forbidden'), 'forbidden'],
    [apiError(404, 'not_found'), 'notFound'],
  ])('shows translated copy when the intake read fails (%s)', async (err, key) => {
    const user = userEvent.setup();
    renderExpert(makePro({ getIntake: vi.fn().mockRejectedValue(err) }));
    await screen.findByText('First test body');
    await user.type(screen.getByRole('textbox', { name: new RegExp(t('workspace:cases.intake.idLabel')) }), 'intake_x');
    await user.click(screen.getByRole('button', { name: t('workspace:cases.intake.open') }));
    expect(await screen.findByText(t('workspace:cases.intake.errorTitle'))).toBeInTheDocument();
    expect(screen.getByText(t(`workspace:cases.errors.${key}`))).toBeInTheDocument();
  });

  it('does not read before the session is in the expert context', async () => {
    const pro = makePro();
    const switchContext = vi.fn(() => new Promise<void>(() => {}));
    renderExpert(pro, makeAuth({ principal: { ...EXPERT, context: { kind: 'operations' } }, switchContext }));
    await waitFor(() => expect(switchContext).toHaveBeenCalledWith({ kind: 'expert' }));
    expect(screen.getByText(t('workspace:cases.loading'))).toBeInTheDocument();
    expect(pro.getConversation).not.toHaveBeenCalled();
  });

  it('sample mode shows the fixture messages and the fixture intake without the API', async () => {
    const user = userEvent.setup();
    const pro = makePro();
    renderAt(<ExpertConversationScreen pro={pro} conversationId="conv_sample" sampleMode />, '/cases/conv_sample');
    expect(await screen.findByText('Sample message (fixture)')).toBeInTheDocument();
    expect(screen.getByText(t('workspace:cases.sampleNote'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('workspace:cases.intake.open') }));
    expect(await screen.findByText('Sample intake notes (fixture)')).toBeInTheDocument();
    expect(pro.getConversation).not.toHaveBeenCalled();
    expect(pro.getIntake).not.toHaveBeenCalled();
  });

  it('sample mode says so for an unknown conversation', async () => {
    renderAt(<ExpertConversationScreen pro={makePro()} conversationId="conv_missing" sampleMode />, '/cases/conv_missing');
    expect(await screen.findByText(t('workspace:cases.errors.notFound'))).toBeInTheDocument();
  });
});

describe('MyConversationScreen', () => {
  function renderMine(pro = makePro(), queryClient = makeQueryClient()) {
    return renderAt(
      <MyConversationScreen pro={pro} conversationId="conv_1" sampleMode={false} />,
      '/conversations/conv_1',
      makeAuth({ principal: EMPLOYEE, effectiveActions: ['conversation.participate'] }),
      queryClient,
    );
  }

  it('renders the participant’s conversation read-only through the participant path', async () => {
    const pro = makePro();
    renderMine(pro);
    const list = await screen.findByRole('list', { name: t('workspace:cases.messages.label') });
    expect(within(list).getAllByRole('listitem')[0]).toHaveTextContent(t('workspace:cases.messages.you'));
    expect(pro.getMyConversation).toHaveBeenCalledWith('conv_1');
    expect(pro.getConversation).not.toHaveBeenCalled();
    expect(screen.queryByRole('heading', { name: t('workspace:cases.intake.heading') })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: t('workspace:conversations.back') })).toHaveAttribute('href', '/conversations');
  });

  it.each([
    [apiError(403, 'forbidden'), 'forbidden'],
    [apiError(404, 'not_found'), 'notFound'],
    [apiError(500, 'internal'), 'unknown'],
  ])('shows translated copy when the read fails (%s)', async (err, key) => {
    renderMine(makePro({ getMyConversation: vi.fn().mockRejectedValue(err) }));
    expect(await screen.findByText(t('workspace:cases.errors.readTitle'))).toBeInTheDocument();
    expect(screen.getByText(t(`workspace:cases.errors.${key}`))).toBeInTheDocument();
  });

  it('keeps no conversation in the cache once the screen is gone', async () => {
    const queryClient = makeQueryClient();
    const { unmount } = renderMine(makePro(), queryClient);
    await screen.findByText('First test body');
    unmount();
    await waitFor(() =>
      expect(queryClient.getQueryCache().find({ queryKey: casesKeys.myConversation('conv_1') })).toBeUndefined(),
    );
  });
});
