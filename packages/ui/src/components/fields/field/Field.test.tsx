import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Field, Input, Textarea, Select } from './Field';
import { expectNoA11yViolations } from '../../../test/axe';

describe('Field', () => {
  it('renders label and connects to control', () => {
    render(
      <Field label="Email" required>
        <Input type="email" />
      </Field>,
    );
    const input = screen.getByRole('textbox');
    expect(input).toBeInTheDocument();
    expect(screen.getByText('Email')).toBeInTheDocument();
  });

  it('shows error text and sets aria-invalid on the field root', () => {
    const { container } = render(
      <Field label="Name" error="Required">
        <Input />
      </Field>,
    );
    const errorEl = screen.getByText('Required');
    expect(errorEl).toBeInTheDocument();
    // Base UI Field.Root sets data-invalid on the root div when invalid={true}
    const fieldRoot = container.querySelector('[data-invalid]');
    expect(fieldRoot).toBeTruthy();
    // The input should also have aria-invalid set by Base UI
    const input = screen.getByRole('textbox');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    // The error text should be referenced by aria-describedby on the input
    const describedBy = input.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const referencedEl = container.querySelector(`#${CSS.escape(describedBy!.split(' ').find((id) => {
      const el = document.getElementById(id);
      return el?.textContent?.includes('Required');
    }) ?? '')}`);
    expect(referencedEl).toBeTruthy();
    expect(referencedEl!.textContent).toContain('Required');
  });

  it('adds required indicator and aria-required', () => {
    render(
      <Field label="Name" required>
        <Input required />
      </Field>,
    );
    expect(screen.getByText('*')).toBeInTheDocument();
    const input = screen.getByRole('textbox');
    // The native required attribute maps to aria-required="true" in the accessibility tree
    expect(input).toBeRequired();
  });

  it('passes axe a11y check', async () => {
    const { container } = render(
      <Field label="Name">
        <Input />
      </Field>,
    );
    await expectNoA11yViolations(container);
  });
});

describe('Textarea', () => {
  it('renders a textarea element', () => {
    const { container } = render(
      <Field label="Bio">
        <Textarea />
      </Field>,
    );
    const textarea = container.querySelector('textarea');
    expect(textarea).toBeTruthy();
  });
});

describe('Select', () => {
  const options = [
    { value: 'a', label: 'Option A' },
    { value: 'b', label: 'Option B' },
  ];

  it('renders a trigger with placeholder', () => {
    render(
      <Field label="Choice">
        <Select options={options} placeholder="Pick one" />
      </Field>,
    );
    expect(screen.getByText('Pick one')).toBeInTheDocument();
  });

  it('combobox has accessible name from Field label', () => {
    render(
      <Field label="Choice">
        <Select options={options} placeholder="Pick one" />
      </Field>,
    );
    expect(screen.getByRole('combobox', { name: 'Choice' })).toBeInTheDocument();
  });

  it('opens with keyboard (ArrowDown), selects with Enter and exposes the chosen value', async () => {
    const handleChange = vi.fn();
    render(
      <Field label="Choice">
        <Select options={options} placeholder="Pick one" onValueChange={handleChange} />
      </Field>,
    );

    const user = userEvent.setup();
    // Focus the trigger button
    const trigger = screen.getByRole('combobox');
    await user.click(trigger);
    // Press ArrowDown to open and navigate to first option
    await user.keyboard('{ArrowDown}');
    // Press Enter to select the highlighted option
    await user.keyboard('{Enter}');
    // The chosen value should be exposed via onValueChange
    expect(handleChange).toHaveBeenCalledWith('a', expect.anything());
  });
});

describe('Select motion', () => {
  const choices = [
    { value: 'a', label: 'Alpha' },
    { value: 'b', label: 'Beta' },
  ];

  it('animates the listbox open, hides it after closing and reopens it', async () => {
    const user = userEvent.setup();
    const handleChange = vi.fn();
    render(
      <Field label="Choice">
        <Select options={choices} placeholder="Pick one" onValueChange={handleChange} />
      </Field>,
    );
    const trigger = screen.getByRole('combobox');
    await user.click(trigger);
    const listbox = await screen.findByRole('listbox');
    expect(listbox.style.transform).toMatch(/^scale\(/);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('listbox')).not.toBeInTheDocument());
    await user.click(trigger);
    await user.click(await screen.findByRole('option', { name: 'Beta' }));
    expect(handleChange).toHaveBeenCalledWith('b', expect.anything());
  });
});
