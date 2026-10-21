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
});
