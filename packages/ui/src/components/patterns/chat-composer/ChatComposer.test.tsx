import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ChatComposer } from './ChatComposer';
import { expectNoA11yViolations } from '../../../test/axe';

const defaultLabels = {
  message: 'Type a message',
  send: 'Send',
  retry: 'Retry',
  failedNotice: 'Message failed to send.',
  sentNotice: 'Message sent.',
};

describe('ChatComposer', () => {
  it('failing send keeps the value and shows the retry button with focus', () => {
    render(
      <ChatComposer
        value="My message"
        onChange={() => {}}
        onSend={() => {}}
        draftState="failed"
        labels={defaultLabels}
      />,
    );

    // Value is still in the input
    const input = screen.getByPlaceholderText('Type a message');
    expect(input).toHaveValue('My message');

    // Input is read-only
    expect(input).toHaveAttribute('aria-readonly', 'true');

    // Retry button is shown
    const retryBtn = screen.getByRole('button', { name: 'Retry' });
    expect(retryBtn).toBeInTheDocument();

    // Retry button should receive focus
    expect(retryBtn).toHaveFocus();
  });

  it('retry success clears the input (parent-driven)', () => {
    const { rerender } = render(
      <ChatComposer
        value="My message"
        onChange={() => {}}
        onSend={() => {}}
        draftState="failed"
        labels={defaultLabels}
      />,
    );

    // After retry success, parent clears value and sets idle
    rerender(
      <ChatComposer
        value=""
        onChange={() => {}}
        onSend={() => {}}
        draftState="idle"
        labels={defaultLabels}
      />,
    );

    const input = screen.getByPlaceholderText('Type a message');
    expect(input).toHaveValue('');
    expect(screen.queryByRole('button', { name: 'Retry' })).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Send' })).toBeInTheDocument();
    // Focus should return to the input after retry success
    expect(input).toHaveFocus();
  });

  it('shows failed notice on failure', () => {
    render(
      <ChatComposer
        value="Draft"
        onChange={() => {}}
        onSend={() => {}}
        draftState="failed"
        labels={defaultLabels}
      />,
    );
    expect(screen.getByRole('alert')).toHaveTextContent('Message failed to send.');
  });

  it('send button is disabled when input is empty', () => {
    render(
      <ChatComposer
        value=""
        onChange={() => {}}
        onSend={() => {}}
        draftState="idle"
        labels={defaultLabels}
      />,
    );
    expect(screen.getByRole('button', { name: 'Send' })).toBeDisabled();
  });

  it('send button is disabled while sending', () => {
    render(
      <ChatComposer
        value="Message"
        onChange={() => {}}
        onSend={() => {}}
        draftState="sending"
        labels={defaultLabels}
      />,
    );
    const btn = screen.getByRole('button', { name: 'Send' });
    expect(btn).toBeDisabled();
    expect(btn).toHaveAttribute('aria-busy', 'true');
  });

  it('calls onSend when button clicked with value', async () => {
    const user = userEvent.setup();
    const onSend = vi.fn();
    render(
      <ChatComposer
        value="Hello"
        onChange={() => {}}
        onSend={onSend}
        draftState="idle"
        labels={defaultLabels}
      />,
    );
    await user.click(screen.getByRole('button', { name: 'Send' }));
    expect(onSend).toHaveBeenCalledOnce();
  });

  it('passes axe a11y check', async () => {
    const { container } = render(
      <ChatComposer
        value=""
        onChange={() => {}}
        onSend={() => {}}
        draftState="idle"
        labels={defaultLabels}
      />,
    );
    await expectNoA11yViolations(container);
  });
});
