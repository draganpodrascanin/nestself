import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { ReadingColumn } from './ReadingColumn';

describe('ReadingColumn', () => {
  it('renders children', () => {
    render(<ReadingColumn><p>Hello</p></ReadingColumn>);
    expect(screen.getByText('Hello')).toBeInTheDocument();
  });

  it('applies additional className', () => {
    const { container } = render(
      <ReadingColumn className="mt-8">content</ReadingColumn>,
    );
    const el = container.firstElementChild!;
    expect(el.className).toContain('mt-8');
    expect(el.className).toContain('mx-auto');
    expect(el.className).toContain('max-w-[720px]');
  });
});
