import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { JsonLd } from './JsonLd';

describe('JsonLd', () => {
  it('renders a script tag with type application/ld+json', () => {
    const data = { '@type': 'Organization', name: 'NestSelf' };
    const { container } = render(<JsonLd data={data} />);
    const script = container.querySelector('script[type="application/ld+json"]');
    expect(script).not.toBeNull();
  });

  it('serialises the data as JSON', () => {
    const data = { '@type': 'FAQPage', mainEntity: [] };
    const { container } = render(<JsonLd data={data} />);
    const script = container.querySelector('script[type="application/ld+json"]')!;
    expect(JSON.parse(script.innerHTML)).toEqual(data);
  });

  it('escapes < as \\u003c to prevent script injection', () => {
    const data = { name: '</script><img src=x onerror=alert(1)>' };
    const { container } = render(<JsonLd data={data} />);
    const script = container.querySelector('script[type="application/ld+json"]')!;
    expect(script.innerHTML).not.toContain('<');
    expect(script.innerHTML).toContain('\\u003c');
    // The JSON should still parse correctly
    expect(JSON.parse(script.innerHTML)).toEqual(data);
  });
});
