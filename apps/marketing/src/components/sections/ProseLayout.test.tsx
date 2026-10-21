import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ProseLayout } from './ProseLayout';

describe('ProseLayout', () => {
  it('renders children', () => {
    render(
      <ProseLayout>
        <p>Main content</p>
      </ProseLayout>,
    );
    expect(screen.getByText('Main content')).toBeInTheDocument();
  });

  it('renders aside when provided', () => {
    render(
      <ProseLayout aside={<nav>Sidebar</nav>}>
        <p>Main content</p>
      </ProseLayout>,
    );
    expect(screen.getByText('Sidebar')).toBeInTheDocument();
    expect(screen.getByRole('complementary')).toBeInTheDocument();
  });

  it('passes className through', () => {
    const { container } = render(
      <ProseLayout className="custom">
        <p>Content</p>
      </ProseLayout>,
    );
    expect(container.firstElementChild).toHaveClass('custom');
  });

  it('does not horizontally centre the prose column', () => {
    const { container } = render(
      <ProseLayout>
        <p>Content</p>
      </ProseLayout>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    // Should not have mx-auto (left-aligned)
    expect(wrapper.className).not.toContain('mx-auto');
  });

  it('constrains the prose column to a reading width', () => {
    const { container } = render(
      <ProseLayout>
        <p>Content</p>
      </ProseLayout>,
    );
    const prose = container.querySelector('[data-prose]') as HTMLElement;
    expect(prose).toBeTruthy();
    expect(prose.className).toContain('max-w-[68ch]');
  });

  it('uses a grid layout when aside is present', () => {
    const { container } = render(
      <ProseLayout aside={<div>Aside</div>}>
        <p>Content</p>
      </ProseLayout>,
    );
    const wrapper = container.firstElementChild as HTMLElement;
    expect(wrapper.className).toContain('grid');
  });
});
