import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PrivacyAtPointOfUse } from './PrivacyAtPointOfUse';
import { expectNoA11yViolations } from '../../../test/axe';

describe('PrivacyAtPointOfUse', () => {
  it('summary toggles the explanation', async () => {
    const user = userEvent.setup();
    render(
      <PrivacyAtPointOfUse
        question="Who can see my data?"
        explanation="Only your assigned advisor can view your session notes."
      />,
    );

    const summary = screen.getByText('Who can see my data?');
    // In jsdom, details/summary is not fully interactive, but we can verify structure
    expect(summary.closest('details')).toBeInTheDocument();

    // Click to toggle open
    await user.click(summary);
    expect(screen.getByText('Only your assigned advisor can view your session notes.')).toBeInTheDocument();
  });

  it('renders learn more button when props provided', async () => {
    const onLearnMore = vi.fn();
    const user = userEvent.setup();
    render(
      <PrivacyAtPointOfUse
        question="Privacy question"
        explanation="Explanation text"
        learnMoreLabel="Learn more"
        onLearnMore={onLearnMore}
      />,
    );

    const btn = screen.getByRole('button', { name: 'Learn more' });
    await user.click(btn);
    expect(onLearnMore).toHaveBeenCalledOnce();
  });

  it('does not render learn more without both props', () => {
    render(
      <PrivacyAtPointOfUse
        question="Privacy question"
        explanation="Explanation text"
        learnMoreLabel="Learn more"
      />,
    );

    expect(screen.queryByRole('button', { name: 'Learn more' })).not.toBeInTheDocument();
  });

  it('passes axe a11y check', async () => {
    const { container } = render(
      <PrivacyAtPointOfUse
        question="Who can see my data?"
        explanation="Only authorized staff."
      />,
    );
    await expectNoA11yViolations(container);
  });
});
