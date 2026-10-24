import { describe, it, expect } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { SiteHeader } from './SiteHeader';
import { expectNoA11yViolations } from '../../../test/axe';

const defaultProps = {
  brand: { label: 'NestSelf', href: '/' },
  links: [
    { label: 'Home', href: '/', current: true },
    { label: 'About', href: '/about' },
    { label: 'Contact', href: '/contact' },
  ],
  menuLabel: 'Open menu',
  closeLabel: 'Close menu',
};

describe('SiteHeader', () => {
  it('renders brand and links', () => {
    render(<SiteHeader {...defaultProps} />);
    expect(screen.getByText('NestSelf')).toBeInTheDocument();
    expect(screen.getByText('Home')).toBeInTheDocument();
    expect(screen.getByText('About')).toBeInTheDocument();
  });

  it('menu toggle button has aria-expanded', () => {
    render(<SiteHeader {...defaultProps} />);
    const toggle = screen.getByRole('button', { name: 'Open menu' });
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
  });

  it('toggling menu changes aria-expanded and button label', async () => {
    const user = userEvent.setup();
    render(<SiteHeader {...defaultProps} />);
    const toggle = screen.getByRole('button', { name: 'Open menu' });
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(toggle).toHaveAttribute('aria-label', 'Close menu');
  });

  it('menu toggle has aria-controls pointing to the nav', () => {
    render(<SiteHeader {...defaultProps} />);
    const toggle = screen.getByRole('button', { name: 'Open menu' });
    expect(toggle).toHaveAttribute('aria-controls', 'site-nav');
    expect(document.getElementById('site-nav')).toBeInTheDocument();
  });

  it('renders utilities on every width', () => {
    render(
      <SiteHeader
        {...defaultProps}
        utilities={<button data-testid="lang-switch">EN</button>}
      />,
    );
    expect(screen.getByTestId('lang-switch')).toBeInTheDocument();
  });

  it('passes axe a11y check', async () => {
    const { container } = render(<SiteHeader {...defaultProps} />);
    await expectNoA11yViolations(container);
  });
});

describe('SiteHeader motion', () => {
  it('collapsed navigation is out of the layout, the tab order and the accessibility tree', () => {
    render(<SiteHeader {...defaultProps} />);
    const row = document.getElementById('site-nav')!.parentElement!;
    expect(row.style.display).toBe('none');
    expect(row.style.visibility).toBe('hidden');
  });

  it('expands the navigation row and collapses it again', async () => {
    const user = userEvent.setup();
    render(<SiteHeader {...defaultProps} />);
    const row = document.getElementById('site-nav')!.parentElement!;
    const toggle = screen.getByRole('button', { name: 'Open menu' });
    await user.click(toggle);
    await waitFor(() => expect(row.style.visibility).toBe('visible'));
    expect(row.style.display).toBe('block');
    await user.click(screen.getByRole('button', { name: 'Close menu' }));
    await waitFor(() => expect(row.style.display).toBe('none'));
    expect(row.style.visibility).toBe('hidden');
  });
});
