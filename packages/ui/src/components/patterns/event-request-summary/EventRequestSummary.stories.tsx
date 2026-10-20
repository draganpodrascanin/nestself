import type { Meta, StoryObj } from '@storybook/react-vite';
import { EventRequestSummary } from './EventRequestSummary';

const meta: Meta<typeof EventRequestSummary> = {
  title: 'Patterns/EventRequestSummary',
  component: EventRequestSummary,
};
export default meta;

export const Default: StoryObj = {
  render: () => (
    <EventRequestSummary
      request={{
        participants: '15 people',
        location: 'Belgrade, Serbia',
        dates: 'March 2027',
        budget: '€2,000',
        options: ['Cooking class', 'Escape room'],
        workflow: ['Request', 'Approve', 'Book'],
      }}
      labels={{
        field: 'Request field',
        example: 'Example',
        required: 'Required',
        participants: 'Participants',
        location: 'Location',
        dates: 'Dates',
        budget: 'Budget',
        yes: 'Yes',
        no: 'No',
      }}
    />
  ),
};

export const States: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-8">
      <EventRequestSummary
        request={{
          participants: '15 people',
          location: 'Belgrade, Serbia',
          dates: 'March 2027',
          budget: '€2,000',
          options: ['Cooking class'],
          workflow: ['Request', 'Approve', 'Book'],
        }}
        labels={{
          field: 'Request field',
          example: 'Example',
          required: 'Required',
          participants: 'Participants',
          location: 'Location',
          dates: 'Dates',
          budget: 'Budget',
          yes: 'Yes',
          no: 'No',
        }}
      />
    </div>
  ),
};
