import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Tabs, TabList, Tab, TabPanel } from './Tabs';
import { expectNoA11yViolations } from '../../../test/axe';

function TabsFixture() {
  return (
    <Tabs defaultValue="one">
      <TabList label="Test tabs">
        <Tab value="one">Tab One</Tab>
        <Tab value="two">Tab Two</Tab>
        <Tab value="three">Tab Three</Tab>
      </TabList>
      <TabPanel value="one">Panel one content</TabPanel>
      <TabPanel value="two">Panel two content</TabPanel>
      <TabPanel value="three">Panel three content</TabPanel>
    </Tabs>
  );
}

describe('Tabs', () => {
  it('renders tabs and the active panel', () => {
    render(<TabsFixture />);
    expect(screen.getByRole('tab', { name: 'Tab One' })).toBeInTheDocument();
    expect(screen.getByRole('tab', { name: 'Tab Two' })).toBeInTheDocument();
    expect(screen.getByText('Panel one content')).toBeInTheDocument();
  });

  it('arrow keys move selection between tabs', async () => {
    const user = userEvent.setup();
    render(<TabsFixture />);
    const firstTab = screen.getByRole('tab', { name: 'Tab One' });
    firstTab.focus();
    await user.keyboard('{ArrowRight}');
    expect(screen.getByRole('tab', { name: 'Tab Two' })).toHaveFocus();
  });

  it('clicking a tab switches the panel', async () => {
    const user = userEvent.setup();
    render(<TabsFixture />);
    await user.click(screen.getByRole('tab', { name: 'Tab Two' }));
    expect(screen.getByText('Panel two content')).toBeInTheDocument();
  });

  it('passes axe a11y check', async () => {
    const { container } = render(<TabsFixture />);
    await expectNoA11yViolations(container);
  });
});

describe('Tabs motion', () => {
  it('renders one sliding indicator in the tab list, timed by the motion tokens', () => {
    render(<TabsFixture />);
    const tablist = screen.getByRole('tablist');
    const indicators = tablist.querySelectorAll('span');
    expect(indicators).toHaveLength(1);
    expect(indicators[0]!.className).toContain('translate-x-[var(--active-tab-left)]');
    expect(indicators[0]!.className).toContain('duration-[var(--motion-standard)]');
  });
});
