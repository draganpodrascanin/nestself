import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BookingDemo } from './BookingDemo';
import type { BookingDemoLabels } from './BookingDemo';
import type { TimeSlot } from '../time-slot-grid/TimeSlotGrid';

const slots: TimeSlot[] = [
  { id: '1', label: '9:00 AM', available: true },
  { id: '2', label: '10:00 AM', available: true },
  { id: '3', label: '11:00 AM', available: false },
];

const pricing = { price: 100, employerCovers: 80, youPay: 20 };

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(amount);

const labels: BookingDemoLabels = {
  step: 'Step',
  chooseSlot: 'Choose a time',
  reviewAndConfirm: 'Review and confirm',
  selectTime: 'Select a time',
  advisorCard: 'Your advisor',
  confirm: 'Confirm and pay',
  terms: 'Change and cancellation terms',
  termsTitle: 'Terms and conditions',
  termsBody: 'You can cancel up to 24 hours before your session.',
  termsAccept: 'I understand',
  termsCancel: 'Go back',
  doneTitle: 'Done',
  doneMessage: 'This is a demonstration. Nothing was created.',
  doneAnnouncement: 'Booking complete. This is a demonstration.',
  reset: 'Start over',
  price: 'Session price',
  employerCovers: 'Employer covers',
  youPay: 'You pay',
  timeZoneLabel: 'Times in CET',
  continueLabel: 'Continue',
  back: 'Back',
};

describe('BookingDemo', () => {
  it('cannot continue without a slot', () => {
    render(
      <BookingDemo
        advisor={{ name: 'Dr. Smith', initials: 'DS', title: 'Advisor' }}
        slots={slots}
        pricing={pricing}
        timeZone="CET"
        labels={labels}
        formatCurrency={formatCurrency}
      />,
    );
    const continueBtn = screen.getByRole('button', { name: 'Continue' });
    expect(continueBtn).toBeDisabled();
  });

  it('confirm button text includes the amount', async () => {
    const user = userEvent.setup();
    render(
      <BookingDemo
        advisor={{ name: 'Dr. Smith', initials: 'DS', title: 'Advisor' }}
        slots={slots}
        pricing={pricing}
        timeZone="CET"
        labels={labels}
        formatCurrency={formatCurrency}
      />,
    );

    // Select a slot
    await user.click(screen.getByRole('button', { name: '9:00 AM' }));
    // Continue to review
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    const confirmBtn = screen.getByRole('button', { name: /Confirm and pay/ });
    expect(confirmBtn.textContent).toContain(formatCurrency(20));
  });

  it('completing announces labels.doneAnnouncement through onAnnounce', async () => {
    const user = userEvent.setup();
    const onAnnounce = vi.fn();
    render(
      <BookingDemo
        advisor={{ name: 'Dr. Smith', initials: 'DS', title: 'Advisor' }}
        slots={slots}
        pricing={pricing}
        timeZone="CET"
        labels={labels}
        formatCurrency={formatCurrency}
        onAnnounce={onAnnounce}
      />,
    );

    // Select slot and continue
    await user.click(screen.getByRole('button', { name: '9:00 AM' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));

    // Confirm
    await user.click(screen.getByRole('button', { name: /Confirm and pay/ }));

    expect(onAnnounce).toHaveBeenCalledWith('Booking complete. This is a demonstration.');
  });

  it('reset returns to step 1', async () => {
    const user = userEvent.setup();
    render(
      <BookingDemo
        advisor={{ name: 'Dr. Smith', initials: 'DS', title: 'Advisor' }}
        slots={slots}
        pricing={pricing}
        timeZone="CET"
        labels={labels}
        formatCurrency={formatCurrency}
      />,
    );

    // Go through full flow
    await user.click(screen.getByRole('button', { name: '9:00 AM' }));
    await user.click(screen.getByRole('button', { name: 'Continue' }));
    await user.click(screen.getByRole('button', { name: /Confirm and pay/ }));

    // Should show done state
    expect(screen.getByText(labels.doneMessage)).toBeInTheDocument();

    // Click reset
    await user.click(screen.getByRole('button', { name: 'Start over' }));

    // Should be back at step 1
    expect(screen.getByText('Your advisor')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Continue' })).toBeDisabled();
  });
});
