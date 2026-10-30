import type { StorybookConfig } from '@storybook/react-vite';

const config: StorybookConfig = {
  // The call client's stories live with its components; the motion e2e suite runs against this Storybook.
  stories: ['../src/**/*.stories.@(ts|tsx)', '../../video/src/**/*.stories.@(ts|tsx)'],
  addons: ['@storybook/addon-a11y'],
  framework: { name: '@storybook/react-vite', options: {} },
};

export default config;
