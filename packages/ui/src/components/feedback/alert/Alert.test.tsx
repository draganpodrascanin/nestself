import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { Alert } from './Alert';
import { expectNoA11yViolations } from '../../../test/axe';

describe('Alert', () => {
  it('renders role="status" for info tone', () => {
    render(<Alert tone="info">Info message</Alert>);
    expect(screen.getByRole('status')).toHaveTextContent('Info message');
  });

  it('renders role="status" for success tone', () => {
    render(<Alert tone="success">Success message</Alert>);
    expect(screen.getByRole('status')).toHaveTextContent('Success message');
  });

  it('renders role="alert" for warning tone', () => {
    render(<Alert tone="warning">Warning message</Alert>);
    expect(screen.getByRole('alert')).toHaveTextContent('Warning message');
  });

  it('renders role="alert" for danger tone', () => {
    render(<Alert tone="danger">Danger message</Alert>);
    expect(screen.getByRole('alert')).toHaveTextContent('Danger message');
  });

  it('renders with a title', () => {
    render(<Alert title="Heads up">Body text</Alert>);
    expect(screen.getByText('Heads up')).toBeInTheDocument();
    expect(screen.getByText('Body text')).toBeInTheDocument();
  });

  it('passes axe a11y check', async () => {
    const { container } = render(<Alert tone="danger">Error occurred</Alert>);
    await expectNoA11yViolations(container);
  });
});
