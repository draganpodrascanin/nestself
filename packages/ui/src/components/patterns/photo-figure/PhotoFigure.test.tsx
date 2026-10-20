import { describe, it, expect } from 'vitest';
import { render } from '@testing-library/react';
import { PhotoFigure } from './PhotoFigure';
import { focalObjectPosition } from '@nestself/assets';
import { expectNoA11yViolations } from '../../../test/axe';

describe('PhotoFigure', () => {
  it('priority sets fetchpriority="high"', () => {
    const { container } = render(
      <PhotoFigure
        photo="family-grass"
        alt="Family on grass"
        sizes="100vw"
        priority
      />,
    );
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('fetchpriority', 'high');
    expect(img).toHaveAttribute('loading', 'eager');
  });

  it('non-priority uses lazy loading', () => {
    const { container } = render(
      <PhotoFigure
        photo="family-grass"
        alt="Family on grass"
        sizes="100vw"
      />,
    );
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).not.toHaveAttribute('fetchpriority');
  });

  it('sources carry type="image/avif" and type="image/webp"', () => {
    const { container } = render(
      <PhotoFigure
        photo="family-grass"
        alt="Family on grass"
        sizes="100vw"
      />,
    );
    const sources = container.querySelectorAll('source');
    const types = Array.from(sources).map((s) => s.getAttribute('type'));
    expect(types).toContain('image/avif');
    expect(types).toContain('image/webp');
  });

  it('width and height are present', () => {
    const { container } = render(
      <PhotoFigure
        photo="family-grass"
        alt="Family on grass"
        sizes="100vw"
      />,
    );
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('width');
    expect(img).toHaveAttribute('height');
  });

  it('objectPosition equals the focal point', () => {
    const { container } = render(
      <PhotoFigure
        photo="family-grass"
        alt="Family on grass"
        sizes="100vw"
      />,
    );
    const img = container.querySelector('img') as HTMLImageElement;
    expect(img.style.objectPosition).toBe(focalObjectPosition('family-grass'));
  });

  it('a decorative figure has empty alt and aria-hidden caption-less', () => {
    const { container } = render(
      <PhotoFigure
        photo="family-grass"
        alt="Not used"
        sizes="100vw"
        decorative
      />,
    );
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('alt', '');
    const figure = container.querySelector('figure');
    expect(figure).toHaveAttribute('aria-hidden', 'true');
  });

  it('renders with an imageRole crop', () => {
    const { container } = render(
      <PhotoFigure
        photo="family-grass"
        alt="Family on grass"
        imageRole="hero-3x2"
        sizes="100vw"
      />,
    );
    const sources = container.querySelectorAll('source');
    expect(sources.length).toBeGreaterThanOrEqual(2);
    const img = container.querySelector('img');
    expect(img).toHaveAttribute('width', '1600');
    expect(img).toHaveAttribute('height', '1067');
  });

  it('passes axe a11y check', async () => {
    const { container } = render(
      <PhotoFigure
        photo="family-grass"
        alt="Family enjoying time on the grass"
        sizes="100vw"
      />,
    );
    await expectNoA11yViolations(container);
  });
});
