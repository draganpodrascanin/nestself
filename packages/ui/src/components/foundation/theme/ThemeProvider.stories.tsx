import type { Meta, StoryObj } from '@storybook/react-vite';
import { ThemeProvider, ThemeStudio, useTheme } from './ThemeProvider';

function ThemeDisplay() {
  const { theme, toggleMode } = useTheme();
  return (
    <div className="flex flex-col gap-4">
      <p className="type-body">Current: {theme.palette} / {theme.mode} / {theme.font}</p>
      <button onClick={toggleMode} className="rounded-control border border-border-control px-4 py-2">
        Toggle mode
      </button>
    </div>
  );
}

const meta: Meta = {
  title: 'Foundation/Theme',
  decorators: [
    (Story) => (
      <ThemeProvider>
        <Story />
      </ThemeProvider>
    ),
  ],
};
export default meta;

export const Default: StoryObj = {
  render: () => <ThemeDisplay />,
};

export const Studio: StoryObj = {
  render: () => <ThemeStudio enabled />,
};

export const StudioDisabled: StoryObj = {
  render: () => <ThemeStudio enabled={false} />,
};
