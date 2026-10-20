import type { Meta, StoryObj } from '@storybook/react-vite';
import { Table, Th, Td } from './Table';

const meta: Meta<typeof Table> = {
  title: 'Tables/Table',
  component: Table,
};
export default meta;

export const States: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-8">
      <Table caption="Default density" density="default">
        <thead>
          <tr><Th>Employee</Th><Th>Role</Th><Th numeric>Sessions</Th></tr>
        </thead>
        <tbody>
          <tr><Td>Ana M.</Td><Td>Counselor</Td><Td numeric>24</Td></tr>
          <tr><Td>Marko P.</Td><Td>Therapist</Td><Td numeric>18</Td></tr>
        </tbody>
      </Table>
      <Table caption="Compact density" density="compact">
        <thead>
          <tr><Th>Item</Th><Th numeric>Cost</Th></tr>
        </thead>
        <tbody>
          <tr><Td>Consultation</Td><Td numeric>50 EUR</Td></tr>
          <tr><Td>Follow-up</Td><Td numeric>30 EUR</Td></tr>
        </tbody>
      </Table>
    </div>
  ),
};

export const Density: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-8">
      <h3>Default</h3>
      <Table caption="Default" density="default">
        <tbody><tr><Td>Default density row</Td></tr></tbody>
      </Table>
      <h3>Compact</h3>
      <Table caption="Compact" density="compact">
        <tbody><tr><Td>Compact density row</Td></tr></tbody>
      </Table>
    </div>
  ),
};
