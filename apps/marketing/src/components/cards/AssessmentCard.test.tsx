import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoA11yViolations } from '@/test/axe';
import { AssessmentCard } from './AssessmentCard';

const baseProps = {
  href: '/tools/burnout-assessment',
  title: 'Burnout Assessment',
  intro: 'Check in with yourself.',
  durationLabel: '5 min',
  questionsLabel: '10 questions',
};

describe('AssessmentCard', () => {
  it('renders the title as a link inside an h3', () => {
    render(<AssessmentCard {...baseProps} />);
    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading).toHaveTextContent('Burnout Assessment');
    const link = screen.getByRole('link', { name: 'Burnout Assessment' });
    expect(link).toHaveAttribute('href', '/tools/burnout-assessment');
  });

  it('renders as an article element', () => {
    render(<AssessmentCard {...baseProps} />);
    expect(screen.getByRole('article')).toBeInTheDocument();
  });

  it('renders duration and question labels', () => {
    render(<AssessmentCard {...baseProps} />);
    expect(screen.getByText('5 min')).toBeInTheDocument();
    expect(screen.getByText('10 questions')).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <main>
        <AssessmentCard {...baseProps} />
      </main>,
    );
    await expectNoA11yViolations(container);
  });
});
