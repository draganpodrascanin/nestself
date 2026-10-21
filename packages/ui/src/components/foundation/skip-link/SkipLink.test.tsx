import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { SkipLink } from './SkipLink';

describe('SkipLink', () => {
  it('renders a link to #main by default', () => {
    render(<SkipLink>Skip to content</SkipLink>);
    const link = screen.getByRole('link', { name: 'Skip to content' });
    expect(link).toHaveAttribute('href', '#main');
  });

  it('renders a custom href', () => {
    render(<SkipLink href="#content">Skip</SkipLink>);
    const link = screen.getByRole('link', { name: 'Skip' });
    expect(link).toHaveAttribute('href', '#content');
  });

  it('uses focus-visible (not focus) for the translate class', () => {
    render(<SkipLink>Skip to content</SkipLink>);
    const link = screen.getByRole('link', { name: 'Skip to content' });
    expect(link.className).toContain('focus-visible:translate-y-0');
    expect(link.className).not.toContain('focus:translate-y-0');
  });
});
