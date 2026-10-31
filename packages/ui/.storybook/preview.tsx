import './storybook.css';
import { applyTheme } from '@nestself/tokens/theme';
import { AnnouncerProvider } from '../src/components/foundation/live-region/LiveRegion';
import type { Decorator, Preview } from '@storybook/react-vite';

const withTheme: Decorator = (Story, context) => {
  const palette = context.globals['palette'] ?? 'forest';
  const mode = context.globals['mode'] ?? 'light';
  const font = context.globals['font'] ?? 'onest';

  applyTheme({ palette, mode, font });

  return (
    <AnnouncerProvider>
      <div data-app-root className="bg-canvas text-text p-6">
        <Story />
      </div>
    </AnnouncerProvider>
  );
};

const preview: Preview = {
  globalTypes: {
    palette: {
      description: 'Theme palette',
      toolbar: {
        title: 'Palette',
        items: ['forest', 'ink', 'plum', 'azure'],
        dynamicTitle: true,
      },
    },
    mode: {
      description: 'Colour mode',
      toolbar: {
        title: 'Mode',
        items: ['light', 'dark'],
        dynamicTitle: true,
      },
    },
    font: {
      description: 'Font family',
      toolbar: {
        title: 'Font',
        items: ['onest', 'commissioner', 'nunito', 'fira', 'lato'],
        dynamicTitle: true,
      },
    },
  },
  initialGlobals: {
    palette: 'forest',
    mode: 'light',
    font: 'onest',
  },
  decorators: [withTheme],
  parameters: {
    a11y: { test: 'error' },
  },
};

export default preview;
