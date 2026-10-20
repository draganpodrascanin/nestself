import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DataList } from './DataList';
import { expectNoA11yViolations } from '../../../test/axe';

describe('DataList', () => {
  it('renders items with term and description', () => {
    render(
      <DataList
        items={[
          { term: 'Consultation', description: '50 EUR' },
          { term: 'Tax', description: '5 EUR' },
        ]}
      />,
    );
    expect(screen.getByText('Consultation')).toBeInTheDocument();
    expect(screen.getByText('50 EUR')).toBeInTheDocument();
  });

  it('renders total row with separator', () => {
    const { container } = render(
      <DataList
        items={[{ term: 'Item', description: '10 EUR' }]}
        total={{ term: 'Total', description: '10 EUR' }}
      />,
    );
    expect(screen.getByText('Total')).toBeInTheDocument();
    // Total row has border-t
    const totalRow = container.querySelector('.border-t');
    expect(totalRow).toBeInTheDocument();
  });

  it('passes axe a11y check', async () => {
    const { container } = render(
      <DataList
        items={[
          { term: 'Session', description: '80 EUR' },
          { term: 'Materials', description: '15 EUR' },
        ]}
        total={{ term: 'Total', description: '95 EUR' }}
      />,
    );
    await expectNoA11yViolations(container);
  });
});
