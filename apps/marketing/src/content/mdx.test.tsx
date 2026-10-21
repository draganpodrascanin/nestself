import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { renderMdx } from './mdx';

/**
 * MDX rendering tests.
 *
 * These run in the jsdom vitest project (*.test.tsx) with
 * @testing-library/react for DOM assertions.
 */

describe('renderMdx', () => {
  it('renders a heading with an id from rehype-slug', async () => {
    const source = '## Getting started\n\nSome introductory text.';
    const content = await renderMdx(source);
    const { container } = render(<>{content}</>);

    const heading = container.querySelector('h2');
    expect(heading).not.toBeNull();
    expect(heading!.id).toBe('getting-started');
    expect(heading!.textContent).toContain('Getting started');
  });

  it('renders a Callout component with the correct text', async () => {
    const source = '<Callout kind="tip">Always back up your data.</Callout>';
    const content = await renderMdx(source);
    const { container } = render(<>{content}</>);

    const alert = container.querySelector('[role="status"]');
    expect(alert).not.toBeNull();
    expect(alert!.textContent).toContain('Always back up your data.');
  });

  it('renders external links with target="_blank" and rel="noopener noreferrer"', async () => {
    const source = 'Visit [NestSelf](https://nestself.com) for more.';
    const content = await renderMdx(source);
    const { container } = render(<>{content}</>);

    const link = container.querySelector('a[href="https://nestself.com"]');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('target')).toBe('_blank');
    expect(link!.getAttribute('rel')).toBe('noopener noreferrer');
  });

  it('renders internal links without target="_blank"', async () => {
    const source = 'Read the [guide](/en/articles/example) next.';
    const content = await renderMdx(source);
    const { container } = render(<>{content}</>);

    const link = container.querySelector('a[href="/en/articles/example"]');
    expect(link).not.toBeNull();
    expect(link!.getAttribute('target')).toBeNull();
  });
});
