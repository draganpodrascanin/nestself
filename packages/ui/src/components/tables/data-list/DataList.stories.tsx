import type { Meta, StoryObj } from '@storybook/react-vite';
import { DataList } from './DataList';

const meta: Meta<typeof DataList> = {
  title: 'Tables/DataList',
  component: DataList,
};
export default meta;

export const States: StoryObj = {
  render: () => (
    <div className="max-w-md">
      <DataList
        items={[
          { term: 'Consultation fee', description: '50 EUR' },
          { term: 'Materials', description: '15 EUR' },
          { term: 'Tax', description: '6.50 EUR' },
        ]}
        total={{ term: 'Total', description: '71.50 EUR' }}
      />
    </div>
  ),
};
