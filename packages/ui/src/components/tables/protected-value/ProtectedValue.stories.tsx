import type { Meta, StoryObj } from '@storybook/react-vite';
import { ProtectedValue } from './ProtectedValue';

const meta: Meta<typeof ProtectedValue> = {
  title: 'Tables/ProtectedValue',
  component: ProtectedValue,
};
export default meta;

export const States: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-4">
      <ProtectedValue label="Protected" reason="Salary data is restricted to HR personnel." />
      <ProtectedValue
        label="Protected"
        reason="Personal health information is restricted."
        totalAction={<button className="text-primary underline type-metadata">Request access</button>}
      />
    </div>
  ),
};
