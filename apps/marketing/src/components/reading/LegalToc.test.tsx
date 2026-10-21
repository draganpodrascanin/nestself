import { render, screen } from '@testing-library/react';
import { describe, it, expect } from 'vitest';
import { LegalToc, slugify } from './LegalToc';

describe('slugify', () => {
  it('converts headings to URL-safe slugs', () => {
    expect(slugify('Data We Collect')).toBe('data-we-collect');
  });

  it('handles Serbian Latin', () => {
    expect(slugify('Podaci koje prikupljamo')).toBe('podaci-koje-prikupljamo');
  });

  it('strips punctuation', () => {
    expect(slugify('Who? What & Why!')).toBe('who-what-why');
  });
});

describe('LegalToc', () => {
  const sections = [
    { heading: 'Introduction', id: 'introduction' },
    { heading: 'Data Collection', id: 'data-collection' },
  ];

  it('renders anchor links for each section', () => {
    render(
      <LegalToc
        sections={sections}
        otherPages={[]}
        otherPagesHeading="Legal"
        navLabel="On this page"
        navLabelId="toc-heading"
      />,
    );
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', '#introduction');
    expect(links[1]).toHaveAttribute('href', '#data-collection');
  });

  it('renders other pages when provided', () => {
    render(
      <LegalToc
        sections={sections}
        otherPages={[{ label: 'Terms', href: '/legal/terms' }]}
        otherPagesHeading="Legal"
        navLabel="On this page"
        navLabelId="toc-heading"
      />,
    );
    expect(screen.getByText('Terms')).toBeInTheDocument();
    expect(screen.getByText('Terms').closest('a')).toHaveAttribute('href', '/legal/terms');
  });

  it('has accessible nav landmark', () => {
    render(
      <LegalToc
        sections={sections}
        otherPages={[]}
        otherPagesHeading="Legal"
        navLabel="On this page"
        navLabelId="toc-heading"
      />,
    );
    expect(screen.getByRole('navigation')).toHaveAttribute('aria-labelledby', 'toc-heading');
  });
});
