import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Checkbox, CheckboxGroup } from './Checkbox';
import { expectNoA11yViolations } from '../../../test/axe';

describe('Checkbox', () => {
  it('toggles on Space', async () => {
    const onCheckedChange = vi.fn();
    render(<Checkbox onCheckedChange={onCheckedChange}>Accept</Checkbox>);
    const checkbox = screen.getByRole('checkbox');
    checkbox.focus();
    const user = userEvent.setup();
    await user.keyboard(' ');
    expect(onCheckedChange).toHaveBeenCalled();
    expect(onCheckedChange.mock.calls[0]?.[0]).toBe(true);
  });

  it('reflects data-checked when checked', () => {
    render(<Checkbox checked>Yes</Checkbox>);
    const checkbox = screen.getByRole('checkbox');
    expect(checkbox).toHaveAttribute('data-checked', '');
  });

  it('has an accessible name matching the label text', () => {
    render(<Checkbox>Accept terms</Checkbox>);
    expect(screen.getByRole('checkbox', { name: 'Accept terms' })).toBeInTheDocument();
  });

  it('passes axe a11y check', async () => {
    const { container } = render(<Checkbox>Terms</Checkbox>);
    await expectNoA11yViolations(container);
  });
});

describe('CheckboxGroup', () => {
  it('renders a group with an accessible name', () => {
    render(
      <CheckboxGroup legend="Preferences">
        <Checkbox>Email</Checkbox>
        <Checkbox>SMS</Checkbox>
      </CheckboxGroup>,
    );
    const group = screen.getByRole('group', { name: 'Preferences' });
    expect(group).toBeInTheDocument();
  });

  it('passes aria-describedby to the group so an error is announced with it', () => {
    render(
      <>
        <CheckboxGroup legend="Actions" aria-describedby="actions-error">
          <Checkbox>Read</Checkbox>
        </CheckboxGroup>
        <p id="actions-error">Choose at least one action.</p>
      </>,
    );
    expect(screen.getByRole('group', { name: 'Actions' })).toHaveAccessibleDescription(
      'Choose at least one action.',
    );
  });
});
