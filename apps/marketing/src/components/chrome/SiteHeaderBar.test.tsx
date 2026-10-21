import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { expectNoA11yViolations } from '@/test/axe';
import { SiteHeaderBar } from './SiteHeaderBar';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  usePathname: () => '/en/services',
}));

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'marketing:nav.services': 'Services',
        'marketing:nav.forEmployers': 'For employers',
        'marketing:nav.forEmployees': 'For employees',
        'marketing:nav.resources': 'Resources',
        'marketing:nav.plans': 'Plans',
        'marketing:nav.about': 'About',
        'marketing:actions.requestDemo': 'Request a demo',
        'marketing:locale.switcherLabel': 'Language',
        'common:nav.openMenu': 'Open menu',
        'common:nav.closeMenu': 'Close menu',
      };
      return map[key] ?? key;
    },
  }),
}));

describe('SiteHeaderBar', () => {
  it('renders the brand link', () => {
    render(<SiteHeaderBar locale="en" />);
    const brand = screen.getByText('nestself');
    expect(brand).toHaveAttribute('href', '/en');
  });

  it('renders all navigation links', () => {
    render(<SiteHeaderBar locale="en" />);
    expect(screen.getByText('Services')).toHaveAttribute('href', '/en/services');
    expect(screen.getByText('For employers')).toHaveAttribute('href', '/en/for-employers');
    expect(screen.getByText('For employees')).toHaveAttribute('href', '/en/for-employees');
    expect(screen.getByText('Resources')).toHaveAttribute('href', '/en/resources');
    expect(screen.getByText('Plans')).toHaveAttribute('href', '/en/plans');
    expect(screen.getByText('About')).toHaveAttribute('href', '/en/about');
  });

  it('marks the current page with aria-current', () => {
    render(<SiteHeaderBar locale="en" />);
    const servicesLink = screen.getByText('Services');
    expect(servicesLink).toHaveAttribute('aria-current', 'page');

    const aboutLink = screen.getByText('About');
    expect(aboutLink).not.toHaveAttribute('aria-current');
  });

  it('renders the demo CTA', () => {
    render(<SiteHeaderBar locale="en" />);
    expect(screen.getByText('Request a demo')).toHaveAttribute('href', '/en/demo');
  });

  it('passes axe', async () => {
    const { container } = render(<SiteHeaderBar locale="en" />);
    await expectNoA11yViolations(container);
  });
});
