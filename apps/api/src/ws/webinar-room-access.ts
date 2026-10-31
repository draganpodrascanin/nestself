/**
 * Who may subscribe to the webinar rooms (T-CW-2.3, D-CW-15, D-CW-16,
 * CW-R-36a, guidelines 8, WBN-19, WBN-20, WBN-23):
 *
 * - `webinar:{webinarId}` (everyone in the occurrence): its hosts, a
 *   moderating principal, and every active registrant. A host subscribes on
 *   the action their host row needs (`event.present` for a presenter,
 *   `event.moderate` for the moderator, `WebinarAccess.host`); a moderating
 *   principal without a host row (`event.moderate` on the occurrence,
 *   operations) on `event.moderate`; a registrant on `event.register` on
 *   their own registration (`own` scope).
 * - `webinar:{webinarId}:moderation` (pending messages and hands with the
 *   registration names): moderators only, the host row with the moderator
 *   role or a moderating principal. Presenters never see names (WBN-20.2).
 * - `webinar:{webinarId}:hosts` (the attendance count, the hand count and the
 *   floor holder's participant id, never a name): presenters and moderators
 *   (WBN-19, WBN-25).
 *
 * A missing occurrence and a principal with no place in it both resolve to
 * null, which `SubscriptionAuthorizer` answers `not_found` (D-CW-30), and
 * the engine decides on the returned target again.
 *
 * `WebinarsModule` imports `WsModule`, so `WsModule` cannot import it back:
 * {@link WebinarRoomResolvers} looks the repository and the access service
 * up through `ModuleRef` once the application has started and registers the
 * three resolvers then. A failed lookup throws at start-up: the API must not
 * run with webinar rooms silently unserved.
 */
import { Injectable, type OnApplicationBootstrap, type OnModuleDestroy } from '@nestjs/common';
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

/** `webinar:{webinarId}:moderation`: the moderator (host row) and moderating principals; never a presenter. */
export async function webinarModerationRoomTarget(
  source: WebinarRoomSource,
  webinarId: string,
  principal: Principal,
): Promise<RoomTarget | null> {
  const webinar = await source.repo.findById(webinarId);
  if (!webinar) return null;
  const host = await source.access.host(webinar, principal);
  const moderates = host?.role === 'moderator' || (await source.access.canModerate(webinar, principal));
  return moderates ? { action: ACTIONS['event.moderate'], resource: webinarStaffResourceOf(webinar) } : null;
}

/** `webinar:{webinarId}:hosts`: presenters, the moderator and moderating principals. */
export async function webinarHostsRoomTarget(source: WebinarRoomSource, webinarId: string, principal: Principal): Promise<RoomTarget | null> {
  const webinar = await source.repo.findById(webinarId);
  return webinar ? staffTarget(source, webinar, principal) : null;
}

const WEBINAR_ROOM_KINDS = ['webinar', 'webinar_moderation', 'webinar_hosts'] as const;

/** Registers the three webinar room resolvers on the registry; returns the function that removes them. */
export function registerWebinarRooms(registry: RoomAccessRegistry, source: WebinarRoomSource): () => void {
  registry.register('webinar', (id, principal) => webinarRoomTarget(source, id, principal));
  registry.register('webinar_moderation', (id, principal) => webinarModerationRoomTarget(source, id, principal));
  registry.register('webinar_hosts', (id, principal) => webinarHostsRoomTarget(source, id, principal));
  return () => {
    for (const kind of WEBINAR_ROOM_KINDS) registry.unregister(kind);
  };
}

@Injectable()
export class WebinarRoomResolvers implements OnApplicationBootstrap, OnModuleDestroy {
  private unregister: (() => void) | null = null;

  constructor(
    private readonly registry: RoomAccessRegistry,
    private readonly moduleRef: ModuleRef,
  ) {}

  onApplicationBootstrap(): void {
    if (this.unregister) return;
    this.unregister = registerWebinarRooms(this.registry, this.lookup());
  }

  onModuleDestroy(): void {
    this.unregister?.();
    this.unregister = null;
  }

  /** The webinars module's repository and access service; throws when the module is not loaded. */
  private lookup(): WebinarRoomSource {
    try {
      return {
        repo: this.moduleRef.get(WebinarsRepository, { strict: false }),
        access: this.moduleRef.get(WebinarAccess, { strict: false }),
      };
    } catch (error) {
      throw new Error('WebinarRoomResolvers: the webinars module is not loaded; the webinar rooms cannot be served', { cause: error });
    }
  }
}
