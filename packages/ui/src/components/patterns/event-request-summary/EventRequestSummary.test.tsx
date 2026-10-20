import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { EventRequestSummary, eventRequestRows } from './EventRequestSummary';
import { expectNoA11yViolations } from '../../../test/axe';

const columnLabels = {
  field: 'Request field',
  example: 'Example',
  comparison: 'Required comparison',
};

const rowLabels = {
  participantsLocation: 'Participants / location',
  datesBudget: 'Dates / budget',
  options: 'Options',
  workflow: 'Workflow',
  exampleDatesBudget: 'Chosen range / amount and currency',
  exampleWorkflow: 'Requested → offers ready → selected',
  compareParticipantsLocation: 'Capacity, transport and accessibility',
  compareDatesBudget: 'Included items, availability and conditions',
  compareOptions: 'Price, duration, venue, food and cancellation terms',
  compareWorkflow: 'Owner, status and a real response deadline',
};

const sampleRequest = {
  participants: 25,
  location: 'Novi Sad',
  options: ['bowling', 'karting', 'outdoor day'] as const,
};

describe('eventRequestRows', () => {
  it('maps the sample request to the four handoff rows', () => {
    const rows = eventRequestRows(sampleRequest, rowLabels);

    expect(rows).toHaveLength(4);
    expect(rows[0]).toEqual({
      field: 'Participants / location',
      example: '25 / Novi Sad',
      comparison: 'Capacity, transport and accessibility',
    });
    expect(rows[1]).toEqual({
      field: 'Dates / budget',
      example: 'Chosen range / amount and currency',
      comparison: 'Included items, availability and conditions',
    });
    expect(rows[2]).toEqual({
      field: 'Options',
      example: 'Bowling, karting, outdoor day',
      comparison: 'Price, duration, venue, food and cancellation terms',
    });
    expect(rows[3]).toEqual({
      field: 'Workflow',
      example: 'Requested → offers ready → selected',
      comparison: 'Owner, status and a real response deadline',
    });
  });
});

describe('EventRequestSummary', () => {
  const rows = eventRequestRows(sampleRequest, rowLabels);

  it('renders the three column headers', () => {
    render(<EventRequestSummary rows={rows} labels={columnLabels} />);
    const headers = screen.getAllByRole('columnheader');
    expect(headers).toHaveLength(3);
    expect(headers[0]).toHaveTextContent('Request field');
    expect(headers[1]).toHaveTextContent('Example');
    expect(headers[2]).toHaveTextContent('Required comparison');
  });

  it('renders the four rows', () => {
    render(<EventRequestSummary rows={rows} labels={columnLabels} />);
    expect(screen.getByText('Participants / location')).toBeInTheDocument();
    expect(screen.getByText('25 / Novi Sad')).toBeInTheDocument();
    expect(screen.getByText('Dates / budget')).toBeInTheDocument();
    expect(screen.getByText('Options')).toBeInTheDocument();
    expect(screen.getByText('Bowling, karting, outdoor day')).toBeInTheDocument();
    expect(screen.getByText('Workflow')).toBeInTheDocument();
  });

  it('passes axe a11y check', async () => {
    const { container } = render(
      <EventRequestSummary rows={rows} labels={columnLabels} />,
    );
    await expectNoA11yViolations(container);
  });
});
