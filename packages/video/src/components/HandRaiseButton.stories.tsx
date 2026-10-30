import type { Meta, StoryObj } from '@storybook/react-vite';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { withCallsI18n } from '../stories/decorators';
import { FakeWebinarClient } from '../testing/fake-webinar';
import { FAKE_WEBINAR_SAMPLE_PEOPLE, createSampleWebinarServer } from '../testing/fake-webinar-sample';
import { HandRaiseButton } from './HandRaiseButton';
import { ModeratorQueue } from './ModeratorQueue';

const meta: Meta<typeof HandRaiseButton> = {
  title: 'Video/HandRaiseButton',
  component: HandRaiseButton,
  decorators: [withCallsI18n],
};
export default meta;

type Story = StoryObj<typeof HandRaiseButton>;

interface DemoProps {
  raised?: boolean;
  failing?: boolean;
  withQueue?: boolean;
}

/** An attendee's hand on a fake webinar: nothing is sent anywhere. */
function Demo({ raised = false, failing = false, withQueue = false }: DemoProps) {
  const { t } = useTranslation('calls');
  const [scene] = useState(() => {
    const server = createSampleWebinarServer({ status: 'live', chat: false, delayMs: 300 });
    if (failing) server.simulate.failNext('hand.raise', 'webinar_not_open');
    const [ana] = FAKE_WEBINAR_SAMPLE_PEOPLE.attendees;
    return {
      attendee: new FakeWebinarClient({ server, role: 'attendee', participantId: ana.participantId, name: ana.name }),
      moderator: new FakeWebinarClient({ server, role: 'moderator', name: FAKE_WEBINAR_SAMPLE_PEOPLE.moderator }),
    };
  });
  useEffect(() => {
    if (raised) void scene.attendee.raiseHand();
  }, [scene, raised]);
  return (
    <div className="gap-6 flex flex-wrap items-start">
      <div className="gap-3 flex flex-col items-start">
        <HandRaiseButton client={scene.attendee} />
        <p className="type-metadata text-text-secondary">{t('sample.actionNoop')}</p>
      </div>
      {withQueue ? <ModeratorQueue client={scene.moderator} className="w-[min(100%,28rem)]" /> : null}
    </div>
  );
}

export const Lowered: Story = { render: () => <Demo /> };
export const Raised: Story = { render: () => <Demo raised /> };
/** The raise fails: the error stays on screen (error visibility rule). */
export const RaiseFails: Story = { render: () => <Demo failing /> };
/** The raised hand reaches the moderation room only: the moderator's queue next to the attendee's button. */
export const WithModeratorQueue: Story = { render: () => <Demo withQueue /> };
export const SerbianLatin: Story = { render: () => <Demo />, parameters: { locale: 'sr-Latn' } };
export const Hungarian: Story = { render: () => <Demo raised />, parameters: { locale: 'hu' } };
