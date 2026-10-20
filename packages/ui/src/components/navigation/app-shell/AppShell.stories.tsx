import type { Meta, StoryObj } from '@storybook/react-vite';
import { AppShell } from './AppShell';

const meta: Meta<typeof AppShell> = {
  title: 'Navigation/AppShell',
  component: AppShell,
};
export default meta;

export const States: StoryObj = {
  render: () => (
    <AppShell
      sidebar={<div className="p-4">Sidebar links</div>}
      topbar={<span>Topbar content</span>}
      bottomBar={<div className="flex items-center justify-around h-full">Bottom bar</div>}
      maxWidth="employee"
    >
      <h1 className="type-screen-title">Dashboard</h1>
      <p className="mt-4">Page content goes here.</p>
    </AppShell>
  ),
};
