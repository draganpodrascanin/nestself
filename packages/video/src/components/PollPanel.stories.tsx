import type { Meta, StoryObj } from '@storybook/react-vite';
import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { withCallsI18n } from '../stories/decorators';
import { FakeWebinarClient } from '../testing/fake-webinar';
import type { FakeWebinarSampleOptions } from '../testing/fake-webinar-sample';
import { FAKE_WEBINAR_SAMPLE_PEOPLE, createSampleWebinarServer } from '../testing/fake-webinar-sample';
import type { WebinarViewerRole } from '../webinar/types';
import { PollPanel } from './PollPanel';

const meta: Meta<typeof PollPanel> = {
  title: 'Video/PollPanel',
  component: PollPanel,
  decorators: [withCallsI18n],
};
export default meta;

type Story = StoryObj<typeof PollPanel>;

interface DemoProps {
  viewer?: WebinarViewerRole;
  poll?: FakeWebinarSampleOptions['poll'];
  failing?: boolean;
}

/** Polls on a fake webinar: votes are counted in memory without a voter; nothing is sent anywhere. */
function Demo({ viewer: role = 'attendee', poll = 'open', failing = false }: DemoProps) {
  const { t } = useTranslation('calls');
  const [scene] = useState(() => {
    const server = createSampleWebinarServer({ status: 'live', chat: false, poll, delayMs: 400 });
    if (failing) server.simulate.failNext('poll.vote', 'network');
    return { server, client: new FakeWebinarClient({ server, role, name: role === 'moderator' ? FAKE_WEBINAR_SAMPLE_PEOPLE.moderator : null }) };
  });
  return (
    <div className="gap-3 flex w-[min(100%,28rem)] flex-col">
      <PollPanel client={scene.client} />
      <p className="type-metadata text-text-secondary">{t('sample.actionNoop')}</p>
    </div>
  );
}

export const NoPoll: Story = { render: () => <Demo poll="none" /> };
/** One vote; the button is disabled after voting (WEB-35: the vote carries no voter). */
export const OpenPoll: Story = { render: () => <Demo /> };
export const VoteFails: Story = { render: () => <Demo failing /> };
/** Aggregate results as percentages after the close (WBN-11). */
export const Results: Story = { render: () => <Demo poll="closed" /> };
/** The moderator opens and closes prepared polls (WBN-27). */
export const ModeratorPrepared: Story = { render: () => <Demo viewer="moderator" poll="prepared" /> };
export const ModeratorOpen: Story = { render: () => <Demo viewer="moderator" poll="open" /> };
export const Presenter: Story = { render: () => <Demo viewer="presenter" /> };
export const SerbianLatin: Story = { render: () => <Demo poll="closed" />, parameters: { locale: 'sr-Latn' } };
export const Hungarian: Story = { render: () => <Demo />, parameters: { locale: 'hu' } };
