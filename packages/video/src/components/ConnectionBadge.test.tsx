import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import { expectNoA11yViolations } from '@nestself/ui/test';
import { renderWithI18n, t } from '../test/i18n';
import { ConnectionBadge } from './ConnectionBadge';

describe('ConnectionBadge (UX-12, CALL-09)', () => {
  it('shows a strong connection without a banner', () => {
    renderWithI18n(<ConnectionBadge quality="good" />);
    expect(screen.getByText(t('connection.good'))).toBeInTheDocument();
    expect(screen.queryByText(t('connection.degradedBanner'))).toBeNull();
    expect(screen.getByTestId('connection-badge')).toHaveAttribute('data-quality', 'good');
  });

  it('announces the degraded state with a banner in a polite live region', async () => {
    const { rerender } = renderWithI18n(<ConnectionBadge quality="good" />);
    rerender(<ConnectionBadge quality="degraded" />);
    const region = screen.getByRole('status');
    expect(region).toHaveAttribute('aria-live', 'polite');
    expect(region).toHaveTextContent(t('connection.degraded'));
    expect(await screen.findByText(t('connection.degradedBanner'))).toBeInTheDocument();
    expect(screen.getByTestId('connection-badge')).toHaveAttribute('data-quality', 'degraded');
  });

  it('shows reconnecting in the poor state when the connection dropped', () => {
    renderWithI18n(<ConnectionBadge quality="poor" reconnecting />);
    expect(screen.getByText(t('connection.reconnecting'))).toBeInTheDocument();
    expect(screen.getByText(t('connection.poor'))).toBeInTheDocument();
    expect(screen.getByTestId('connection-badge')).toHaveAttribute('data-quality', 'poor');
  });

  it('tells the person their video is paused while audio continues', () => {
    renderWithI18n(<ConnectionBadge quality="poor" videoPaused />);
    expect(screen.getByText(t('connection.videoPaused'))).toBeInTheDocument();
  });

  it('keeps the banner mounted while it animates out, then removes it', async () => {
    const { rerender } = renderWithI18n(<ConnectionBadge quality="degraded" />);
    expect(screen.getByText(t('connection.degradedBanner'))).toBeInTheDocument();
    rerender(<ConnectionBadge quality="good" />);
    expect(screen.queryByText(t('connection.degradedBanner'))).not.toBeNull();
    await waitFor(() => expect(screen.queryByText(t('connection.degradedBanner'))).toBeNull());
  });

  it('passes axe', async () => {
    const { container } = renderWithI18n(<ConnectionBadge quality="poor" videoPaused />);
    await expectNoA11yViolations(container);
  });
});
