import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Heading, Text, Eyebrow } from './Typography';

describe('Heading', () => {
  it('renders the correct heading level', () => {
    render(<Heading level={2}>Hello</Heading>);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('Hello');
  });

  it('applies the typeRole class', () => {
    render(<Heading level={1} typeRole="display">Big</Heading>);
    const el = screen.getByRole('heading', { level: 1 });
    expect(el.className).toContain('type-display');
  });
});

describe('Text', () => {
  it('renders with body typeRole by default', () => {
    render(<Text>Hello</Text>);
    const el = screen.getByText('Hello');
    expect(el.className).toContain('type-body');
  });

  it('applies secondary tone', () => {
    render(<Text tone="secondary">Muted</Text>);
    const el = screen.getByText('Muted');
    expect(el.className).toContain('text-text-secondary');
  });
});

describe('Eyebrow', () => {
  it('applies numbered variant', () => {
    render(<Eyebrow numbered>Step 1</Eyebrow>);
    const el = screen.getByText('Step 1');
    expect(el.className).toContain('uppercase');
  });
});
