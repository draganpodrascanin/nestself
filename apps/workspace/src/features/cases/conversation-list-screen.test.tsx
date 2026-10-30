import { describe, it, expect, vi, afterEach } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AssignedCasesScreen, MyConversationsScreen } from './conversation-list-screen';
import { EMPLOYEE, EXPERT, apiError, makeAuth, makePro, renderAt, summary, t } from './cases-test-harness';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe('AssignedCasesScreen', () => {
  it('lists the assigned conversations with case, employee, start date and message count', async () => {
    const pro = makePro();
    renderAt(<AssignedCasesScreen pro={pro} sampleMode={false} />, '/cases');
    const table = await screen.findByRole('table', { name: t('workspace:cases.caption') });
    const row = within(table).getAllByRole('row')[1]!;
    expect(row).toHaveTextContent('case_conv_1');
    expect(row).toHaveTextContent('user_jovan');
    expect(row).toHaveTextContent('1 October 2026');
    expect(row).toHaveTextContent('2');
    expect(within(row).getByRole('link', { name: t('workspace:cases.openFor', { id: 'case_conv_1' }) })).toHaveAttribute(
      'href',
      '/cases/conv_1',
    );
    expect(pro.listAssignedConversations).toHaveBeenCalledWith({ limit: 25 });
    expect(screen.queryByText('First test body')).not.toBeInTheDocument();
  });

  it('pages with the API cursor and appends the next page', async () => {
    const user = userEvent.setup();
    const listAssignedConversations = vi
      .fn()
      .mockResolvedValueOnce({ items: [summary('conv_1')], nextCursor: 'conv_1' })
      .mockResolvedValueOnce({ items: [summary('conv_2')], nextCursor: null });
    renderAt(<AssignedCasesScreen pro={makePro({ listAssignedConversations })} sampleMode={false} />, '/cases');
    expect(await screen.findByText(t('workspace:cases.paging.showingMore', { shown: 1 }))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('workspace:cases.paging.loadMore') }));
    expect(await screen.findByText('case_conv_2')).toBeInTheDocument();
    expect(listAssignedConversations).toHaveBeenLastCalledWith({ limit: 25, cursor: 'conv_1' });
    expect(screen.getByText('case_conv_1')).toBeInTheDocument();
    expect(screen.getByText(t('workspace:cases.paging.showing', { shown: 2 }))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('workspace:cases.paging.loadMore') })).not.toBeInTheDocument();
  });

  it('shows copy when the next page fails and keeps the rows', async () => {
    const user = userEvent.setup();
    const listAssignedConversations = vi
      .fn()
      .mockResolvedValueOnce({ items: [summary('conv_1')], nextCursor: 'conv_1' })
      .mockRejectedValueOnce(apiError(429, 'rate_limited'));
    renderAt(<AssignedCasesScreen pro={makePro({ listAssignedConversations })} sampleMode={false} />, '/cases');
    await user.click(await screen.findByRole('button', { name: t('workspace:cases.paging.loadMore') }));
    expect(await screen.findByText(t('workspace:cases.paging.loadMoreFailed'))).toBeInTheDocument();
    expect(screen.getByText(t('workspace:cases.errors.rateLimited'))).toBeInTheDocument();
    expect(screen.getByText('case_conv_1')).toBeInTheDocument();
  });

  it.each([
    [apiError(403, 'forbidden'), 'forbidden'],
    [apiError(429, 'rate_limited'), 'rateLimited'],
    [apiError(500, 'internal'), 'unknown'],
  ])('shows translated copy when the list fails (%s)', async (err, key) => {
    renderAt(
      <AssignedCasesScreen pro={makePro({ listAssignedConversations: vi.fn().mockRejectedValue(err) })} sampleMode={false} />,
      '/cases',
    );
    expect(await screen.findByText(t('workspace:cases.errors.listTitle'))).toBeInTheDocument();
    expect(screen.getByText(t(`workspace:cases.errors.${key}`))).toBeInTheDocument();
    expect(screen.queryByText('English forbidden')).not.toBeInTheDocument();
  });

  it('says so when no case is assigned', async () => {
    renderAt(
      <AssignedCasesScreen
        pro={makePro({ listAssignedConversations: vi.fn().mockResolvedValue({ items: [], nextCursor: null }) })}
        sampleMode={false}
      />,
      '/cases',
    );
    expect(await screen.findByText(t('workspace:cases.empty'))).toBeInTheDocument();
  });

  it('moves the session into the expert context once before reading', async () => {
    const switchContext = vi.fn().mockResolvedValue(undefined);
    const pro = makePro();
    renderAt(
      <AssignedCasesScreen pro={pro} sampleMode={false} />,
      '/cases',
      makeAuth({ principal: { ...EXPERT, context: { kind: 'operations' } }, switchContext }),
    );
    await waitFor(() => expect(switchContext).toHaveBeenCalledWith({ kind: 'expert' }));
    expect(switchContext).toHaveBeenCalledTimes(1);
    // Still in operations: nothing is read until the context is right.
    expect(pro.listAssignedConversations).not.toHaveBeenCalled();
  });

  it('does not switch when the session is already in the expert context', async () => {
    const switchContext = vi.fn();
    renderAt(<AssignedCasesScreen pro={makePro()} sampleMode={false} />, '/cases', makeAuth({ switchContext }));
    await screen.findByRole('table');
    expect(switchContext).not.toHaveBeenCalled();
  });

  it('shows copy when the switch to the expert context fails', async () => {
    renderAt(
      <AssignedCasesScreen pro={makePro()} sampleMode={false} />,
      '/cases',
      makeAuth({
        principal: { ...EXPERT, context: { kind: 'personal' } },
        switchContext: vi.fn().mockRejectedValue(apiError(403, 'invalid_context')),
      }),
    );
    expect(await screen.findByText(t('workspace:cases.errors.contextTitle'))).toBeInTheDocument();
    expect(screen.getByText(t('workspace:cases.errors.context'))).toBeInTheDocument();
  });

  it('sample mode lists the sample conversations of the sample expert without calling the API', async () => {
    const pro = makePro();
    renderAt(<AssignedCasesScreen pro={pro} sampleMode />, '/cases');
    expect(await screen.findByText('case_sample')).toBeInTheDocument();
    expect(screen.getByText('case_sample_ana')).toBeInTheDocument();
    expect(screen.getByText(t('workspace:cases.sampleNote'))).toBeInTheDocument();
    expect(pro.listAssignedConversations).not.toHaveBeenCalled();
  });
});

