import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Button } from './Button';
import { expectNoA11yViolations } from '../../../test/axe';

describe('Button', () => {
  it('activates on Enter key', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Press me</Button>);
    const btn = screen.getByRole('button', { name: 'Press me' });
    btn.focus();
    const user = userEvent.setup();
    await user.keyboard('{Enter}');
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('activates on Space key', async () => {
    const onClick = vi.fn();
    render(<Button onClick={onClick}>Tap me</Button>);
    const btn = screen.getByRole('button', { name: 'Tap me' });
    btn.focus();
    const user = userEvent.setup();
    await user.keyboard(' ');
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('blocks onClick when loading', async () => {
    const onClick = vi.fn();
    render(<Button loading onClick={onClick}>Save</Button>);
    const btn = screen.getByRole('button');
    const user = userEvent.setup();
    await user.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('sets aria-busy when loading', () => {
    render(<Button loading>Saving</Button>);
    const btn = screen.getByRole('button');
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  it('keeps label in DOM while loading', () => {
    render(<Button loading>Keep visible</Button>);
    expect(screen.getByText('Keep visible')).toBeInTheDocument();
  });

  it('sets data-disabled and blocks click when disabled', async () => {
    const onClick = vi.fn();
    render(<Button disabled onClick={onClick}>No</Button>);
    const btn = screen.getByRole('button', { name: 'No' });
    expect(btn).toHaveAttribute('data-disabled', '');
    const user = userEvent.setup();
    await user.click(btn);
    expect(onClick).not.toHaveBeenCalled();
  });

  it('renders each variant', () => {
    const variants = ['primary', 'secondary', 'ghost', 'danger', 'on-brand'] as const;
    for (const variant of variants) {
      const { unmount } = render(<Button variant={variant}>{variant}</Button>);
      expect(screen.getByRole('button', { name: variant })).toBeInTheDocument();
      unmount();
    }
  });

  it('passes axe a11y check', async () => {
    const { container } = render(<Button>Accessible</Button>);
    await expectNoA11yViolations(container);
  });
});
