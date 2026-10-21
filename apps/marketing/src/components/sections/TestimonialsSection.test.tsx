import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoA11yViolations } from '@/test/axe';
import { TestimonialsSection } from './TestimonialsSection';
import type { SampleTestimonial } from '@nestself/sample-data';

const sampleItems: SampleTestimonial[] = [
  {
    id: 'test-1',
    placeholder: true,
    name: 'Jelena M.',
    role: {
      en: 'HR Director',
      'sr-Latn': 'Direktorka ljudskih resursa',
      'sr-Cyrl': 'Директорка људских ресурса',
      hu: 'HR-igazgató',
    },
    company: {
      en: 'logistics company, Novi Sad',
      'sr-Latn': 'logistička kompanija, Novi Sad',
      'sr-Cyrl': 'логистичка компанија, Нови Сад',
      hu: 'logisztikai vállalat, Újvidék',
    },
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
    role: {
      en: 'People Lead',
      'sr-Latn': 'Rukovodilac za ljude i kulturu',
      'sr-Cyrl': 'Руководилац за људе и културу',
      hu: 'People Lead',
    },
    company: {
      en: 'IT services firm, Belgrade',
      'sr-Latn': 'IT kompanija, Beograd',
      'sr-Cyrl': 'ИТ компанија, Београд',
      hu: 'IT-szolgáltató cég, Belgrád',
    },
    country: 'RS',
    quote: {
      en: 'Employees freely use the support.',
      'sr-Latn': 'Zaposleni slobodno koriste podršku.',
      'sr-Cyrl': 'Запослени слободно користе подршку.',
      hu: 'A munkavallalok szabadon hasznaljak a tamogatast.',
    },
  },
  {
    id: 'test-3',
    placeholder: true,
    name: 'Ana P.',
    role: { en: 'Team Lead', 'sr-Latn': 'Vođa tima', 'sr-Cyrl': 'Вођа тима', hu: 'Csapatvezető' },
    company: { en: 'financial firm', 'sr-Latn': 'finansijska firma', 'sr-Cyrl': 'финансијска фирма', hu: 'pénzügyi cég' },
    country: 'HU',
    quote: { en: 'Third quote.', 'sr-Latn': 'Treći citat.', 'sr-Cyrl': 'Трећи цитат.', hu: 'Harmadik idézet.' },
  },
  {
    id: 'test-4',
    placeholder: true,
    name: 'Milica S.',
    role: { en: 'Employee', 'sr-Latn': 'Zaposlena', 'sr-Cyrl': 'Запослена', hu: 'Munkavállaló' },
    company: { en: 'retail company', 'sr-Latn': 'maloprodajna kompanija', 'sr-Cyrl': 'малопродајна компанија', hu: 'kiskereskedelmi vállalat' },
    country: 'RS',
    quote: { en: 'Fourth quote.', 'sr-Latn': 'Četvrti citat.', 'sr-Cyrl': 'Четврти цитат.', hu: 'Negyedik idézet.' },
  },
  {
    id: 'test-5',
    placeholder: true,
    name: 'Dragan K.',
    role: { en: 'CEO', 'sr-Latn': 'Generalni direktor', 'sr-Cyrl': 'Генерални директор', hu: 'Ügyvezető igazgató' },
    company: { en: 'manufacturing co', 'sr-Latn': 'proizvodna kompanija', 'sr-Cyrl': 'производна компанија', hu: 'gyártó vállalat' },
    country: 'RS',
    quote: { en: 'Fifth quote.', 'sr-Latn': 'Peti citat.', 'sr-Cyrl': 'Пети цитат.', hu: 'Ötödik idézet.' },
  },
  {
    id: 'test-6',
    placeholder: true,
    name: 'Zoltán B.',
    role: { en: 'Works Council', 'sr-Latn': 'Član saveta', 'sr-Cyrl': 'Члан савета', hu: 'Üzemi tanács tagja' },
    company: { en: 'construction co', 'sr-Latn': 'građevinska kompanija', 'sr-Cyrl': 'грађевинска компанија', hu: 'építőipari vállalat' },
    country: 'HU',
    quote: { en: 'Sixth quote.', 'sr-Latn': 'Šesti citat.', 'sr-Cyrl': 'Шести цитат.', hu: 'Hatodik idézet.' },
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

  it('renders six list items', () => {
    render(<TestimonialsSection {...baseProps} />);
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(6);
  });

  it('renders badge when provided', () => {
    render(<TestimonialsSection {...baseProps} badge="Sample data" />);
    expect(screen.getByText('Sample data')).toBeInTheDocument();
  });

  it('marks the first card as featured via data-featured', () => {
    const { container } = render(<TestimonialsSection {...baseProps} />);
    const featured = container.querySelector('[data-featured="true"]');
    expect(featured).toBeInTheDocument();
  });

  it('shows localised role', () => {
    render(<TestimonialsSection {...baseProps} locale="en" />);
    expect(screen.getByText(/HR Director/)).toBeInTheDocument();
  });

  it('renders blockquotes with the correct locale quote', () => {
    const { container } = render(<TestimonialsSection {...baseProps} locale="en" />);
    const blockquotes = container.querySelectorAll('blockquote');
    expect(blockquotes).toHaveLength(6);
    expect(blockquotes[0]!.textContent).toContain('Launching NestSelf was straightforward.');
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
