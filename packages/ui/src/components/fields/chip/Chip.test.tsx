import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Chip, ChipGroup } from './Chip';
import { expectNoA11yViolations } from '../../../test/axe';

describe('Chip', () => {
  it('toggles aria-pressed on click', async () => {
    const onPressedChange = vi.fn();
    render(<Chip pressed={false} onPressedChange={onPressedChange}>Tag</Chip>);
    const btn = screen.getByRole('button', { name: 'Tag' });
    expect(btn).toHaveAttribute('aria-pressed', 'false');
    const user = userEvent.setup();
    await user.click(btn);
    expect(onPressedChange).toHaveBeenCalledWith(true);
  });

  it('passes axe a11y check', async () => {
    const { container } = render(<Chip pressed={false} onPressedChange={() => {}}>Chip</Chip>);
    await expectNoA11yViolations(container);
  });
});

describe('ChipGroup', () => {
  it('renders a group with accessible label', () => {
    render(
      <ChipGroup label="Tags">
        <Chip pressed={false} onPressedChange={() => {}}>A</Chip>
      </ChipGroup>,
    );
    expect(screen.getByRole('group', { name: 'Tags' })).toBeInTheDocument();
  });
});
