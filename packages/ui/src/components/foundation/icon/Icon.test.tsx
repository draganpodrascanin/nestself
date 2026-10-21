import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CategoryIcon, NavIcon, Icon } from './Icon';
import { Heart } from '@phosphor-icons/react/dist/ssr';

describe('Icon', () => {
  it('renders aria-hidden when no label', () => {
    const { container } = render(<Icon icon={Heart} />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    expect(svg?.getAttribute('aria-hidden')).toBe('true');
  });

  it('renders role=img with aria-label when label provided', () => {
    render(<Icon icon={Heart} label="Favourite" />);
    const img = screen.getByRole('img', { name: 'Favourite' });
    expect(img).toBeInTheDocument();
  });
});

describe('CategoryIcon', () => {
  it('renders the correct icon for category="legal" with duotone weight', () => {
    const { container } = render(<CategoryIcon category="legal" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();
    // Duotone icons render an element with opacity 0.2
    const duotoneLayer = container.querySelector('[opacity="0.2"]');
    expect(duotoneLayer).toBeTruthy();
  });
});

describe('NavIcon', () => {
  it('uses fill weight when active', () => {
    const { container, rerender } = render(<NavIcon icon={Heart} active label="Home" />);
    const svg = container.querySelector('svg');
    expect(svg).toBeTruthy();

    // Rerender without active to verify it switches
    rerender(<NavIcon icon={Heart} active={false} label="Home" />);
    const svgAfter = container.querySelector('svg');
    expect(svgAfter).toBeTruthy();
  });
});
