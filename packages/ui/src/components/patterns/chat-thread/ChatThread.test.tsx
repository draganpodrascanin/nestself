import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { ChatThread } from './ChatThread';
import { expectNoA11yViolations } from '../../../test/axe';
import type { ChatMessage } from './ChatThread';

const messages: ChatMessage[] = [
  { id: '1', author: 'them', text: 'Hello, how can I help?' },
  { id: '2', author: 'me', text: 'I need some advice.' },
];

describe('ChatThread', () => {
  it('renders all messages', () => {
    render(<ChatThread messages={messages} labels={{ title: 'Chat' }} />);
    expect(screen.getByText('Hello, how can I help?')).toBeInTheDocument();
    expect(screen.getByText('I need some advice.')).toBeInTheDocument();
  });

  it('has a log role for live updates', () => {
    render(<ChatThread messages={messages} labels={{ title: 'Chat' }} />);
    expect(screen.getByRole('log')).toBeInTheDocument();
  });

  it('renders title when provided', () => {
    render(<ChatThread messages={messages} labels={{ title: 'Support Chat' }} />);
    expect(screen.getByText('Support Chat')).toBeInTheDocument();
  });

  it('the message list length does not change on failure', () => {
    const msgs: ChatMessage[] = [
      { id: '1', author: 'them', text: 'Hello, how can I help?' },
      { id: '2', author: 'me', text: 'I need some advice.' },
    ];

    const { rerender } = render(<ChatThread messages={msgs} labels={{ title: 'Chat' }} />);
    const log = screen.getByRole('log');
    expect(log.children).toHaveLength(2);

    // Re-render with the same messages array (simulating a failed send that does not append a duplicate)
    rerender(<ChatThread messages={msgs} labels={{ title: 'Chat' }} />);
    expect(log.children).toHaveLength(2);
  });

  it('passes axe a11y check', async () => {
    const { container } = render(<ChatThread messages={messages} labels={{ title: 'Chat' }} />);
    await expectNoA11yViolations(container);
  });
});
