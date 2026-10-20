import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { RadioGroup, RadioItem } from './RadioGroup';
import { expectNoA11yViolations } from '../../../test/axe';

describe('RadioGroup', () => {
  it('selects on click', async () => {
    const onValueChange = vi.fn();
    render(
      <RadioGroup label="Colour" onValueChange={onValueChange}>
        <RadioItem value="red">Red</RadioItem>
        <RadioItem value="blue">Blue</RadioItem>
      </RadioGroup>,
    );
    const radio = screen.getByRole('radio', { name: 'Red' });
    const user = userEvent.setup();
    await user.click(radio);
    expect(onValueChange).toHaveBeenCalled();
    expect(onValueChange.mock.calls[0]?.[0]).toBe('red');
  });

  it('reflects data-checked on selected radio', () => {
    render(
      <RadioGroup label="Colour" defaultValue="blue">
        <RadioItem value="red">Red</RadioItem>
        <RadioItem value="blue">Blue</RadioItem>
      </RadioGroup>,
    );
    const blue = screen.getByRole('radio', { name: 'Blue' });
    expect(blue).toHaveAttribute('data-checked', '');
  });

  it('has an accessible group name', () => {
    render(
      <RadioGroup label="Colour">
        <RadioItem value="red">Red</RadioItem>
      </RadioGroup>,
    );
    expect(screen.getByRole('radiogroup', { name: 'Colour' })).toBeInTheDocument();
  });

  it('passes axe a11y check', async () => {
    const { container } = render(
      <RadioGroup label="Colour">
        <RadioItem value="red">Red</RadioItem>
        <RadioItem value="blue">Blue</RadioItem>
      </RadioGroup>,
    );
    await expectNoA11yViolations(container);
  });
});
