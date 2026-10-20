import type { Meta, StoryObj } from '@storybook/react-vite';
import { BookingDemo } from './BookingDemo';
import type { BookingDemoLabels, BookingDemoAdvisor } from './BookingDemo';
import type { TimeSlot } from '../time-slot-grid/TimeSlotGrid';

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(amount);

const advisor: BookingDemoAdvisor = {
  name: 'Milica Ristić',
  initials: 'MR',
  title: 'Psychological counselling',
  meta: 'Serbian · online',
};

const slots: TimeSlot[] = [
  { id: '1', label: '10:00', available: true },
  { id: '2', label: '16:30', available: true },
  { id: '3', label: '17:30', available: true },
  { id: '4', label: '18:30', available: true },
];

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
  termsBody: 'You can cancel or reschedule up to 24 hours before your session at no charge. Cancellations within 24 hours are non-refundable.',
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

const pricing = { price: 45, employerCovers: 35, youPay: 10 };
const dateLabel = 'Wednesday, 21 October';

const meta: Meta<typeof BookingDemo> = {
  title: 'Patterns/BookingDemo',
  component: BookingDemo,
};
export default meta;

export const Default: StoryObj = {
  render: () => (
    <div className="max-w-sm mx-auto">
      <BookingDemo
        advisor={advisor}
        slots={slots}
        pricing={pricing}
        timeZone="Europe/Belgrade"
        dateLabel={dateLabel}
        labels={labels}
        formatCurrency={formatCurrency}
        onAnnounce={(msg) => console.log('Announced:', msg)}
      />
    </div>
  ),
};

export const States: StoryObj = {
  render: () => (
    <div className="max-w-sm mx-auto space-y-8">
      <div>
        <p className="type-label mb-4">Review variant (step 3, 16:30 preselected)</p>
        <BookingDemo
          advisor={advisor}
          slots={slots}
          pricing={pricing}
          timeZone="Europe/Belgrade"
          dateLabel={dateLabel}
          labels={labels}
          formatCurrency={formatCurrency}
          initialStep={3}
          initialSelectedSlotId="2"
        />
      </div>
      <div>
        <p className="type-label mb-4">Interactive demo (navigate through all steps)</p>
        <BookingDemo
          advisor={advisor}
          slots={slots}
          pricing={pricing}
          timeZone="Europe/Belgrade"
          dateLabel={dateLabel}
          labels={labels}
          formatCurrency={formatCurrency}
        />
      </div>
    </div>
  ),
};

export const Steps: StoryObj = {
  render: () => (
    <div className="max-w-sm mx-auto space-y-8">
      <div>
        <p className="type-label mb-4">Step 1: Choose an advisor</p>
        <BookingDemo
          advisor={advisor}
          slots={slots}
          pricing={pricing}
          timeZone="Europe/Belgrade"
          dateLabel={dateLabel}
          labels={labels}
          formatCurrency={formatCurrency}
          initialStep={1}
        />
      </div>
      <div>
        <p className="type-label mb-4">Step 2: Choose a time</p>
        <BookingDemo
          advisor={advisor}
          slots={slots}
          pricing={pricing}
          timeZone="Europe/Belgrade"
          dateLabel={dateLabel}
          labels={labels}
          formatCurrency={formatCurrency}
          initialStep={2}
        />
      </div>
      <div>
        <p className="type-label mb-4">Step 3: Review and confirm</p>
        <BookingDemo
          advisor={advisor}
          slots={slots}
          pricing={pricing}
          timeZone="Europe/Belgrade"
          dateLabel={dateLabel}
          labels={labels}
          formatCurrency={formatCurrency}
          initialStep={3}
          initialSelectedSlotId="2"
        />
      </div>
      <div>
        <p className="type-label mb-4">Done</p>
        <BookingDemo
          advisor={advisor}
          slots={slots}
          pricing={pricing}
          timeZone="Europe/Belgrade"
          dateLabel={dateLabel}
          labels={labels}
          formatCurrency={formatCurrency}
          initialStep="done"
        />
      </div>
    </div>
  ),
};
