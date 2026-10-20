import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Avatar } from './Avatar';
import { expectNoA11yViolations } from '../../../test/axe';

describe('Avatar', () => {
  it('shows initials fallback when src is absent', () => {
    render(<Avatar initials="JD" name="Jane Doe" />);
    expect(screen.getByRole('img', { name: 'Jane Doe' })).toHaveTextContent('JD');
  });

  it('renders an image with alt when src is provided', () => {
    render(<Avatar initials="JD" name="Jane Doe" src="/photo.jpg" />);
    const img = screen.getByRole('img', { name: 'Jane Doe' });
    expect(img.tagName).toBe('IMG');
    expect(img).toHaveAttribute('src', '/photo.jpg');
  });

  it('uses rounded-full for sm size', () => {
    const { container } = render(<Avatar initials="A" name="Alice" size="sm" />);
    const el = container.firstElementChild as HTMLElement;
    expect(el.className).toContain('rounded-full');
  });

  it('uses rounded-card for md and lg sizes', () => {
    const { container: c1 } = render(<Avatar initials="B" name="Bob" size="md" />);
    expect((c1.firstElementChild as HTMLElement).className).toContain('rounded-card');

    const { container: c2 } = render(<Avatar initials="C" name="Carol" size="lg" />);
    expect((c2.firstElementChild as HTMLElement).className).toContain('rounded-card');
  });

  it('passes axe a11y check with initials', async () => {
    const { container } = render(<Avatar initials="JD" name="Jane Doe" />);
    await expectNoA11yViolations(container);
  });

  it('passes axe a11y check with image', async () => {
    const { container } = render(<Avatar initials="JD" name="Jane Doe" src="/photo.jpg" />);
    await expectNoA11yViolations(container);
  });
});
