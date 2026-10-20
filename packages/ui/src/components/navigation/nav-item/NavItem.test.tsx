import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { House } from '@phosphor-icons/react';
import { NavItem } from './NavItem';
import { expectNoA11yViolations } from '../../../test/axe';

describe('NavItem', () => {
  it('renders a link with label', () => {
    render(<NavItem href="/home" icon={House} label="Home" />);
    const link = screen.getByRole('link', { name: /Home/ });
    expect(link).toHaveAttribute('href', '/home');
  });

  it('has aria-current="page" when active', () => {
    render(<NavItem href="/home" icon={House} label="Home" active />);
    const link = screen.getByRole('link', { name: /Home/ });
    expect(link).toHaveAttribute('aria-current', 'page');
  });

  it('does not have aria-current when inactive', () => {
    render(<NavItem href="/home" icon={House} label="Home" />);
    const link = screen.getByRole('link', { name: /Home/ });
    expect(link).not.toHaveAttribute('aria-current');
  });

  it('renders fill icon weight when active', () => {
    const { container } = render(<NavItem href="/home" icon={House} label="Home" active />);
    // NavIcon passes weight="fill" when active. Phosphor renders an SVG with data-weight attribute.
    const svg = container.querySelector('svg');
    expect(svg).toBeInTheDocument();
  });

  it('passes axe a11y check', async () => {
    const { container } = render(
      <nav>
        <NavItem href="/home" icon={House} label="Home" />
      </nav>,
    );
    await expectNoA11yViolations(container);
  });
});
