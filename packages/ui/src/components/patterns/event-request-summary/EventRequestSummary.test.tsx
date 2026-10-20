import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventRequestSummary } from './EventRequestSummary';
import { expectNoA11yViolations } from '../../../test/axe';

const defaultLabels = {
  field: 'Request field',
  example: 'Example',
  required: 'Required',
  participants: 'Participants',
  location: 'Location',
  dates: 'Dates',
  budget: 'Budget',
  yes: 'Yes',
  no: 'No',
};

const defaultRequest = {
  participants: '15 people',
  location: 'Belgrade, Serbia',
  dates: 'March 2027',
  budget: '€2,000',
  options: ['Cooking class', 'Escape room'],
  workflow: ['Request', 'Approve', 'Book'],
};

describe('EventRequestSummary', () => {
  it('renders the four rows', () => {
    render(
      <EventRequestSummary
        request={defaultRequest}
        labels={defaultLabels}
      />,
    );
    expect(screen.getByText('Participants')).toBeInTheDocument();
    expect(screen.getByText('15 people')).toBeInTheDocument();
    expect(screen.getByText('Location')).toBeInTheDocument();
    expect(screen.getByText('Belgrade, Serbia')).toBeInTheDocument();
    expect(screen.getByText('Dates')).toBeInTheDocument();
    expect(screen.getByText('March 2027')).toBeInTheDocument();
    expect(screen.getByText('Budget')).toBeInTheDocument();
    expect(screen.getByText('€2,000')).toBeInTheDocument();
  });

  it('renders header cells', () => {
    render(
      <EventRequestSummary
        request={defaultRequest}
        labels={defaultLabels}
      />,
    );
    const headers = screen.getAllByRole('columnheader');
    expect(headers).toHaveLength(3);
    expect(headers[0]).toHaveTextContent('Request field');
    expect(headers[1]).toHaveTextContent('Example');
    expect(headers[2]).toHaveTextContent('Required');
  });

  it('passes axe a11y check', async () => {
    const { container } = render(
      <EventRequestSummary
        request={defaultRequest}
        labels={defaultLabels}
      />,
    );
    await expectNoA11yViolations(container);
  });
});
