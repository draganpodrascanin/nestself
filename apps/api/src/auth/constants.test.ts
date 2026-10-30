import { describe, it, expect } from 'vitest';
import { PUBLIC_EMAIL_DOMAINS, isPublicEmailDomain } from './constants.js';

describe('PUBLIC_EMAIL_DOMAINS (3.4.3 step 2, DR-07)', () => {
  it('is exactly the strategy initial set', () => {
    expect([...PUBLIC_EMAIL_DOMAINS].sort()).toEqual(
      [
        'gmail.com',
        'yahoo.com',
        'hotmail.com',
        'outlook.com',
        'live.com',
        'icloud.com',
        'aol.com',
        'protonmail.com',
        'mail.com',
        'yandex.com',
        'zoho.com',
        'gmx.com',
        'fastmail.com',
      ].sort(),
    );
    expect(PUBLIC_EMAIL_DOMAINS).toHaveLength(13);
  });

  it('matches every listed domain', () => {
    for (const domain of PUBLIC_EMAIL_DOMAINS) expect(isPublicEmailDomain(domain), domain).toBe(true);
  });

  it('normalises case, whitespace and a trailing root dot', () => {
    expect(isPublicEmailDomain('  GMail.COM ')).toBe(true);
    expect(isPublicEmailDomain('outlook.com.')).toBe(true);
  });

  it('does not match employer domains, subdomains or look-alikes', () => {
    for (const domain of ['acme.example', 'mail.gmail.com', 'gmail.co', 'notgmail.com', 'gmail.com.evil.example', '']) {
      expect(isPublicEmailDomain(domain), domain).toBe(false);
    }
  });
});
