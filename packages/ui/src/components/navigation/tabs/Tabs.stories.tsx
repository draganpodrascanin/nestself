import type { Meta, StoryObj } from '@storybook/react-vite';
import { Tabs, TabList, Tab, TabPanel } from './Tabs';

const meta: Meta = {
  title: 'Navigation/Tabs',
};
export default meta;

export const States: StoryObj = {
  render: () => (
    <Tabs defaultValue="overview">
      <TabList label="Dashboard tabs">
        <Tab value="overview">Overview</Tab>
        <Tab value="activity">Activity</Tab>
        <Tab value="settings">Settings</Tab>
      </TabList>
      <TabPanel value="overview">Overview content</TabPanel>
      <TabPanel value="activity">Activity content</TabPanel>
      <TabPanel value="settings">Settings content</TabPanel>
    </Tabs>
  ),
};
