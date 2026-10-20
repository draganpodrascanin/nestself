import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChatThread } from './ChatThread';

const meta: Meta<typeof ChatThread> = {
  title: 'Patterns/ChatThread',
  component: ChatThread,
};
export default meta;

export const Default: StoryObj = {
  render: () => (
    <div className="max-w-md">
      <ChatThread
        messages={[
          { id: '1', author: 'them', text: 'Hello, how can I help you today?' },
          { id: '2', author: 'me', text: 'I would like to discuss something.' },
          { id: '3', author: 'them', text: 'Of course, I am here to listen.' },
        ]}
        labels={{ title: 'Messages' }}
      />
    </div>
  ),
};

export const States: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-8 max-w-md">
      <div>
        <p className="type-label mb-2">With messages</p>
        <ChatThread
          messages={[
            { id: '1', author: 'them', text: 'Welcome!' },
            { id: '2', author: 'me', text: 'Thank you.' },
          ]}
          labels={{ title: 'Chat' }}
        />
      </div>
      <div>
        <p className="type-label mb-2">Empty</p>
        <ChatThread messages={[]} labels={{ title: 'Chat' }} />
      </div>
    </div>
  ),
};
