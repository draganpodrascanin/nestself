import type { Meta, StoryObj } from '@storybook/react-vite';
import { TextLink, LinkButton } from './TextLink';

const meta: Meta = {
  title: 'Actions/TextLink',
};
export default meta;

export const Default: StoryObj = {
  render: () => <TextLink href="/about">Learn more</TextLink>,
};

export const WithArrow: StoryObj = {
  render: () => <TextLink href="/next" trailingArrow>Continue</TextLink>,
};

export const LinkButtonStory: StoryObj = {
  name: 'LinkButton',
  render: () => <LinkButton href="/cta">Get started</LinkButton>,
};
