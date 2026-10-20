import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { AppShell } from './AppShell';
import { expectNoA11yViolations } from '../../../test/axe';

describe('AppShell', () => {
  it('renders main element with id and tabIndex', () => {
    render(<AppShell>Content</AppShell>);
    const main = screen.getByRole('main');
    expect(main).toHaveAttribute('id', 'main');
    expect(main).toHaveAttribute('tabindex', '-1');
  });

  it('renders sidebar when provided', () => {
    render(<AppShell sidebar={<div>Sidebar</div>}>Content</AppShell>);
    expect(screen.getByText('Sidebar')).toBeInTheDocument();
  });

  it('renders topbar when provided', () => {
    render(<AppShell topbar={<div>Topbar</div>}>Content</AppShell>);
    expect(screen.getByText('Topbar')).toBeInTheDocument();
  });

  it('renders bottom bar when provided', () => {
    render(<AppShell bottomBar={<div>Bottom</div>}>Content</AppShell>);
    expect(screen.getByText('Bottom')).toBeInTheDocument();
  });

  it('renders children in main', () => {
    render(<AppShell>Page content</AppShell>);
    expect(screen.getByRole('main')).toHaveTextContent('Page content');
  });

  it('passes axe a11y check', async () => {
    const { container } = render(<AppShell>Content</AppShell>);
    await expectNoA11yViolations(container);
  });
});
