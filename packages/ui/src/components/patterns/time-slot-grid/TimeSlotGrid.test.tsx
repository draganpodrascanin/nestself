import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { TimeSlotGrid } from './TimeSlotGrid';
import { expectNoA11yViolations } from '../../../test/axe';
import type { TimeSlot } from './TimeSlotGrid';

const slots: TimeSlot[] = [
  { id: '1', label: '9:00 AM', available: true },
  { id: '2', label: '10:00 AM', available: true },
  { id: '3', label: '11:00 AM', available: false },
  { id: '4', label: '2:00 PM', available: true },
];

describe('TimeSlotGrid', () => {
  it('selecting a slot sets aria-pressed on one chip only', async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    const { rerender } = render(
      <TimeSlotGrid
        slots={slots}
        selectedId={null}
        onSelect={onSelect}
        timeZoneLabel="Times in CET"
      />,
    );

    const slot1 = screen.getByRole('button', { name: '9:00 AM' });
    await user.click(slot1);
    expect(onSelect).toHaveBeenCalledWith('1');

    // Re-render with selection
    rerender(
      <TimeSlotGrid
        slots={slots}
        selectedId="1"
        onSelect={onSelect}
        timeZoneLabel="Times in CET"
      />,
    );

    const buttons = screen.getAllByRole('button');
    const pressedButtons = buttons.filter(
      (btn) => btn.getAttribute('aria-pressed') === 'true',
    );
    expect(pressedButtons).toHaveLength(1);
    expect(pressedButtons[0]).toHaveTextContent('9:00 AM');
  });

  it('unavailable slots are disabled', () => {
    render(
      <TimeSlotGrid
        slots={slots}
        selectedId={null}
        onSelect={() => {}}
        timeZoneLabel="Times in CET"
      />,
    );
    const unavailable = screen.getByRole('button', { name: '11:00 AM' });
    expect(unavailable).toBeDisabled();
  });

  it('has radiogroup role with label', () => {
    render(
      <TimeSlotGrid
        slots={slots}
        selectedId={null}
        onSelect={() => {}}
        timeZoneLabel="Times in CET"
      />,
    );
    expect(screen.getByRole('radiogroup', { name: 'Times in CET' })).toBeInTheDocument();
  });

  it('passes axe a11y check', async () => {
    const { container } = render(
      <TimeSlotGrid
        slots={slots}
        selectedId="1"
        onSelect={() => {}}
        timeZoneLabel="Times in CET"
      />,
    );
    await expectNoA11yViolations(container);
  });
});
