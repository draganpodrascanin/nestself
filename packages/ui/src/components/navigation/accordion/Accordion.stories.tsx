import type { Meta, StoryObj } from '@storybook/react-vite';
import { Accordion, AccordionItem } from './Accordion';

const meta: Meta = {
  title: 'Navigation/Accordion',
};
export default meta;

export const FAQ: StoryObj = {
  render: () => (
    <Accordion defaultValue={['q1']}>
      <AccordionItem value="q1" title="What services does NestSelf provide?">
        NestSelf offers psychological, legal and financial support for employees
        through their employer&apos;s wellbeing programme.
      </AccordionItem>
      <AccordionItem value="q2" title="How do I access the platform?">
        Your employer provides access credentials. Log in at the workspace URL
        shared during onboarding.
      </AccordionItem>
      <AccordionItem value="q3" title="Is my data kept confidential?">
        Sessions are confidential. The privacy model page explains exactly what
        your employer can and cannot see.
      </AccordionItem>
      <AccordionItem value="q4" title="Can my family members use the service?">
        Family coverage is available where included in your employer&apos;s plan.
        Check with your HR team for details.
      </AccordionItem>
    </Accordion>
  ),
};
