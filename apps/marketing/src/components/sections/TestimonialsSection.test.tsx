import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoA11yViolations } from '@/test/axe';
import { TestimonialsSection } from './TestimonialsSection';
import type { Testimonial } from './TestimonialsSection';

const sampleItems: Testimonial[] = [
  {
    id: 'test-1',
    placeholder: true,
    name: 'Jelena M.',
    role: 'HR Director',
    company: 'logistics company, Novi Sad',
    country: 'RS',
    quote: {
      en: 'Launching NestSelf was straightforward.',
      'sr-Latn': 'Lansiranje NestSelf-a je bilo jednostavno.',
      'sr-Cyrl': 'Лансирање NestSelf-а је било једноставно.',
      hu: 'A NestSelf bevezetese egyszerű volt.',
    },
  },
  {
    id: 'test-2',
    placeholder: true,
    name: 'Marko T.',
    role: 'People Lead',
    company: 'IT services firm, Belgrade',
    country: 'RS',
    quote: {
      en: 'Employees freely use the support.',
      'sr-Latn': 'Zaposleni slobodno koriste podršku.',
      'sr-Cyrl': 'Запослени слободно користе подршку.',
      hu: 'A munkavallalok szabadon hasznaljak a tamogatast.',
    },
  },
];

const baseProps = {
  id: 'testimonials',
  title: 'What people say',
  items: sampleItems,
  locale: 'en',
};

describe('TestimonialsSection', () => {
  it('renders an h2 with the title', () => {
    render(<TestimonialsSection {...baseProps} />);
    expect(screen.getByRole('heading', { level: 2 })).toHaveTextContent('What people say');
  });

  it('sets data-placeholder="true" on the section', () => {
    render(<TestimonialsSection {...baseProps} />);
    const section = screen.getByRole('region', { name: 'What people say' });
    expect(section).toHaveAttribute('data-placeholder', 'true');
  });

  it('renders testimonials as a list', () => {
    render(<TestimonialsSection {...baseProps} />);
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('renders initials avatars', () => {
    render(<TestimonialsSection {...baseProps} />);
    const avatar = screen.getByRole('img', { name: 'Jelena M.' });
    expect(avatar).toHaveTextContent('JM');
  });

  it('renders blockquotes with the correct locale quote', () => {
    const { container } = render(<TestimonialsSection {...baseProps} locale="en" />);
    const blockquotes = container.querySelectorAll('blockquote');
    expect(blockquotes).toHaveLength(2);
    expect(blockquotes[0]!.textContent).toContain('Launching NestSelf was straightforward.');
  });

  it('renders lead when provided', () => {
    render(<TestimonialsSection {...baseProps} lead="Sample testimonials" />);
    expect(screen.getByText('Sample testimonials')).toBeInTheDocument();
  });

  it('has no axe violations', async () => {
    const { container } = render(
      <main>
        <TestimonialsSection {...baseProps} />
      </main>,
    );
    await expectNoA11yViolations(container);
  });
});
