import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { VisuallyHidden } from './VisuallyHidden';

describe('VisuallyHidden', () => {
  it('renders children with sr-only class', () => {
    render(<VisuallyHidden>Hidden text</VisuallyHidden>);
    const el = screen.getByText('Hidden text');
    expect(el).toBeInTheDocument();
    expect(el.className).toContain('sr-only');
  });

  it('renders as div when specified', () => {
    render(<VisuallyHidden as="div">Hidden div</VisuallyHidden>);
    const el = screen.getByText('Hidden div');
    expect(el.tagName).toBe('DIV');
  });
});
