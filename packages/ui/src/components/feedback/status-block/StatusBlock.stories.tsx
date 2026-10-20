import type { Meta, StoryObj } from '@storybook/react-vite';
import { StatusBlock } from './StatusBlock';

const meta: Meta<typeof StatusBlock> = {
  title: 'Feedback/StatusBlock',
  component: StatusBlock,
};
export default meta;

export const States: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-8 max-w-xl mx-auto">
      <StatusBlock state="empty" title="No appointments" body="You have no upcoming appointments." />
      <StatusBlock state="results" title="No results" body="Try adjusting your search." />
      <StatusBlock state="loading" title="Loading" body="Please wait while we load your data." />
      <StatusBlock
        state="offline"
        title="You are offline"
        body="Check your internet connection and try again."
        action={{ label: 'Retry', onClick: () => {} }}
      />
      <StatusBlock
        state="stale"
        title="Data may be outdated"
        body="We could not refresh your data."
        action={{ label: 'Refresh', onClick: () => {} }}
      />
      <StatusBlock state="permission" title="Permission required" body="Contact your administrator." />
      <StatusBlock state="expired" title="Session expired" body="Please sign in again." />
      <StatusBlock
        state="protected"
        title="Protected"
        body="This content is restricted."
        action={{ label: 'Request access', onClick: () => {} }}
      />
    </div>
  ),
};
