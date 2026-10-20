import type { Meta, StoryObj } from '@storybook/react-vite';
import { BookingDemo } from './BookingDemo';

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(amount);

const meta: Meta<typeof BookingDemo> = {
  title: 'Patterns/BookingDemo',
  component: BookingDemo,
};
export default meta;

export const Default: StoryObj = {
  render: () => (
    <div className="max-w-sm mx-auto">
      <BookingDemo
        advisor={{ name: 'Dr. Smith', initials: 'DS', title: 'Licensed Counselor' }}
        slots={[
          { id: '1', label: '9:00 AM', available: true },
          { id: '2', label: '10:00 AM', available: true },
          { id: '3', label: '11:00 AM', available: false },
          { id: '4', label: '2:00 PM', available: true },
          { id: '5', label: '3:00 PM', available: true },
          { id: '6', label: '4:00 PM', available: true },
        ]}
        pricing={{ price: 100, employerCovers: 80, youPay: 20 }}
        timeZone="Europe/Dublin"
        labels={{
          step: 'Step',
          chooseSlot: 'Choose a time',
          reviewAndConfirm: 'Review and confirm',
          selectTime: 'Select a time',
          advisorCard: 'Your advisor',
          confirm: 'Confirm and pay',
          terms: 'Change and cancellation terms',
          termsTitle: 'Terms and conditions',
          termsBody: 'You can cancel or reschedule up to 24 hours before your session at no charge. Cancellations within 24 hours are non-refundable.',
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
        }}
        formatCurrency={formatCurrency}
        onAnnounce={(msg) => console.log('Announced:', msg)}
      />
    </div>
  ),
};

export const States: StoryObj = {
  render: () => (
    <div className="max-w-sm mx-auto">
      <p className="type-label mb-4">Interactive demo (select a slot, continue, confirm, reset)</p>
      <BookingDemo
        advisor={{ name: 'Dr. Smith', initials: 'DS', title: 'Licensed Counselor' }}
        slots={[
          { id: '1', label: '9:00 AM', available: true },
          { id: '2', label: '10:00 AM', available: true },
        ]}
        pricing={{ price: 50, employerCovers: 50, youPay: 0 }}
        timeZone="Europe/Belgrade"
        labels={{
          step: 'Step',
          chooseSlot: 'Choose a time',
          reviewAndConfirm: 'Review and confirm',
          selectTime: 'Select a time',
          advisorCard: 'Your advisor',
          confirm: 'Confirm and pay',
          terms: 'Change and cancellation terms',
          termsTitle: 'Terms and conditions',
          termsBody: 'Standard cancellation policy applies.',
          termsAccept: 'I understand',
          termsCancel: 'Go back',
          doneTitle: 'Done',
          doneMessage: 'This is a demonstration. Nothing was created.',
          doneAnnouncement: 'Booking complete.',
          reset: 'Start over',
          price: 'Session price',
          employerCovers: 'Employer covers',
          youPay: 'You pay',
          timeZoneLabel: 'Times in CET',
          continueLabel: 'Continue',
          back: 'Back',
        }}
        formatCurrency={formatCurrency}
      />
    </div>
  ),
};
