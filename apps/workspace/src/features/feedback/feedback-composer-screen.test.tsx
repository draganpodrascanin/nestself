import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SAMPLE_FEEDBACK_ROUTES } from '@nestself/sample-data';
import { apiError, employeeAuth, makeListeningApi, renderWithProviders, t } from '../listening/listening-test-harness';
import { FeedbackComposerScreen } from './feedback-composer-screen';

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

const ROUTE = SAMPLE_FEEDBACK_ROUTES.items[0]!;

async function choose(user: ReturnType<typeof userEvent.setup>, label: string, option: string) {
  await user.click(screen.getByRole('combobox', { name: label }));
  await user.click(await screen.findByRole('option', { name: option }));
}

describe('FeedbackComposerScreen', () => {
  it('previews the designated recipient by default and the alternative after the choice, and sends routeChoice alternate', async () => {
    const user = userEvent.setup();
    const api = makeListeningApi();
    renderWithProviders(<FeedbackComposerScreen listeningApi={api} sampleMode={false} />, employeeAuth());
    const preview = await screen.findByTestId('recipient-preview');
    expect(within(preview).getByText(t('listening:feedback.composer.preview', { name: ROUTE.primary.displayName, function: t('listening:feedback.function.primary') }))).toBeInTheDocument();
    expect(api.createFeedbackCase).not.toHaveBeenCalled();

    await user.click(screen.getByRole('radio', { name: t('listening:feedback.composer.alternateOption', { name: ROUTE.alternate.displayName }) }));
    expect(within(preview).getByText(t('listening:feedback.composer.preview', { name: ROUTE.alternate.displayName, function: t('listening:feedback.function.alternate') }))).toBeInTheDocument();
    expect(within(preview).getByText(t('listening:feedback.composer.previewAlternate', { other: ROUTE.primary.displayName }))).toBeInTheDocument();

    await choose(user, t('listening:feedback.composer.category'), t('listening:feedback.categories.workload'));
    await user.type(screen.getByLabelText(new RegExp(`^${t('listening:feedback.composer.body')}`)), 'The rota changes without notice.');
    expect(screen.getByText(t('listening:feedback.composer.identityWarning'))).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: t('listening:feedback.composer.submit') }));
    await waitFor(() => expect(api.createFeedbackCase).toHaveBeenCalledTimes(1));
    const [body, key] = (api.createFeedbackCase as ReturnType<typeof vi.fn>).mock.calls[0]!;
    expect(body).toEqual({ routeId: ROUTE.id, kind: 'problem', category: 'workload', routeChoice: 'alternate', anonymousToEmployer: true, body: 'The rota changes without notice.' });
    expect(String(key)).toMatch(/^[0-9a-f-]{36}$/);
    expect(await screen.findByRole('heading', { name: t('listening:feedback.composer.receipt.title') })).toBeInTheDocument();
    expect(screen.getByText(/Reporter-AB2C/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: t('listening:feedback.composer.receipt.view') })).toHaveAttribute('href', '/feedback/feedback_case_new');
  });

  it('refuses to send without a category or text and shows the summary', async () => {
    const user = userEvent.setup();
    const api = makeListeningApi();
    renderWithProviders(<FeedbackComposerScreen listeningApi={api} sampleMode={false} />, employeeAuth());
    await user.click(await screen.findByRole('button', { name: t('listening:feedback.composer.submit') }));
    expect(await screen.findByText(t('common:form.errorSummaryTitle'))).toBeInTheDocument();
    expect(screen.getByText(t('listening:feedback.composer.errors.bodyRequired'))).toBeInTheDocument();
    expect(screen.getByText(t('listening:feedback.composer.errors.categoryRequired'))).toBeInTheDocument();
    expect(api.createFeedbackCase).not.toHaveBeenCalled();
  });

  it('renders route_unavailable in translated copy and keeps the text', async () => {
    const user = userEvent.setup();
    const api = makeListeningApi({ createFeedbackCase: vi.fn().mockRejectedValue(apiError(409, 'route_unavailable')) });
    renderWithProviders(<FeedbackComposerScreen listeningApi={api} sampleMode={false} />, employeeAuth());
    await screen.findByTestId('recipient-preview');
    await choose(user, t('listening:feedback.composer.category'), t('listening:feedback.categories.other'));
    const body = screen.getByLabelText(new RegExp(`^${t('listening:feedback.composer.body')}`));
    await user.type(body, 'Something to say.');
    await user.click(screen.getByRole('button', { name: t('listening:feedback.composer.submit') }));
    expect(await screen.findByText(t('listening:errors.route_unavailable'))).toBeInTheDocument();
    expect(screen.queryByText('English route_unavailable')).not.toBeInTheDocument();
    expect(body).toHaveValue('Something to say.');
  });

  it('explains honestly when the channel is off and invents no contact', async () => {
    renderWithProviders(
      <FeedbackComposerScreen listeningApi={makeListeningApi({ feedbackRoutes: vi.fn().mockResolvedValue({ feedbackEnabled: false, sensitiveEnabled: false, items: [] }) })} sampleMode={false} />,
      employeeAuth(),
    );
    expect(await screen.findByText(t('listening:feedback.composer.unavailable'))).toBeInTheDocument();
    expect(screen.getByText(t('listening:feedback.composer.unavailableBody'))).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: t('listening:feedback.composer.submit') })).not.toBeInTheDocument();
  });

  it('in sample mode sends nothing and says so on the receipt', async () => {
    const user = userEvent.setup();
    const api = makeListeningApi();
    renderWithProviders(<FeedbackComposerScreen listeningApi={api} sampleMode />, employeeAuth());
    await screen.findByTestId('recipient-preview');
    await choose(user, t('listening:feedback.composer.category'), t('listening:feedback.categories.safety'));
    await user.type(screen.getByLabelText(new RegExp(`^${t('listening:feedback.composer.body')}`)), 'x');
    await user.click(screen.getByRole('button', { name: t('listening:feedback.composer.submit') }));
    expect(await screen.findByText(t('common:sample.demoNoop'))).toBeInTheDocument();
    expect(api.feedbackRoutes).not.toHaveBeenCalled();
    expect(api.createFeedbackCase).not.toHaveBeenCalled();
  });
});
