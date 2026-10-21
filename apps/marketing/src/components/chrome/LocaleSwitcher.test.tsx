import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { expectNoA11yViolations } from '@/test/axe';
import { LocaleSwitcher } from './LocaleSwitcher';

// Mock next/navigation
vi.mock('next/navigation', () => ({
  usePathname: () => '/en/services',
}));

// Mock react-i18next
vi.mock('react-i18next', () => ({
  useTranslation: () => ({
    t: (key: string) => {
      const map: Record<string, string> = {
        'marketing:locale.switcherLabel': 'Language',
      };
      return map[key] ?? key;
    },
  }),
}));

describe('LocaleSwitcher', () => {
  beforeEach(() => {
    // Reset cookies
    Object.defineProperty(document, 'cookie', {
      writable: true,
      value: '',
    });
  });

  it('renders four locale links', () => {
    render(<LocaleSwitcher locale="en" />);
    const nav = screen.getByRole('navigation', { name: 'Language' });
    const links = nav.querySelectorAll('a');
    expect(links).toHaveLength(4);
  });

  it('marks the current locale with aria-current', () => {
    render(<LocaleSwitcher locale="en" />);
    const enLink = screen.getByText('English');
    expect(enLink).toHaveAttribute('aria-current', 'true');

    const srLink = screen.getByText('Srpski');
    expect(srLink).not.toHaveAttribute('aria-current');
  });

  it('generates correct hrefs for each locale', () => {
    render(<LocaleSwitcher locale="en" />);
    expect(screen.getByText('English')).toHaveAttribute('href', '/en/services');
    expect(screen.getByText('Srpski')).toHaveAttribute('href', '/sr-Latn/services');
    expect(screen.getByText('Magyar')).toHaveAttribute('href', '/hu/services');
  });

  it('sets NEXT_LOCALE cookie on click', () => {
    render(<LocaleSwitcher locale="en" />);
    const huLink = screen.getByText('Magyar');
    fireEvent.click(huLink);
    expect(document.cookie).toContain('NEXT_LOCALE=hu');
  });

  it('passes axe', async () => {
    const { container } = render(<LocaleSwitcher locale="en" />);
    await expectNoA11yViolations(container);
  });
});
