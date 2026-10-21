import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { createRef } from 'react';
import { FormErrorSummary } from './FormErrorSummary';
import type { FormErrorSummaryHandle } from './FormErrorSummary';
import { expectNoA11yViolations } from '../../../test/axe';

describe('FormErrorSummary', () => {
  const errors = [
    { id: 'name-input', label: 'Name', message: 'Name is required' },
    { id: 'email-input', label: 'Email', message: 'Invalid email' },
  ];

  it('focuses container when focus() is called via ref', () => {
    const ref = createRef<FormErrorSummaryHandle>();
    render(
      <div>
        <FormErrorSummary ref={ref} title="Fix errors" errors={errors} />
        <input id="name-input" aria-label="Name" />
        <input id="email-input" aria-label="Email" />
      </div>,
    );
    ref.current?.focus();
    const alert = screen.getByRole('alert');
    expect(document.activeElement).toBe(alert);
  });

  it('clicking a link focuses the field with that id', async () => {
    render(
      <div>
        <FormErrorSummary title="Errors" errors={errors} />
        <input id="name-input" aria-label="Name" />
        <input id="email-input" aria-label="Email" />
      </div>,
    );
    const user = userEvent.setup();
    const nameLink = screen.getByRole('link', { name: 'Name' });
    await user.click(nameLink);
    const nameInput = document.getElementById('name-input');
    expect(document.activeElement).toBe(nameInput);
  });

  it('renders nothing with empty errors', () => {
    const { container } = render(
      <FormErrorSummary title="Errors" errors={[]} />,
    );
    expect(container.querySelector('[role="alert"]')).toBeNull();
  });

  it('has danger styling (border-danger and bg-danger-surface)', () => {
    render(
      <div>
        <FormErrorSummary title="Fix errors" errors={errors} />
        <input id="name-input" aria-label="Name" />
        <input id="email-input" aria-label="Email" />
      </div>,
    );
    const alert = screen.getByRole('alert');
    expect(alert.className).toContain('border-danger');
    expect(alert.className).toContain('bg-danger-surface');
  });

  it('passes axe a11y check', async () => {
    const { container } = render(
      <div>
        <FormErrorSummary title="Fix errors" errors={errors} />
        <input id="name-input" aria-label="Name" />
        <input id="email-input" aria-label="Email" />
      </div>,
    );
    await expectNoA11yViolations(container);
  });
});
