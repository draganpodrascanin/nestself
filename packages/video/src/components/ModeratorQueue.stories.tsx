import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { withCallsI18n } from '../stories/decorators';
import { FakeWebinarClient } from '../testing/fake-webinar';
import { FAKE_WEBINAR_SAMPLE_PEOPLE, createSampleWebinarServer } from '../testing/fake-webinar-sample';
import { ModeratorQueue } from './ModeratorQueue';

const meta: Meta<typeof ModeratorQueue> = {
  title: 'Video/ModeratorQueue',
  component: ModeratorQueue,
  decorators: [withCallsI18n],
};
export default meta;

type Story = StoryObj<typeof ModeratorQueue>;

interface DemoProps {
  viewer?: 'moderator' | 'presenter';
  busy?: boolean;
  failing?: boolean;
}

/** The hosts' queue on a fake webinar; the people are placeholders and nothing is sent anywhere. */
function Demo({ viewer: role = 'moderator', busy = true, failing = false }: DemoProps) {
  const { t } = useTranslation('calls');
  const [client] = useState(() => {
    const server = createSampleWebinarServer({ status: 'live', chat: false, pending: busy, hands: busy, attendance: busy ? 128 : 0, recording: true, delayMs: 400 });
    if (failing) server.simulate.failNext('floor.give', 'floor_not_available');
    return new FakeWebinarClient({ server, role, name: role === 'moderator' ? FAKE_WEBINAR_SAMPLE_PEOPLE.moderator : FAKE_WEBINAR_SAMPLE_PEOPLE.presenter });
  });
  return (
    <div className="gap-3 flex w-[min(100%,32rem)] flex-col">
      <ModeratorQueue client={client} />
      <p className="type-metadata text-text-secondary">{t('sample.actionNoop')}</p>
    </div>
  );
}

/** Pending messages with the registration name, raised hands with "give the floor", the count and the recording stop. */
export const Moderator: Story = { render: () => <Demo /> };
export const Empty: Story = { render: () => <Demo busy={false} /> };
/** Giving the floor fails: the error is shown. */
export const GiveFloorFails: Story = { render: () => <Demo failing /> };
/** A presenter sees "a participant asked to speak", no names and no pending messages (WBN-10, WBN-20). */
export const Presenter: Story = { render: () => <Demo viewer="presenter" /> };
export const SerbianLatin: Story = { render: () => <Demo />, parameters: { locale: 'sr-Latn' } };
export const Hungarian: Story = { render: () => <Demo />, parameters: { locale: 'hu' } };
