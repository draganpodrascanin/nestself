import type { Meta, StoryObj } from '@storybook/react-vite';
import { CostBreakdown } from './CostBreakdown';

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(amount);

const meta: Meta<typeof CostBreakdown> = {
  title: 'Patterns/CostBreakdown',
  component: CostBreakdown,
};
export default meta;

export const Default: StoryObj = {
  render: () => (
    <div className="max-w-sm">
      <CostBreakdown
        rows={{ price: 100, employerCovers: 80, youPay: 20 }}
        currency="EUR"
        locale="en-IE"
        formatCurrency={formatCurrency}
        labels={{
          price: 'Session price',
          employerCovers: 'Employer covers',
          youPay: 'You pay',
          timeZone: 'Time zone',
          terms: 'Change and cancellation terms',
        }}
        timeZone="Europe/Dublin"
        onTermsClick={() => {}}
      />
    </div>
  ),
};

export const States: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-8 max-w-sm">
      <CostBreakdown
        rows={{ price: 100, employerCovers: 100, youPay: 0 }}
        currency="EUR"
        locale="en-IE"
        formatCurrency={formatCurrency}
        labels={{
          price: 'Session price',
          employerCovers: 'Employer covers',
          youPay: 'You pay',
          timeZone: 'Time zone',
          terms: 'Change and cancellation terms',
        }}
        timeZone="Europe/Belgrade"
        onTermsClick={() => {}}
      />
      <CostBreakdown
        rows={{ price: 50, employerCovers: 30, youPay: 20 }}
        currency="EUR"
        locale="en-IE"
        formatCurrency={formatCurrency}
        labels={{
          price: 'Session price',
          employerCovers: 'Employer covers',
          youPay: 'You pay',
          timeZone: 'Time zone',
          terms: 'Change and cancellation terms',
        }}
        timeZone="UTC"
        onTermsClick={() => {}}
      />
    </div>
  ),
};
