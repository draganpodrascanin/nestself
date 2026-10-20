import type { Meta, StoryObj } from '@storybook/react-vite';
import { PrivacyAtPointOfUse } from './PrivacyAtPointOfUse';

const meta: Meta<typeof PrivacyAtPointOfUse> = {
  title: 'Patterns/PrivacyAtPointOfUse',
  component: PrivacyAtPointOfUse,
};
export default meta;

export const Default: StoryObj = {
  render: () => (
    <div className="max-w-md">
      <PrivacyAtPointOfUse
        question="Who can see my data?"
        explanation="Only your assigned advisor can view your session notes. Your employer sees aggregated usage, never individual details."
      />
    </div>
  ),
};

export const States: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-4 max-w-md">
      <PrivacyAtPointOfUse
        question="Who can see my data?"
        explanation="Only your assigned advisor."
      />
      <PrivacyAtPointOfUse
        question="Is my conversation private?"
        explanation="Messages are encrypted end-to-end."
        learnMoreLabel="Read our privacy policy"
        onLearnMore={() => {}}
      />
    </div>
  ),
};
