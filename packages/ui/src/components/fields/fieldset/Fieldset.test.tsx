import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Fieldset } from './Fieldset';
import { expectNoA11yViolations } from '../../../test/axe';

describe('Fieldset', () => {
  it('renders with accessible legend', () => {
    render(
      <Fieldset legend="Personal info">
        <input aria-label="Name" />
      </Fieldset>,
    );
    expect(screen.getByRole('group', { name: 'Personal info' })).toBeInTheDocument();
  });

  it('renders description', () => {
    render(
      <Fieldset legend="Info" description="Fill out all fields">
        <input aria-label="Name" />
      </Fieldset>,
    );
    expect(screen.getByText('Fill out all fields')).toBeInTheDocument();
  });

  it('passes axe a11y check', async () => {
    const { container } = render(
      <Fieldset legend="Contact">
        <input aria-label="Phone" />
      </Fieldset>,
    );
    await expectNoA11yViolations(container);
  });
});
