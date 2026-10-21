import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
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
    Object.defineProperty(document, 'cookie', {
      writable: true,
      value: '',
    });
  });

  it('trigger has accessible name "Language: English"', () => {
    render(<LocaleSwitcher locale="en" />);
    // The trigger contains VisuallyHidden "Language: " plus visible "English"
    const trigger = screen.getByRole('button');
    expect(trigger.textContent).toContain('Language');
    expect(trigger.textContent).toContain('English');
  });

  it('opening shows four menuitem links with correct hrefs', async () => {
    const user = userEvent.setup();
    render(<LocaleSwitcher locale="en" />);
    await user.click(screen.getByRole('button'));
    const items = await screen.findAllByRole('menuitem');
    expect(items).toHaveLength(4);
    // Check hrefs
    const hrefs = items.map((item) => item.getAttribute('href'));
    expect(hrefs).toContain('/sr-Latn/services');
    expect(hrefs).toContain('/sr-Cyrl/services');
    expect(hrefs).toContain('/hu/services');
    expect(hrefs).toContain('/en/services');
  });

  it('the current item has aria-current="true"', async () => {
    const user = userEvent.setup();
    render(<LocaleSwitcher locale="en" />);
    await user.click(screen.getByRole('button'));
    const items = await screen.findAllByRole('menuitem');
    const enItem = items.find((item) => item.getAttribute('href') === '/en/services');
    expect(enItem).toHaveAttribute('aria-current', 'true');
    const srItem = items.find((item) => item.getAttribute('href') === '/sr-Latn/services');
    expect(srItem).not.toHaveAttribute('aria-current');
  });

  it('clicking an item sets the cookie', async () => {
    const user = userEvent.setup();
    render(<LocaleSwitcher locale="en" />);
    await user.click(screen.getByRole('button'));
    const items = await screen.findAllByRole('menuitem');
    const huItem = items.find((item) => item.getAttribute('href') === '/hu/services');
    if (huItem) await user.click(huItem);
    expect(document.cookie).toContain('NEXT_LOCALE=hu');
  });

  it('passes axe', async () => {
    const { container } = render(<LocaleSwitcher locale="en" />);
    await expectNoA11yViolations(container);
  });
});
