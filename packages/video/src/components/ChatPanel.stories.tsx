import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { withCallsI18n } from '../stories/decorators';
import { FakeWebinarClient } from '../testing/fake-webinar';
import { FAKE_WEBINAR_SAMPLE_PEOPLE, createSampleWebinarServer } from '../testing/fake-webinar-sample';
import type { WebinarViewerRole } from '../webinar/types';
import { ChatPanel } from './ChatPanel';

const meta: Meta<typeof ChatPanel> = {
  title: 'Video/ChatPanel',
  component: ChatPanel,
  decorators: [withCallsI18n],
};
export default meta;

type Story = StoryObj<typeof ChatPanel>;

interface DemoProps {
  viewer?: WebinarViewerRole;
  chat?: boolean;
  pending?: boolean;
  failing?: boolean;
  error?: boolean;
}

/** The webinar chat on a fake webinar; the people are placeholders and nothing is sent anywhere. */
function Demo({ viewer: role = 'attendee', chat = true, pending = false, failing = false, error = false }: DemoProps) {
  const { t } = useTranslation('calls');
  const [client] = useState(() => {
    const server = createSampleWebinarServer({ status: 'live', chat, pending, delayMs: 400 });
    if (failing) server.simulate.failNext('message.send', 'network');
    const [ana] = FAKE_WEBINAR_SAMPLE_PEOPLE.attendees;
    const name = role === 'attendee' ? ana.name : role === 'moderator' ? FAKE_WEBINAR_SAMPLE_PEOPLE.moderator : FAKE_WEBINAR_SAMPLE_PEOPLE.presenter;
    return new FakeWebinarClient({ server, role, name, ...(role === 'attendee' ? { participantId: ana.participantId } : {}) });
  });
  return (
    <div className="gap-3 flex w-[min(100%,28rem)] flex-col">
      <ChatPanel client={client} error={error ? t('errors.network') : null} className="h-[36rem]" />
      <p className="type-metadata text-text-secondary">{t('sample.actionNoop')}</p>
    </div>
  );
}

/** Attendees write to the hosts, anonymous by default; they see published messages and answers only. */
export const Attendee: Story = { render: () => <Demo /> };
export const AttendeeEmpty: Story = { render: () => <Demo chat={false} /> };
/** Sending fails: the draft stays and the error is shown. */
export const AttendeeSendFails: Story = { render: () => <Demo failing /> };
/** Presenters see published and answered messages only and post to everyone (WBN-20). */
export const Presenter: Story = { render: () => <Demo viewer="presenter" pending /> };
/** The moderator sees every message, with the registration name, and reviews pending ones in place (WBN-23, WBN-24). */
export const Moderator: Story = { render: () => <Demo viewer="moderator" pending /> };
export const LoadError: Story = { render: () => <Demo chat={false} error /> };
export const SerbianLatin: Story = { render: () => <Demo />, parameters: { locale: 'sr-Latn' } };
export const SerbianCyrillic: Story = { render: () => <Demo viewer="moderator" pending />, parameters: { locale: 'sr-Cyrl' } };
export const Hungarian: Story = { render: () => <Demo />, parameters: { locale: 'hu' } };
