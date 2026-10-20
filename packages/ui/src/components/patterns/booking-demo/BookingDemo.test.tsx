import { describe, it, expect, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { BookingDemo } from './BookingDemo';
import type { BookingDemoLabels } from './BookingDemo';
import type { TimeSlot } from '../time-slot-grid/TimeSlotGrid';

const slots: TimeSlot[] = [
  { id: '1', label: '10:00', available: true },
  { id: '2', label: '16:30', available: true },
  { id: '3', label: '17:30', available: true },
  { id: '4', label: '18:30', available: true },
];

const pricing = { price: 45, employerCovers: 35, youPay: 10 };

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(amount);

const labels: BookingDemoLabels = {
  step: 'Step',
  chooseAdvisor: 'Choose an advisor',
  advisorLead: 'Find a format and a person that fit.',
  timesAvailable: 'Times available',
  seeTimes: 'See available times',
  chooseTime: 'Choose a time',
  chooseSlot: 'Choose a time',
  reviewAndConfirm: 'Review your appointment',
  selectTime: 'Select a time',
  advisorCard: 'Your advisor',
  confirm: 'Confirm and pay',
  terms: 'Change and cancellation terms',
  termsTitle: 'Terms and conditions',
  termsBody: 'You can cancel up to 24 hours before your session.',
  termsAccept: 'I understand',
  termsCancel: 'Go back',
  doneTitle: 'Example confirmed',
  doneMessage: 'In the product, the confirmation would show the time, cost and cancellation details. No appointment or payment was created here.',
  doneAnnouncement: 'Example confirmed. No payment or appointment was created.',
  reset: 'Start the example again',
  price: 'Appointment price',
  employerCovers: 'Employer covers',
  youPay: 'You pay',
  timeZoneLabel: 'Time zone',
  continueLabel: 'Continue',
  back: 'Back',
};

const advisor = {
  name: 'Milica Ristić',
  initials: 'MR',
  title: 'Psychological counselling',
  meta: 'Serbian · online',
};

const dateLabel = 'Wednesday, 21 October';

function renderDemo(overrides: Record<string, unknown> = {}) {
  return render(
    <BookingDemo
      advisor={advisor}
      slots={slots}
      pricing={pricing}
      timeZone="Europe/Belgrade"
      dateLabel={dateLabel}
      labels={labels}
      formatCurrency={formatCurrency}
      {...overrides}
    />,
  );
}

describe('BookingDemo', () => {
  it('cannot reach step 3 without a slot', async () => {
    const user = userEvent.setup();
    renderDemo();

    // Step 1: click "See available times" to go to step 2
    await user.click(screen.getByRole('button', { name: labels.seeTimes }));

    // Step 2: "Continue" should be disabled without a slot selected
    const continueBtn = screen.getByRole('button', { name: labels.continueLabel });
    expect(continueBtn).toBeDisabled();
  });

  it('step 1 -> 2 -> 3 heading focus moves each time', async () => {
    const user = userEvent.setup();
    renderDemo();

    // Step 1 heading should receive focus after requestAnimationFrame
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: labels.chooseAdvisor })).toHaveFocus();
    });

    // Move to step 2
    await user.click(screen.getByRole('button', { name: labels.seeTimes }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: labels.chooseTime })).toHaveFocus();
    });

    // Select a slot and continue to step 3
    await user.click(screen.getByRole('button', { name: '10:00' }));
    await user.click(screen.getByRole('button', { name: labels.continueLabel }));
    await waitFor(() => {
      expect(screen.getByRole('heading', { name: labels.reviewAndConfirm })).toHaveFocus();
    });
  });

  it('confirm button text includes the formatted amount', async () => {
    const user = userEvent.setup();
    renderDemo();

    // Navigate to step 2
    await user.click(screen.getByRole('button', { name: labels.seeTimes }));
    // Select a slot
    await user.click(screen.getByRole('button', { name: '10:00' }));
    // Continue to review
    await user.click(screen.getByRole('button', { name: labels.continueLabel }));

    const confirmBtn = screen.getByRole('button', { name: /Confirm and pay/ });
    expect(confirmBtn.textContent).toContain(formatCurrency(10));
  });

  it('completion announces labels.doneAnnouncement through onAnnounce', async () => {
    const user = userEvent.setup();
    const onAnnounce = vi.fn();
    renderDemo({ onAnnounce });

    // Navigate through all steps
    await user.click(screen.getByRole('button', { name: labels.seeTimes }));
    await user.click(screen.getByRole('button', { name: '10:00' }));
    await user.click(screen.getByRole('button', { name: labels.continueLabel }));
    await user.click(screen.getByRole('button', { name: /Confirm and pay/ }));

    expect(onAnnounce).toHaveBeenCalledWith(labels.doneAnnouncement);
  });

  it('reset returns to step 1', async () => {
    const user = userEvent.setup();
    renderDemo();

    // Go through full flow
    await user.click(screen.getByRole('button', { name: labels.seeTimes }));
    await user.click(screen.getByRole('button', { name: '10:00' }));
    await user.click(screen.getByRole('button', { name: labels.continueLabel }));
    await user.click(screen.getByRole('button', { name: /Confirm and pay/ }));

    // Should show done state
    expect(screen.getByText(labels.doneMessage)).toBeInTheDocument();

    // Click reset
    await user.click(screen.getByRole('button', { name: labels.reset }));

    // Should be back at step 1
    expect(screen.getByText(labels.chooseAdvisor)).toBeInTheDocument();
  });

  it('back buttons go to the previous step', async () => {
    const user = userEvent.setup();
    renderDemo();

    // Step 1 -> step 2
    await user.click(screen.getByRole('button', { name: labels.seeTimes }));
    expect(screen.getByRole('heading', { name: labels.chooseTime })).toBeInTheDocument();

    // Step 2 back -> step 1
    await user.click(screen.getByRole('button', { name: labels.back }));
    expect(screen.getByRole('heading', { name: labels.chooseAdvisor })).toBeInTheDocument();

    // Go forward again to step 2, select slot, go to step 3
    await user.click(screen.getByRole('button', { name: labels.seeTimes }));
    await user.click(screen.getByRole('button', { name: '10:00' }));
    await user.click(screen.getByRole('button', { name: labels.continueLabel }));
    expect(screen.getByRole('heading', { name: labels.reviewAndConfirm })).toBeInTheDocument();

    // Step 3 back -> step 2
    await user.click(screen.getByRole('button', { name: labels.back }));
    expect(screen.getByRole('heading', { name: labels.chooseTime })).toBeInTheDocument();
  });

  it('renders at initialStep without navigation', () => {
    renderDemo({ initialStep: 'done' });
    expect(screen.getByText(labels.doneTitle)).toBeInTheDocument();
  });

  it('uses formatStep for the step label when provided', () => {
    renderDemo({ formatStep: (current: number, total: number) => `Korak ${current} od ${total}` });
    expect(screen.getByText('Korak 1 od 3')).toBeInTheDocument();
  });
});
