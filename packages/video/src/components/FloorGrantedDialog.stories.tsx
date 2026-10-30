import type { Meta, StoryObj } from '@storybook/react-vite';
import { Button } from '@nestself/ui';
import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { useControllerSlice } from '../hooks/useControllerSlice';
import { useWebinarStage } from '../hooks/useWebinarStage';
import { withCallsI18n } from '../stories/decorators';
import { FakeCallSessionController } from '../testing/fake-controller';
import { FakeWebinarClient } from '../testing/fake-webinar';
import { FAKE_WEBINAR_SAMPLE_PEOPLE, createSampleWebinarServer } from '../testing/fake-webinar-sample';
import { FloorGrantedDialog, FloorTakenNotice } from './FloorGrantedDialog';

const meta: Meta<typeof FloorGrantedDialog> = {
  title: 'Video/FloorGrantedDialog',
  component: FloorGrantedDialog,
  decorators: [withCallsI18n],
};
export default meta;

type Story = StoryObj<typeof FloorGrantedDialog>;

/**
 * The attendee's side of the floor (CW-R-125): the story buttons play the
 * host giving and taking back the floor on a fake webinar and a fake call.
 * Audio only; nothing is sent anywhere.
 */
function Demo({ given = false }: { given?: boolean }) {
  const { t } = useTranslation('calls');
  const [scene] = useState(() => {
    const server = createSampleWebinarServer({ status: 'live', chat: false });
    const controller = new FakeCallSessionController({ role: 'attendee', format: 'webinar' });
    const [ana] = FAKE_WEBINAR_SAMPLE_PEOPLE.attendees;
    const client = new FakeWebinarClient({ server, role: 'attendee', participantId: ana.participantId, name: ana.name, audio: controller });
    return { server, controller, client, participantId: ana.participantId };
  });
  const stage = useWebinarStage(scene.client);
  const media = useControllerSlice(scene.controller, 'media');
  useEffect(() => {
    scene.controller.simulate.connected();
    if (given) scene.server.simulate.floorGiven(scene.participantId);
  }, [scene, given]);
  return (
    <div className="gap-4 flex max-w-xl flex-col items-start">
      <div className="gap-2 flex flex-wrap">
        <Button size="sm" onClick={() => scene.server.simulate.floorGiven(scene.participantId)} disabled={stage.myFloor.status === 'given'}>
          A host gives the floor (sample)
        </Button>
        <Button size="sm" variant="secondary" onClick={() => scene.server.simulate.floorTaken(scene.participantId)} disabled={stage.myFloor.status !== 'given'}>
          The host takes it back (sample)
        </Button>
      </div>
      <p className="type-metadata text-text-secondary" data-testid="floor-story-state">
        {stage.myFloor.status} · {media.muted ? t('controls.announce.muted') : t('controls.announce.unmuted')}
      </p>
      <FloorTakenNotice client={scene.client} className="w-full" />
      <FloorGrantedDialog client={scene.client} controller={scene.controller} />
      <p className="type-metadata text-text-secondary">{t('sample.actionNoop')}</p>
    </div>
  );
}

export const Closed: Story = { render: () => <Demo /> };
/** Opens on load: "You can speak now. Unmute to talk." with the recording notice. */
export const FloorGiven: Story = { render: () => <Demo given /> };
export const SerbianLatin: Story = { render: () => <Demo given />, parameters: { locale: 'sr-Latn' } };
export const Hungarian: Story = { render: () => <Demo given />, parameters: { locale: 'hu' } };
