/**
 * `@Authorize()` resource resolvers of the webinar routes (T-CW-2.1,
 * guidelines 7.3). The routes address an occurrence by `:id` and carry no
 * `:orgId`, so `orgResourceFromContext` cannot serve them: the resolvers
 * load the occurrence and derive the resource from it, and the guard's
 * `authorize()` call decides. A missing occurrence answers 404 here.
 *
 * - {@link webinarRegistrantResource} (`event.register`): the caller's own
 *   registration of the occurrence. `ownerId` is the caller, so only the
 *   `own` scope of the `employee` template matches; the organisation is the
 *   occurrence's, or the caller's active organisation for an occurrence open
 *   to several organisations (its grants are loaded for that organisation).
 *   The audience policy is checked by the service (CW-R-32).
 * - {@link webinarListResource} (`event.register`, `GET /webinars`): the
 *   same without an occurrence.
 * - {@link webinarStaffResource} (`event.moderate`): the occurrence in its
 *   organisation, no owner. A platform-scoped grant reaches every occurrence,
 *   `client_operations` the occurrences of its CLIENT organisations.
 * - {@link webinarOpsResource} and {@link webinarOpsCreateResource}
 *   (`event.manage`, `/ops/webinars`): the operations checks of API-R-28
 *   (a web session in the operations context), then the occurrence's
 *   organisation; for a new occurrence, the one organisation its audience
 *   policy names (an occurrence for several organisations or for all is a
 *   platform resource). The body is read only to name the resource being
 *   created: it is validated after the guard, and a malformed body yields a
 *   platform resource, which only a platform grant matches.
 *
 * Resolvers are plain functions in decorator metadata, outside dependency
 * injection, so `WebinarsModule` binds the lookup at start-up; an unbound
 * lookup throws (500) and the route fails closed.
 */
import { WebinarAudiencePolicySchema, type Principal, type Resource } from '@nestself/contracts';
import { ApiHttpException } from '../common/api-error.js';
import type { ResourceResolver } from '../authz/authorize.decorator.js';
import { assertOperationsSession } from '../authz/resolvers.js';
import { occurrenceOrgId } from './webinar-mapper.js';
import type { WebinarRecord } from './webinars.repository.js';

export interface WebinarLookup {
  findById(id: string): Promise<WebinarRecord | null>;
}

let lookup: WebinarLookup | null = null;

/** Called by `WebinarsModule` on init (the repository) and on destroy (null). */
export function bindWebinarLookup(next: WebinarLookup | null): void {
  lookup = next;
}

export const WEBINAR_RESOURCE_TYPE = 'webinar';

function notFound(): ApiHttpException {
  return new ApiHttpException({ status: 404, code: 'not_found', message: 'Resource not found' });
}

function routeParam(req: Record<string, unknown>, name: string): string | undefined {
  return (req['params'] as Record<string, string | undefined> | undefined)?.[name];
}

/**
 * The caller's active organisation, if any: the organization context, or the
 * organisation of a personal context (an employee in "My space" of that org).
 */
export function contextOrgId(principal: Principal): string | undefined {
  const ctx = principal.context;
  if (ctx.kind === 'organization') return ctx.orgId;
  if (ctx.kind === 'personal' && 'orgId' in ctx && ctx.orgId) return ctx.orgId;
  return undefined;
}

/** The occurrence as a staff resource: its id and organisation. */
export function webinarStaffResourceOf(webinar: Pick<WebinarRecord, 'id' | 'orgId'>): Resource {
  return webinar.orgId
    ? { type: WEBINAR_RESOURCE_TYPE, id: webinar.id, orgId: webinar.orgId }
    : { type: WEBINAR_RESOURCE_TYPE, id: webinar.id };
}

/** The caller's own registration of the occurrence (see the header). */
export function webinarRegistrantResourceOf(webinar: Pick<WebinarRecord, 'id' | 'orgId'>, principal: Principal): Resource {
  const orgId = webinar.orgId ?? contextOrgId(principal);
  return orgId
    ? { type: WEBINAR_RESOURCE_TYPE, id: webinar.id, orgId, ownerId: principal.userId }
    : { type: WEBINAR_RESOURCE_TYPE, id: webinar.id, ownerId: principal.userId };
}

async function loadWebinar(req: Record<string, unknown>): Promise<WebinarRecord> {
  const id = routeParam(req, 'id');
  if (!id) throw notFound();
  if (!lookup) throw new Error('webinar resolvers: WebinarsModule has not bound the webinar lookup');
  const webinar = await lookup.findById(id);
  if (!webinar) throw notFound();
  return webinar;
}

export const webinarRegistrantResource: ResourceResolver = async (req, principal) =>
  webinarRegistrantResourceOf(await loadWebinar(req), principal);

export const webinarListResource: ResourceResolver = (_req, principal) => {
  const orgId = contextOrgId(principal);
  return orgId
    ? { type: WEBINAR_RESOURCE_TYPE, orgId, ownerId: principal.userId }
    : { type: WEBINAR_RESOURCE_TYPE, ownerId: principal.userId };
};

export const webinarStaffResource: ResourceResolver = async (req) => webinarStaffResourceOf(await loadWebinar(req));

export const webinarOpsResource: ResourceResolver = async (req, principal) => {
  assertOperationsSession(principal);
  return webinarStaffResourceOf(await loadWebinar(req));
};

export const webinarOpsCreateResource: ResourceResolver = (req, principal) => {
  assertOperationsSession(principal);
  const body = req['body'] as Record<string, unknown> | undefined;
  const policy = WebinarAudiencePolicySchema.safeParse(body?.['audiencePolicy']);
  const orgId = policy.success ? occurrenceOrgId(policy.data) : null;
  return orgId ? { type: WEBINAR_RESOURCE_TYPE, orgId } : { type: WEBINAR_RESOURCE_TYPE };
};
