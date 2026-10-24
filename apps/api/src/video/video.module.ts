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
 * Builds the provider from the validated configuration. The `stage` tag comes
 * from `STAGE`, which the compute stack sets on every task; the API only runs
 * outside it in the dev stage (CW-R-66), hence the fallback.
 */
export function createVideoProvider(config: Pick<ConfigService, 'get'>): VideoProvider {
  if (config.get<string>('VIDEO_PROVIDER') === 'chime') {
    return new ChimeVideoProvider({
      eventsQueueArn: config.get<string>('CHIME_EVENTS_QUEUE_ARN')!,
      recordingsBucket: config.get<string>('RECORDINGS_BUCKET')!,
      stage: config.get<string>('STAGE') ?? 'dev',
    });
  }
  return new FakeVideoProvider();
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
