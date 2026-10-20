import type { Meta, StoryObj } from '@storybook/react-vite';
import { ChatComposer } from './ChatComposer';

const labels = {
  message: 'Type a message',
  send: 'Send',
  retry: 'Retry',
  failedNotice: 'Message failed to send.',
  sentNotice: 'Message sent.',
};

const meta: Meta<typeof ChatComposer> = {
  title: 'Patterns/ChatComposer',
  component: ChatComposer,
};
export default meta;

export const Default: StoryObj = {
  render: () => (
    <div className="max-w-md">
      <ChatComposer
        value=""
        onChange={() => {}}
        onSend={() => {}}
        draftState="idle"
        labels={labels}
      />
    </div>
  ),
};

export const States: StoryObj = {
  render: () => (
    <div className="flex flex-col gap-8 max-w-md">
      <div>
        <p className="type-label mb-2">Idle (empty)</p>
        <ChatComposer
          value=""
          onChange={() => {}}
          onSend={() => {}}
          draftState="idle"
          labels={labels}
        />
      </div>
      <div>
        <p className="type-label mb-2">Idle (with draft)</p>
        <ChatComposer
          value="I have a question about..."
          onChange={() => {}}
          onSend={() => {}}
          draftState="idle"
          labels={labels}
        />
      </div>
      <div>
        <p className="type-label mb-2">Sending</p>
        <ChatComposer
          value="Sending this message..."
          onChange={() => {}}
          onSend={() => {}}
          draftState="sending"
          labels={labels}
        />
      </div>
      <div>
        <p className="type-label mb-2">Failed</p>
        <ChatComposer
          value="This message failed"
          onChange={() => {}}
          onSend={() => {}}
          draftState="failed"
          labels={labels}
        />
      </div>
    </div>
  ),
};
