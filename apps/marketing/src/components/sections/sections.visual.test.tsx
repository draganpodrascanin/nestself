import { describe, it, expect, vi, afterAll, beforeEach } from 'vitest';
import { render } from '@testing-library/react';
import { expectNoA11yViolations } from '@/test/axe';
import { PageHero } from './PageHero';
import { SplitSection } from './SplitSection';
import { FeatureGrid } from './FeatureGrid';
import { StepsSection } from './StepsSection';
import { FaqSection } from './FaqSection';
import { TestimonialsSection } from './TestimonialsSection';
import type { SampleTestimonial } from '@nestself/sample-data';
import { CtaBand } from './CtaBand';
import { TrustStrip } from './TrustStrip';
import { PlansSection } from './PlansSection';
import { ResourceTeasers } from './ResourceTeasers';
import { ProseLayout } from './ProseLayout';

const sampleTestimonials: SampleTestimonial[] = [
  {
    id: 'vis-1',
    placeholder: true,
    name: 'Jelena M.',
    role: { en: 'HR Director', 'sr-Latn': 'Direktorka ljudskih resursa', 'sr-Cyrl': 'Директорка људских ресурса', hu: 'HR-igazgató' },
    company: { en: 'logistics company', 'sr-Latn': 'logistička kompanija', 'sr-Cyrl': 'логистичка компанија', hu: 'logisztikai vállalat' },
    country: 'RS',
    quote: { en: 'Great experience.', 'sr-Latn': 'Odlično iskustvo.', 'sr-Cyrl': 'Одлично искуство.', hu: 'Remek élmény.' },
  },
  {
    id: 'vis-2',
    placeholder: true,
    name: 'Marko T.',
    role: { en: 'People Lead', 'sr-Latn': 'People Lead', 'sr-Cyrl': 'People Lead', hu: 'People Lead' },
    company: { en: 'tech firm', 'sr-Latn': 'IT firma', 'sr-Cyrl': 'ИТ фирма', hu: 'tech cég' },
    country: 'RS',
    quote: { en: 'Easy to use.', 'sr-Latn': 'Lako za korišćenje.', 'sr-Cyrl': 'Лако за коришћење.', hu: 'Könnyen használható.' },
  },
];

/** Suppress console.error during render so the test output stays clean. */
const consoleSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

afterAll(() => {
  consoleSpy.mockRestore();
});

