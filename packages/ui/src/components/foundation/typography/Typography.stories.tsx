import type { Meta, StoryObj } from '@storybook/react-vite';
import { Heading, Text, Eyebrow } from './Typography';

const meta: Meta = {
  title: 'Foundation/Typography',
};
export default meta;

export const Headings: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-4">
      <Heading level={1} typeRole="display">Display heading</Heading>
      <Heading level={1} typeRole="marketingHero">Marketing Hero</Heading>
      <Heading level={1} typeRole="editorial">Editorial heading</Heading>
      <Heading level={1} typeRole="screenTitle">Screen title</Heading>
      <Heading level={2} typeRole="sectionTitle">Section title</Heading>
    </div>
  ),
};

export const TextVariants: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Text typeRole="bodyLarge">Body large text</Text>
      <Text typeRole="body">Body text</Text>
      <Text typeRole="label">Label text</Text>
      <Text typeRole="metadata">Metadata text</Text>
      <Text typeRole="table">Table text (tabular nums)</Text>
    </div>
  ),
};

export const Tones: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Text tone="default">Default tone</Text>
      <Text tone="secondary">Secondary tone</Text>
      <Text tone="danger">Danger tone</Text>
    </div>
  ),
};

export const EyebrowVariants: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-3">
      <Eyebrow>Standard eyebrow</Eyebrow>
      <Eyebrow numbered>01 Numbered eyebrow</Eyebrow>
    </div>
  ),
};