describe('MyConversationsScreen', () => {
  it('lists the participant conversations with the expert column', async () => {
    const pro = makePro();
    renderAt(<MyConversationsScreen pro={pro} sampleMode={false} />, '/conversations', makeAuth({ principal: EMPLOYEE }));
    const table = await screen.findByRole('table', { name: t('workspace:conversations.caption') });
    expect(within(table).getByRole('columnheader', { name: t('workspace:cases.columns.expert') })).toBeInTheDocument();
    expect(within(table).getByText('user_milica')).toBeInTheDocument();
    expect(within(table).getByRole('link', { name: t('workspace:cases.openFor', { id: 'case_conv_1' }) })).toHaveAttribute(
      'href',
      '/conversations/conv_1',
    );
    expect(pro.listMyConversations).toHaveBeenCalledWith({ limit: 25 });
  });

  it('shows copy when the list fails', async () => {
    renderAt(
      <MyConversationsScreen
        pro={makePro({ listMyConversations: vi.fn().mockRejectedValue(apiError(500, 'internal')) })}
        sampleMode={false}
      />,
      '/conversations',
      makeAuth({ principal: EMPLOYEE }),
    );
    expect(await screen.findByText(t('workspace:cases.errors.listTitle'))).toBeInTheDocument();
    expect(screen.getByText(t('workspace:cases.errors.unknown'))).toBeInTheDocument();
  });

  it('says so when there is no conversation', async () => {
    renderAt(
      <MyConversationsScreen
        pro={makePro({ listMyConversations: vi.fn().mockResolvedValue({ items: [], nextCursor: null }) })}
        sampleMode={false}
      />,
      '/conversations',
      makeAuth({ principal: EMPLOYEE }),
    );
    expect(await screen.findByText(t('workspace:conversations.empty'))).toBeInTheDocument();
  });

  it('sample mode shows only the sample employee’s own conversation', async () => {
    const pro = makePro();
    renderAt(<MyConversationsScreen pro={pro} sampleMode />, '/conversations', makeAuth({ principal: EMPLOYEE }));
    expect(await screen.findByText('case_sample')).toBeInTheDocument();
    expect(screen.queryByText('case_sample_ana')).not.toBeInTheDocument();
    expect(pro.listMyConversations).not.toHaveBeenCalled();
  });
});
