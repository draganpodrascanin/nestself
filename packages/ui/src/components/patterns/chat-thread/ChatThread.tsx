import { cn } from '../../../lib/cn';

export interface ChatMessage {
  id: string;
  author: 'me' | 'them';
  text: string;
  state?: 'sending' | 'sent' | 'failed';
}

export interface ChatThreadLabels {
  title?: string;
}

export interface ChatThreadProps {
  messages: ChatMessage[];
  labels: ChatThreadLabels;
  className?: string;
}

export function ChatThread({ messages, labels, className }: ChatThreadProps) {
  return (
    <div className={cn('bg-canvas border border-border-subtle rounded-card overflow-hidden', className)}>
      {labels.title ? (
        <div className="bg-surface px-5 py-5 border-b border-border-subtle">
          <h4 className="text-base font-[var(--font-weight-label)]">{labels.title}</h4>
        </div>
      ) : null}
      <div
        className="flex flex-col gap-4 px-5 py-5 max-h-[22rem] overflow-y-auto"
        role="log"
        aria-live="polite"
      >
        {messages.map((msg) => (
          <div
            key={msg.id}
            className={cn(
              'max-w-[85%] px-4 py-[0.9rem] rounded-card',
              msg.author === 'me'
                ? 'self-end bg-primary text-on-primary'
                : 'bg-tint',
            )}
          >
            {msg.text}
          </div>
        ))}
      </div>
    </div>
  );
}
