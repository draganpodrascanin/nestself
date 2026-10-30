/**
 * Video module (NS-CALLS-01): provides the {@link VideoProvider} selected by
 * `VIDEO_PROVIDER` under the `VIDEO_PROVIDER` token.
 *
 * - `none` (the default, and every test): {@link FakeVideoProvider}.
 * - `chime`: {@link ChimeVideoProvider}. The env schema has already refused
 *   start-up unless `CHIME_REGION` is eu-central-1 and the events queue and
 *   recordings bucket are set (D-CW-06).
 *
 * @see D-CW-05, guidelines section 2
 */
import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ChimeVideoProvider } from './chime-video-provider.js';
import { FakeVideoProvider } from './fake-video-provider.js';
import { VIDEO_PROVIDER, type VideoProvider } from './video-provider.js';

/**
 * Builds the provider from the validated configuration. The env schema already
 * requires these values for `chime` and defaults `STAGE` (set by the compute
 * stack) to `dev`; the guard still names a missing one at start-up rather than
 * failing on the first meeting.
 */
export function createVideoProvider(config: Pick<ConfigService, 'get'>): VideoProvider {
  if (config.get<string>('VIDEO_PROVIDER') !== 'chime') return new FakeVideoProvider();

  const required = (key: 'CHIME_EVENTS_QUEUE_ARN' | 'RECORDINGS_BUCKET' | 'STAGE'): string => {
    const value = config.get<string>(key);
    if (!value) throw new Error(`${key} is required when VIDEO_PROVIDER=chime`);
    return value;
  };
  return new ChimeVideoProvider({
    eventsQueueArn: required('CHIME_EVENTS_QUEUE_ARN'),
    recordingsBucket: required('RECORDINGS_BUCKET'),
    stage: required('STAGE'),
  });
}

@Module({
  providers: [
    {
      provide: VIDEO_PROVIDER,
      inject: [ConfigService],
      useFactory: (config: ConfigService): VideoProvider => createVideoProvider(config),
    },
  ],
  exports: [VIDEO_PROVIDER],
})
export class VideoModule {}
