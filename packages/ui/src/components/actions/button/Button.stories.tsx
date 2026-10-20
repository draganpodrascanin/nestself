import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from './Button';

const meta: Meta<typeof Button> = {
  title: 'Actions/Button',
  component: Button,
};
export default meta;

export const Variants: StoryObj = {
  render: () => (
    <div className="flex flex-wrap gap-3">
      <Button variant="primary">Primary</Button>
      <Button variant="secondary">Secondary</Button>
      <Button variant="ghost">Ghost</Button>
      <Button variant="danger">Danger</Button>
      <Button variant="on-brand">On Brand</Button>
    </div>
  ),
};

export const Sizes: StoryObj = {
  render: () => (
    <div className="flex flex-wrap gap-3 items-center">
      <Button size="md">Medium</Button>
      <Button size="sm">Small</Button>
    </div>
  ),
};

export const States: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-3 items-center">
        <Button>Default</Button>
        <Button className="bg-primary-hover">Hover (demo)</Button>
        <Button data-pressed="">Pressed (demo)</Button>
        <Button className="outline-[3px] outline-focus outline-offset-2">Focus visible (demo)</Button>
        <Button disabled>Disabled</Button>
        <Button loading>Loading</Button>
      </div>
    </div>
  ),
};
