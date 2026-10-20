import type { Meta, StoryObj } from '@storybook/react-vite';
import { EventRequestSummary, eventRequestRows } from './EventRequestSummary';

const meta: Meta<typeof EventRequestSummary> = {
  title: 'Patterns/EventRequestSummary',
  component: EventRequestSummary,
};
export default meta;

const sampleRequest = {
  participants: 25,
  location: 'Novi Sad',
  options: ['bowling', 'karting', 'outdoor day'] as const,
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

const columnLabels = {
  field: 'Request field',
  example: 'Example',
  comparison: 'Required comparison',
};

export const Default: StoryObj = {
  render: () => (
    <EventRequestSummary
      rows={eventRequestRows(sampleRequest, rowLabels)}
      labels={columnLabels}
    />
  ),
};

export const States: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-8">
      <EventRequestSummary
        rows={eventRequestRows(
          { participants: 10, location: 'Belgrade', options: ['cooking class'] },
          rowLabels,
        )}
        labels={columnLabels}
      />
    </div>
  ),
};
