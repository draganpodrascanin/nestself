import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Card } from './Card';
import { expectNoA11yViolations } from '../../../test/axe';

describe('Card', () => {
  it('renders as a div by default', () => {
    const { container } = render(<Card>Content</Card>);
    expect(container.firstElementChild!.tagName).toBe('DIV');
    expect(screen.getByText('Content')).toBeInTheDocument();
  });

  it('renders as the specified element', () => {
    const { container } = render(<Card as="article">Content</Card>);
    expect(container.firstElementChild!.tagName).toBe('ARTICLE');
  });

  it('renders as a list item', () => {
    render(
      <ul>
        <Card as="li">Item</Card>
      </ul>,
    );
    expect(screen.getByRole('listitem')).toBeInTheDocument();
  });

  it('renders as a section', () => {
    const { container } = render(
      <Card as="section">
        <h2>Section heading</h2>
        Section content
      </Card>,
    );
    expect(container.firstElementChild!.tagName).toBe('SECTION');
  });

  it('applies padding classes', () => {
    const { container } = render(<Card padding="lg">Content</Card>);
    const el = container.firstElementChild!;
    expect(el.className).toContain('p-');
  });

  it('applies no padding when padding is none', () => {
    const { container } = render(<Card padding="none">Content</Card>);
    const el = container.firstElementChild!;
    expect(el.className).not.toMatch(/\bp-[0-9]/);
  });

  it('applies tone classes for surface', () => {
    const { container } = render(<Card tone="surface">Content</Card>);
    const el = container.firstElementChild!;
    expect(el.className).toContain('bg-surface');
  });

  it('applies tone classes for subtle', () => {
    const { container } = render(<Card tone="subtle">Content</Card>);
    const el = container.firstElementChild!;
    expect(el.className).toContain('bg-canvas');
  });

  it('applies tone classes for brand', () => {
    const { container } = render(<Card tone="brand">Content</Card>);
    const el = container.firstElementChild!;
    expect(el.className).toContain('bg-accent-soft');
  });

  it('passes axe a11y check', async () => {
    const { container } = render(
      <Card as="article" padding="md" tone="surface">
        <h2>Card heading</h2>
        <p>Card body content.</p>
      </Card>,
    );
    await expectNoA11yViolations(container);
  });
});
