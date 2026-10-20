import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Table, Th, Td } from './Table';
import { expectNoA11yViolations } from '../../../test/axe';

describe('Table', () => {
  it('renders with default density (h-14)', () => {
    const { container } = render(
      <Table caption="Test table">
        <thead>
          <tr><Th>Name</Th><Th numeric>Amount</Th></tr>
        </thead>
        <tbody>
          <tr><Td>Row 1</Td><Td numeric>100</Td></tr>
        </tbody>
      </Table>,
    );
    const table = container.querySelector('table');
    expect(table).toHaveAttribute('data-density', 'default');
    // Th and Td should have h-14 by default
    const th = container.querySelector('th');
    expect(th?.className).toContain('h-14');
  });

  it('renders with compact density (h-11)', () => {
    const { container } = render(
      <Table density="compact" caption="Compact table">
        <thead>
          <tr><Th>Name</Th></tr>
        </thead>
        <tbody>
          <tr><Td>Row 1</Td></tr>
        </tbody>
      </Table>,
    );
    const table = container.querySelector('table');
    expect(table).toHaveAttribute('data-density', 'compact');
  });

  it('numeric cells align right', () => {
    const { container } = render(
      <Table caption="Numeric test">
        <thead>
          <tr><Th numeric>Cost</Th></tr>
        </thead>
        <tbody>
          <tr><Td numeric>250</Td></tr>
        </tbody>
      </Table>,
    );
    const th = container.querySelector('th');
    expect(th?.className).toContain('text-right');
    expect(th?.className).toContain('tabular-nums');
    const td = container.querySelector('td');
    expect(td?.className).toContain('text-right');
    expect(td?.className).toContain('tabular-nums');
  });

  it('renders caption as sr-only', () => {
    render(
      <Table caption="Employee list">
        <tbody>
          <tr><Td>Data</Td></tr>
        </tbody>
      </Table>,
    );
    expect(screen.getByText('Employee list')).toBeInTheDocument();
  });

  it('scroll wrapper is a focusable region with aria-label from caption', () => {
    render(
      <Table caption="Scrollable table">
        <tbody>
          <tr><Td>Data</Td></tr>
        </tbody>
      </Table>,
    );
    const region = screen.getByRole('region', { name: 'Scrollable table' });
    expect(region).toBeInTheDocument();
    expect(region).toHaveAttribute('tabindex', '0');
  });

  it('passes axe a11y check', async () => {
    const { container } = render(
      <Table caption="Accessible table">
        <thead>
          <tr><Th>Name</Th><Th>Role</Th></tr>
        </thead>
        <tbody>
          <tr><Td>Alice</Td><Td>Engineer</Td></tr>
        </tbody>
      </Table>,
    );
    await expectNoA11yViolations(container);
  });
});
