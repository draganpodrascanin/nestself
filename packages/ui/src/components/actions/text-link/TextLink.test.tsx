import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { TextLink, LinkButton } from './TextLink';
import { expectNoA11yViolations } from '../../../test/axe';

describe('TextLink', () => {
  it('renders an anchor with the href', () => {
    render(<TextLink href="/about">About</TextLink>);
    const link = screen.getByRole('link', { name: 'About' });
    expect(link).toHaveAttribute('href', '/about');
  });

  it('renders trailing arrow when specified', () => {
    const { container } = render(<TextLink href="/next" trailingArrow>Next</TextLink>);
    const arrow = container.querySelector('[aria-hidden]');
    expect(arrow).toBeTruthy();
  });
});

describe('LinkButton', () => {
  it('renders an anchor with button styles and the href', () => {
    render(<LinkButton href="/cta">Get started</LinkButton>);
    const link = screen.getByRole('link', { name: 'Get started' });
    expect(link).toHaveAttribute('href', '/cta');
    expect(link.tagName).toBe('A');
  });

  it('passes axe a11y check', async () => {
    const { container } = render(<LinkButton href="/cta">Get started</LinkButton>);
    await expectNoA11yViolations(container);
  });
});
