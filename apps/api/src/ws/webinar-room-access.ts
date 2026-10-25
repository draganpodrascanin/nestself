/**
 * Who may subscribe to the webinar rooms (T-CW-2.3, D-CW-15, D-CW-16,
 * guidelines 8, WBN-19, WBN-23):
 *
 * - `webinar:{webinarId}` (everyone in the occurrence): its hosts, a
 *   moderating principal, and every active registrant. A host subscribes on
 *   the action their host row needs (`event.present` for a presenter,
 *   `event.moderate` for the moderator, `WebinarAccess.host`); a moderating
 *   principal without a host row (`event.moderate` on the occurrence,
 *   operations) on `event.moderate`; a registrant on `event.register` on
 *   their own registration (`own` scope).
 * - `webinar:{webinarId}:moderation` (names, hands, the attendance count):
 *   hosts, presenters included so the presenter sees the count and the
 *   anonymous hands (WBN-19, WBN-10), and moderating principals. The
 *   moderation ACTIONS still need `event.moderate` on the server.
 *
 * A missing occurrence and a principal with no place in it both resolve to
 * null, which `SubscriptionAuthorizer` answers `not_found` (D-CW-30), and
 * the engine decides on the returned target again.
 *
 * `WebinarsModule` imports `WsModule`, so `WsModule` cannot import it back:
 * {@link WebinarRoomResolvers} looks the repository and the access service
 * up through `ModuleRef` once the application has started and registers the
 * two resolvers then. Where the webinars module is absent the rooms stay
 * unserved (`room_not_available`).
 */
import { Injectable, Logger, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { ModuleRef } from '@nestjs/core';
import { ACTIONS, type Principal } from '@nestself/contracts';
import { WebinarAccess } from '../webinars/webinar-access.js';
import { webinarRegistrantResourceOf, webinarStaffResourceOf } from '../webinars/webinar.resolver.js';
import { WebinarsRepository, type WebinarRecord } from '../webinars/webinars.repository.js';
// eslint-disable-next-line @typescript-eslint/consistent-type-imports -- NestJS DI needs runtime reference
import { RoomAccessRegistry, type RoomTarget } from './room-access.registry.js';

/** What the resolvers read: the occurrence, the caller's active registration, and the host and moderation checks. */
export interface WebinarRoomSource {
  repo: Pick<WebinarsRepository, 'findById' | 'findRegistration'>;
  access: Pick<WebinarAccess, 'host' | 'canModerate'>;
}

/** A host (by host row) or a moderating principal: the staff target, else null. */
async function staffTarget(source: WebinarRoomSource, webinar: WebinarRecord, principal: Principal): Promise<RoomTarget | null> {
  const host = await source.access.host(webinar, principal);
  if (host) {
    const action = host.role === 'moderator' ? ACTIONS['event.moderate'] : ACTIONS['event.present'];
    return { action, resource: webinarStaffResourceOf(webinar) };
  }
  if (await source.access.canModerate(webinar, principal)) {
    return { action: ACTIONS['event.moderate'], resource: webinarStaffResourceOf(webinar) };
  }
  return null;
}

/** `webinar:{webinarId}`: hosts, moderating principals and active registrants. */
export async function webinarRoomTarget(source: WebinarRoomSource, webinarId: string, principal: Principal): Promise<RoomTarget | null> {
  const webinar = await source.repo.findById(webinarId);
  if (!webinar) return null;
  const staff = await staffTarget(source, webinar, principal);
  if (staff) return staff;
  const registration = await source.repo.findRegistration(webinar.id, principal.userId);
  if (!registration) return null;
  return { action: ACTIONS['event.register'], resource: webinarRegistrantResourceOf(webinar, principal) };
}

/** `webinar:{webinarId}:moderation`: hosts (presenters and the moderator) and moderating principals. */
export async function webinarModerationRoomTarget(
  source: WebinarRoomSource,
  webinarId: string,
  principal: Principal,
): Promise<RoomTarget | null> {
  const webinar = await source.repo.findById(webinarId);
  return webinar ? staffTarget(source, webinar, principal) : null;
}

/** Registers both webinar room resolvers on the registry; returns the function that removes them. */
export function registerWebinarRooms(registry: RoomAccessRegistry, source: WebinarRoomSource): () => void {
  registry.register('webinar', (id, principal) => webinarRoomTarget(source, id, principal));
  registry.register('webinar_moderation', (id, principal) => webinarModerationRoomTarget(source, id, principal));
  return () => {
    registry.unregister('webinar');
    registry.unregister('webinar_moderation');
  };
}

@Injectable()
export class WebinarRoomResolvers implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(WebinarRoomResolvers.name);
  private unregister: (() => void) | null = null;

  constructor(
    private readonly registry: RoomAccessRegistry,
    private readonly moduleRef: ModuleRef,
  ) {}

  onApplicationBootstrap(): void {
    if (this.unregister) return;
    const source = this.lookup();
    if (!source) {
      this.logger.warn('Webinar rooms not served: the webinars module is not loaded');
      return;
    }
    this.unregister = registerWebinarRooms(this.registry, source);
  }

  onModuleDestroy(): void {
    this.unregister?.();
    this.unregister = null;
  }

  private lookup(): WebinarRoomSource | null {
    try {
      return {
        repo: this.moduleRef.get(WebinarsRepository, { strict: false }),
        access: this.moduleRef.get(WebinarAccess, { strict: false }),
      };
    } catch {
      return null;
    }
  }
}