describe('sections visual smoke (axe + no console errors)', () => {
  beforeEach(() => {
    consoleSpy.mockClear();
  });

  it('PageHero (split)', async () => {
    const { container } = render(
      <main>
        <PageHero
          eyebrow="Wellbeing"
          title="Support for your people"
          lead="Psychological, legal and financial support."
          primaryCta={{ label: 'Get started', href: '/contact' }}
          variant="split"
        />
      </main>,
    );
    await expectNoA11yViolations(container);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('PageHero (stacked)', async () => {
    const { container } = render(
      <main>
        <PageHero
          title="Employee wellbeing"
          lead="Support when you need it."
          primaryCta={{ label: 'Sign up', href: '/start' }}
          variant="stacked"
        />
      </main>,
    );
    await expectNoA11yViolations(container);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('PageHero (quiet)', async () => {
    const { container } = render(
      <main>
        <PageHero
          title="About NestSelf"
          lead="Our story."
          primaryCta={{ label: 'Read more', href: '/about' }}
          variant="quiet"
        />
      </main>,
    );
    await expectNoA11yViolations(container);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('SplitSection', async () => {
    const { container } = render(
      <main>
        <SplitSection
          id="split"
          title="How we help"
          paragraphs={['We provide support.']}
          photo={{ key: 'family-grass', alt: 'Family' }}
        />
      </main>,
    );
    await expectNoA11yViolations(container);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('FeatureGrid', async () => {
    const { container } = render(
      <main>
        <FeatureGrid
          id="grid"
          title="Services"
          columns={3}
          items={[
            { icon: 'heart', title: 'Psychological', body: 'Talk to a psychologist.' },
            { icon: 'scales', title: 'Legal', body: 'Get legal guidance.' },
            { icon: 'wallet', title: 'Financial', body: 'Plan your finances.' },
          ]}
        />
      </main>,
    );
    await expectNoA11yViolations(container);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('StepsSection', async () => {
    const { container } = render(
      <main>
        <StepsSection
          id="steps"
          title="How it works"
          steps={[
            { title: 'Sign up', body: 'Register your company.' },
            { title: 'Configure', body: 'Set up your plan.' },
          ]}
        />
      </main>,
    );
    await expectNoA11yViolations(container);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('FaqSection', async () => {
    const { container } = render(
      <main>
        <FaqSection
          id="faq"
          title="FAQ"
          items={[{ question: 'What is NestSelf?', answer: 'An employee wellbeing platform.' }]}
        />
      </main>,
    );
    await expectNoA11yViolations(container);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('TestimonialsSection', async () => {
    const { container } = render(
      <main>
        <TestimonialsSection
          id="testimonials"
          title="What people say"
          items={sampleTestimonials}
          locale="en"
        />
      </main>,
    );
    await expectNoA11yViolations(container);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('CtaBand', async () => {
    const { container } = render(
      <main>
        <CtaBand
          id="cta"
          title="Ready to start?"
          primary={{ label: 'Request a demo', href: '/contact' }}
        />
      </main>,
    );
    await expectNoA11yViolations(container);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('TrustStrip', async () => {
    const { container } = render(
      <main>
        <TrustStrip
          ariaLabel="Trust facts"
          items={[
            { icon: 'shield-check', label: 'Confidential' },
            { icon: 'lock-key', label: 'Encrypted' },
          ]}
        />
      </main>,
    );
    await expectNoA11yViolations(container);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('PlansSection', async () => {
    const { container } = render(
      <main>
        <PlansSection
          tiers={[
            {
              name: 'Essential',
              audience: 'Small teams',
              includes: ['Psychological support'],
              cta: { label: 'Start', href: '/contact' },
            },
          ]}
          note="Contact us for pricing."
        />
      </main>,
    );
    await expectNoA11yViolations(container);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('ResourceTeasers', async () => {
    const { container } = render(
      <main>
        <ResourceTeasers
          id="resources"
          title="Resources"
          articles={[
            {
              href: '/articles/burnout',
              title: 'Recognising burnout',
              description: 'Early warning signs.',
              topicLabel: 'Psychological',
              readingLabel: '5 min',
              cover: { key: 'article-morning', alt: 'Morning reading' },
              dateLabel: '15 Oct 2026',
            },
          ]}
          webinars={[
            {
              href: '/webinars/stress',
              title: 'Managing stress',
              description: 'Live session on stress.',
              dateLabel: '20 Oct 2026',
              durationLabel: '45 min',
              formatLabel: 'Live',
              languagesLabel: 'EN, SR',
              cover: { key: 'webinar-speaker', alt: 'Webinar speaker' },
            },
          ]}
          tools={[
            {
              href: '/tools/mood',
              title: 'Mood tracker',
              description: 'Track your daily mood.',
              kindLabel: 'Self-help tool',
              cover: { key: 'tools-notebook', alt: 'Notebook' },
            },
          ]}
          moreHref="/resources"
          moreLabel="See all resources"
        />
      </main>,
    );
    await expectNoA11yViolations(container);
    expect(consoleSpy).not.toHaveBeenCalled();
  });

  it('ProseLayout', async () => {
    const { container } = render(
      <main>
        <ProseLayout>
          <h2>Article heading</h2>
          <p>Article body.</p>
        </ProseLayout>
      </main>,
    );
    await expectNoA11yViolations(container);
    expect(consoleSpy).not.toHaveBeenCalled();
  });
});
