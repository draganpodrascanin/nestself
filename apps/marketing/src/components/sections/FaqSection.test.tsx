import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { expectNoA11yViolations } from '@/test/axe';
import { FaqSection } from './FaqSection';

const baseProps = {
  id: 'faq',
  title: 'Frequently asked questions',
  items: [
    { question: 'What is NestSelf?', answer: 'An employee wellbeing platform.' },
    { question: 'Is it confidential?', answer: 'Yes, always.' },
  ],
};

describe('FaqSection', () => {
  it('renders an h2 with the title', () => {
    render(<FaqSection {...baseProps} />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent(
      'Frequently asked questions',
    );
  });

  it('renders accordion triggers with question text', () => {
    render(<FaqSection {...baseProps} />);
    expect(screen.getByRole('button', { name: 'What is NestSelf?' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Is it confidential?' })).toBeInTheDocument();
  });

  it('opens a panel on click', async () => {
    const user = userEvent.setup();
    render(<FaqSection {...baseProps} />);
    const trigger = screen.getByRole('button', { name: 'What is NestSelf?' });
    await user.click(trigger);
    expect(screen.getByText('An employee wellbeing platform.')).toBeVisible();
  });

  it('emits FAQPage JSON-LD', () => {
    const { container } = render(<FaqSection {...baseProps} />);
    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).not.toBeNull();
    const data = JSON.parse(script!.innerHTML);
    expect(data['@type']).toBe('FAQPage');
    expect(data.mainEntity).toHaveLength(2);
    expect(data.mainEntity[0].name).toBe('What is NestSelf?');
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <main>
        <FaqSection {...baseProps} />
      </main>,
    );
    await expectNoA11yViolations(container);
  });
});
