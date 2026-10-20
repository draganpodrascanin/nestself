import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Badge } from './Badge';
import { expectNoA11yViolations } from '../../../test/axe';

describe('Badge', () => {
  it('renders with neutral tone by default', () => {
    render(<Badge>Active</Badge>);
    expect(screen.getByText('Active')).toBeInTheDocument();
  });

  it('renders each tone', () => {
    const tones = ['neutral', 'success', 'warning', 'danger', 'info'] as const;
    for (const tone of tones) {
      const { unmount } = render(<Badge tone={tone}>{tone}</Badge>);
      expect(screen.getByText(tone)).toBeInTheDocument();
      unmount();
    }
  });

  it('passes axe a11y check', async () => {
    const { container } = render(<Badge tone="success">Approved</Badge>);
    await expectNoA11yViolations(container);
  });
});
