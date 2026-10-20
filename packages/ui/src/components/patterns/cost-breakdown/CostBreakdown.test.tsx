import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import { CostBreakdown } from './CostBreakdown';
import { expectNoA11yViolations } from '../../../test/axe';

const defaultLabels = {
  price: 'Session price',
  employerCovers: 'Employer covers',
  youPay: 'You pay',
  timeZone: 'Time zone',
  terms: 'Change and cancellation terms',
};

const formatCurrency = (amount: number) =>
  new Intl.NumberFormat('en-IE', { style: 'currency', currency: 'EUR' }).format(amount);

describe('CostBreakdown', () => {
  it('renders all three amounts formatted', () => {
    render(
      <CostBreakdown
        rows={{ price: 100, employerCovers: 80, youPay: 20 }}
        currency="EUR"
        locale="en-IE"
        formatCurrency={formatCurrency}
        labels={defaultLabels}
        timeZone="Europe/Dublin"
        onTermsClick={() => {}}
      />,
    );
    expect(screen.getByText(formatCurrency(100))).toBeInTheDocument();
    expect(screen.getByText(formatCurrency(80))).toBeInTheDocument();
    expect(screen.getByText(formatCurrency(20))).toBeInTheDocument();
  });

  it('renders the time zone text', () => {
    render(
      <CostBreakdown
        rows={{ price: 50, employerCovers: 50, youPay: 0 }}
        currency="EUR"
        locale="en-IE"
        formatCurrency={formatCurrency}
        labels={defaultLabels}
        timeZone="Europe/Belgrade"
        onTermsClick={() => {}}
      />,
    );
    expect(screen.getByText(/Europe\/Belgrade/)).toBeInTheDocument();
  });

  it('renders the terms control', () => {
    const onClick = vi.fn();
    render(
      <CostBreakdown
        rows={{ price: 50, employerCovers: 50, youPay: 0 }}
        currency="EUR"
        locale="en-IE"
        formatCurrency={formatCurrency}
        labels={defaultLabels}
        timeZone="UTC"
        onTermsClick={onClick}
      />,
    );
    expect(screen.getByRole('button', { name: 'Change and cancellation terms' })).toBeInTheDocument();
  });

  it('youPay equals formatCurrency(price - employerCovers) when consistent', () => {
    const price = 100;
    const employerCovers = 60;
    const youPay = 40;
    render(
      <CostBreakdown
        rows={{ price, employerCovers, youPay }}
        currency="EUR"
        locale="en-IE"
        formatCurrency={formatCurrency}
        labels={defaultLabels}
        timeZone="UTC"
        onTermsClick={() => {}}
      />,
    );
    const expected = formatCurrency(price - employerCovers);
    expect(screen.getByText(expected)).toBeInTheDocument();
  });

  it('throws in development when price !== employerCovers + youPay', () => {
    const originalEnv = process.env.NODE_ENV;
    process.env.NODE_ENV = 'development';
    expect(() => {
      render(
        <CostBreakdown
          rows={{ price: 100, employerCovers: 50, youPay: 30 }}
          currency="EUR"
          locale="en-IE"
          formatCurrency={formatCurrency}
          labels={defaultLabels}
          timeZone="UTC"
          onTermsClick={() => {}}
        />,
      );
    }).toThrow(/inconsistent split/);
    process.env.NODE_ENV = originalEnv;
  });

  it('passes axe a11y check', async () => {
    const { container } = render(
      <CostBreakdown
        rows={{ price: 100, employerCovers: 80, youPay: 20 }}
        currency="EUR"
        locale="en-IE"
        formatCurrency={formatCurrency}
        labels={defaultLabels}
        timeZone="UTC"
        onTermsClick={() => {}}
      />,
    );
    await expectNoA11yViolations(container);
  });
});
