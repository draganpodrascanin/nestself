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

  it('renders numbered eyebrows starting at 01', () => {
    render(<StepsSection {...baseProps} />);
    expect(screen.getByText('01')).toBeInTheDocument();
    expect(screen.getByText('02')).toBeInTheDocument();
    expect(screen.getByText('03')).toBeInTheDocument();
  });

  it('renders as an ordered list', () => {
    render(<StepsSection {...baseProps} />);
    expect(screen.getByRole('list')).toBeInTheDocument();
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
