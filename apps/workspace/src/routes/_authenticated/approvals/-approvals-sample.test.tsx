/**
 * `/approvals` in sample mode (CW-R-56): the sample approver (the sample HR
 * administrator) sees `SAMPLE_APPROVAL_ITEMS`, and approving or declining
 * sends nothing and says so.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createMemoryHistory, createRouter, RouterProvider } from '@tanstack/react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { SAMPLE_APPROVAL_ITEMS, SAMPLE_PRINCIPALS } from '@nestself/sample-data';
import en from '@nestself/i18n/locales/en/calls.json';
import common from '@nestself/i18n/locales/en/common.json';
import { routeTree } from '../../../routeTree.gen';

function renderApprovals() {
  window.history.replaceState(null, '', '/?role=hr_admin');
  const sample = SAMPLE_PRINCIPALS.hr_admin;
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createRouter({
    routeTree,
    context: { queryClient, auth: { principal: sample.principal, effectiveActions: sample.effectiveActions } },
    history: createMemoryHistory({ initialEntries: ['/approvals'] }),
  });
  render(
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>,
  );
}

describe('approvals in sample mode', { timeout: 20_000 }, () => {
  beforeEach(() => window.history.replaceState(null, '', '/'));
  afterEach(() => {
    cleanup();
    window.history.replaceState(null, '', '/');
  });

  it("lists the sample approver's items and sends nothing on approve or decline", async () => {
    const user = userEvent.setup();
    renderApprovals();

    expect(await screen.findByText(en.approval.sampleItemsNote, {}, { timeout: 5000 })).toBeInTheDocument();
    expect(screen.getByText(common.sample.banner)).toBeInTheDocument();
    const item = SAMPLE_APPROVAL_ITEMS[0]!;
    expect(screen.getByRole('heading', { name: item.employeeDisplayName })).toBeInTheDocument();
    expect(screen.getByText(en.approval.followUpLabel)).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: en.approval.approve }));
    expect(await screen.findByText(en.sample.actionNoop)).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: en.approval.reject }));
    expect(screen.getByText(en.sample.actionNoop)).toBeInTheDocument();
  });
});
