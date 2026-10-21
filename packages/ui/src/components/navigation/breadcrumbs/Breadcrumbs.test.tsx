import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Breadcrumbs } from './Breadcrumbs';
import { expectNoA11yViolations } from '../../../test/axe';

const items = [
  { label: 'Home', href: '/' },
  { label: 'Resources', href: '/resources' },
  { label: 'Articles' },
];

describe('Breadcrumbs', () => {
  it('renders a nav with the given aria-label', () => {
    render(<Breadcrumbs label="Breadcrumb" items={items} />);
    expect(screen.getByRole('navigation', { name: 'Breadcrumb' })).toBeInTheDocument();
  });

  it('renders an ordered list', () => {
    render(<Breadcrumbs label="Breadcrumb" items={items} />);
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('marks the last item with aria-current="page"', () => {
    render(<Breadcrumbs label="Breadcrumb" items={items} />);
    const current = screen.getByText('Articles');
    expect(current).toHaveAttribute('aria-current', 'page');
  });

  it('renders links for items with href', () => {
    render(<Breadcrumbs label="Breadcrumb" items={items} />);
    expect(screen.getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(screen.getByRole('link', { name: 'Resources' })).toHaveAttribute('href', '/resources');
  });

  it('renders the last item as plain text, not a link', () => {
    render(<Breadcrumbs label="Breadcrumb" items={items} />);
    expect(screen.queryByRole('link', { name: 'Articles' })).not.toBeInTheDocument();
    expect(screen.getByText('Articles')).toBeInTheDocument();
  });

  it('renders separators as aria-hidden', () => {
    const { container } = render(<Breadcrumbs label="Breadcrumb" items={items} />);
    const separators = container.querySelectorAll('[aria-hidden="true"]');
    // 2 separators between 3 items, plus 2 SVG icons (each has aria-hidden)
    expect(separators.length).toBeGreaterThanOrEqual(2);
  });

  it('passes axe a11y check', async () => {
    const { container } = render(<Breadcrumbs label="Breadcrumb" items={items} />);
    await expectNoA11yViolations(container);
  });
});
