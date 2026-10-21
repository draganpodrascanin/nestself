import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoA11yViolations } from '@/test/axe';
import { StepsSection } from './StepsSection';

const baseProps = {
  id: 'steps',
  title: 'How it works',
  steps: [
    { title: 'Step 1', body: 'First step body.' },
    { title: 'Step 2', body: 'Second step body.' },
    { title: 'Step 3', body: 'Third step body.' },
  ],
};

describe('StepsSection', () => {
  it('renders an h2 with the title', () => {
    render(<StepsSection {...baseProps} />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('How it works');
  });

  it('renders each step as an h3', () => {
    render(<StepsSection {...baseProps} />);
    const h3s = screen.getAllByRole('heading', { level: 3 });
    expect(h3s).toHaveLength(3);
    expect(h3s[0]).toHaveTextContent('Step 1');
  });

  it('renders as an ordered list with N items', () => {
    render(<StepsSection {...baseProps} />);
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(3);
  });

  it('renders plain number markers 1..N that are aria-hidden', () => {
    const { container } = render(<StepsSection {...baseProps} />);
    const markers = container.querySelectorAll('[aria-hidden="true"].rounded-full');
    expect(markers).toHaveLength(3);
    expect(markers[0]!.textContent).toBe('1');
    expect(markers[1]!.textContent).toBe('2');
    expect(markers[2]!.textContent).toBe('3');
  });

  it('renders optional lead when given', () => {
    render(<StepsSection {...baseProps} lead="A short lead paragraph." />);
    expect(screen.getByText('A short lead paragraph.')).toBeInTheDocument();
  });

  it('does not render lead when omitted', () => {
    const { container } = render(<StepsSection {...baseProps} />);
    // No bodyLarge text should appear beyond the step bodies
    expect(container.querySelector('[class*="bodyLarge"]')).toBeNull();
  });

  it('renders a photo when the photo prop is given', () => {
    render(
      <StepsSection
        {...baseProps}
        photo={{ key: 'employees-break', alt: 'Colleagues on a break' }}
      />,
    );
    const img = screen.getByRole('img', { name: 'Colleagues on a break' });
    expect(img).toBeInTheDocument();
  });

  it('does not render a photo when the photo prop is omitted', () => {
    render(<StepsSection {...baseProps} />);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <main>
        <StepsSection {...baseProps} />
      </main>,
    );
    await expectNoA11yViolations(container);
  });
});
