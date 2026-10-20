import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ThemeProvider, useTheme, ThemeStudio } from './ThemeProvider';

function ThemeReader() {
  const { theme } = useTheme();
  return <div data-testid="reader">{JSON.stringify(theme)}</div>;
}

describe('ThemeProvider', () => {
  it('applies theme attributes to document element', () => {
    render(
      <ThemeProvider>
        <ThemeReader />
      </ThemeProvider>,
    );
    expect(document.documentElement.getAttribute('data-palette')).toBe('forest');
    expect(document.documentElement.getAttribute('data-mode')).toBe('light');
    expect(document.documentElement.getAttribute('data-font')).toBe('onest');
  });

  it('applies custom initial theme', () => {
    render(
      <ThemeProvider initial={{ palette: 'ink', mode: 'dark' }}>
        <ThemeReader />
      </ThemeProvider>,
    );
    expect(document.documentElement.getAttribute('data-palette')).toBe('ink');
    expect(document.documentElement.getAttribute('data-mode')).toBe('dark');
  });
});

describe('ThemeStudio', () => {
  it('renders nothing when enabled is false', () => {
    const { container } = render(
      <ThemeProvider>
        <ThemeStudio enabled={false} />
      </ThemeProvider>,
    );
    expect(container.querySelector('details')).toBeNull();
  });

  it('renders nothing when navigator.webdriver is true', () => {
    Object.defineProperty(navigator, 'webdriver', { value: true, configurable: true });
    const { container } = render(
      <ThemeProvider>
        <ThemeStudio enabled />
      </ThemeProvider>,
    );
    expect(container.querySelector('details')).toBeNull();
    Object.defineProperty(navigator, 'webdriver', { value: false, configurable: true });
  });

  it('selecting a palette updates data-palette', async () => {
    const user = userEvent.setup();
    render(
      <ThemeProvider>
        <ThemeStudio enabled />
      </ThemeProvider>,
    );
    const paletteSelect = screen.getByLabelText('Palette');
    await user.selectOptions(paletteSelect, 'plum');
    expect(document.documentElement.getAttribute('data-palette')).toBe('plum');
  });
});
