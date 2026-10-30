import { describe, expect, it } from 'vitest';
import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoA11yViolations } from '@nestself/ui/test';
import { renderWithI18n, t } from '../test/i18n';
import { CrisisBlock, CrisisResourcesButton } from './CrisisBlock';
import { SERBIA_CRISIS_LINES } from './crisis-lines';

describe('CrisisBlock (UX-17, D-CW-38, CALL-12)', () => {
  it('lists the Serbian hotlines as phone links, with the platform disclaimer', () => {
    renderWithI18n(<CrisisBlock />);
    expect(SERBIA_CRISIS_LINES.map((line) => line.number)).toEqual(['112', '194', '0800 300 303']);
    expect(screen.getByRole('heading', { name: t('crisis.title') })).toBeInTheDocument();
    expect(screen.getByText(t('crisis.country.serbia'))).toBeInTheDocument();
    const emergency = screen.getByRole('link', { name: t('crisis.callLabel', { name: t('crisis.lines.emergency'), number: '112' }) });
    expect(emergency).toHaveAttribute('href', 'tel:112');
    expect(screen.getByRole('link', { name: /0800 300 303/ })).toHaveAttribute('href', 'tel:0800300303');
    expect(screen.getByText(t('crisis.disclaimer'))).toBeInTheDocument();
  });

  it('has no Hungarian hotlines before a Hungarian launch (D-CW-38)', () => {
    renderWithI18n(<CrisisBlock audience="expert" />);
    expect(screen.queryByText(/116 123|\b104\b/)).toBeNull();
    expect(screen.getAllByRole('link')).toHaveLength(3);
  });

  it('adds emergency guidance for the expert only', () => {
    const { unmount } = renderWithI18n(<CrisisBlock audience="employee" />);
    expect(screen.queryByText(t('crisis.expertTitle'))).toBeNull();
    unmount();
    renderWithI18n(<CrisisBlock audience="expert" />);
    expect(screen.getByRole('heading', { name: t('crisis.expertTitle') })).toBeInTheDocument();
    expect(screen.getByText(t('crisis.expertSteps.call'))).toBeInTheDocument();
  });

  it('opens from the in-call button as an animated sheet and closes with Escape', async () => {
    const user = userEvent.setup();
    renderWithI18n(<CrisisResourcesButton audience="employee" />);
    await user.click(screen.getByRole('button', { name: t('crisis.open') }));
    const sheet = await screen.findByRole('dialog', { name: t('crisis.title') });
    expect(within(sheet).getByRole('link', { name: /112/ })).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(document.querySelector('[role="dialog"]')).not.toBeNull();
    await waitFor(() => expect(document.querySelector('[role="dialog"]')).toBeNull());
    expect(screen.getByRole('button', { name: t('crisis.open') })).toHaveFocus();
  });

  it('passes axe', async () => {
    const { container } = renderWithI18n(<CrisisBlock audience="expert" />);
    await expectNoA11yViolations(container);
  });
});
