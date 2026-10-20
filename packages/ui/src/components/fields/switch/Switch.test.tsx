import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Switch } from './Switch';
import { expectNoA11yViolations } from '../../../test/axe';

describe('Switch', () => {
  it('exposes role=switch with aria-checked toggling on click', async () => {
    const onCheckedChange = vi.fn();
    render(<Switch onCheckedChange={onCheckedChange}>Dark mode</Switch>);
    const sw = screen.getByRole('switch');
    expect(sw).toHaveAttribute('aria-checked', 'false');
    const user = userEvent.setup();
    await user.click(sw);
    expect(onCheckedChange).toHaveBeenCalled();
    expect(onCheckedChange.mock.calls[0]?.[0]).toBe(true);
  });

  it('toggles on Space', async () => {
    const onCheckedChange = vi.fn();
    render(<Switch onCheckedChange={onCheckedChange}>Notify</Switch>);
    const sw = screen.getByRole('switch');
    sw.focus();
    const user = userEvent.setup();
    await user.keyboard(' ');
    expect(onCheckedChange).toHaveBeenCalled();
    expect(onCheckedChange.mock.calls[0]?.[0]).toBe(true);
  });

  it('has an accessible name matching the label text', () => {
    render(<Switch>Dark mode</Switch>);
    expect(screen.getByRole('switch', { name: 'Dark mode' })).toBeInTheDocument();
  });

  it('passes axe a11y check', async () => {
    const { container } = render(<Switch>Toggle</Switch>);
    await expectNoA11yViolations(container);
  });
});
