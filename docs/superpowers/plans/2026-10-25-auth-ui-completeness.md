# Auth UI Completeness Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Every authentication and authorization capability the API exposes has a real screen in the web apps (API mode, not sample data), with translated error states, component tests, a Playwright journey where a flow is user-visible, and a screenshot in the PDF guides.

**Architecture:** Follows the phase 2 feature-folder pattern (`apps/<app>/src/features/<area>/` with TanStack Query hooks over `@nestself/api-client`, dialogs built from `@nestself/ui`, `withStepUp` on step-up actions, error mappers with an `unknown` fallback). Missing client methods are added to `packages/api-client`. Three small API additions where a screen needs a list the API lacks: pending invitations list, organizations list for staff, and the expert/participant conversation lists. Screenshots are captured by the `screenshots` Playwright project created in the owner-model plan.

**Spec:** Owner requirement of 2026-10-25 ("make sure there's actual frontend to do the things we expect and add screenshots into the pdf doc"); strategy §5.2–5.4 for the routes; §6.1 client integration; the gap map in the execution ledger (API routes without a screen). Repository rules in `CLAUDE.md`.

## Decisions taken for this plan

| Decision | Why |
| --- | --- |
| Mobile stays as it is (sign-in, settings, sign-out); the new screens are web only | Mobile is the employee app; administration lives in the web apps (strategy §6.2) |
| Admin organizations come from a new `GET /ops/organizations` (`client.configure`) plus `GET /ops/organizations/:orgId`; create/patch stay out (client provisioning is a product task) | The admin app shows only the sample organization today |
| Pending invitations are listed by a new `GET /orgs/:orgId/invitations` (`people.invite`) and `GET /ops/orgs/:orgId/invitations` (`people.onboard`) | Revoke needs something to revoke |
| Expert area: `GET /professional/conversations` lists the caller's assigned conversations (CASE assignments) and `GET /professional/me/conversations` the participant's; both return metadata only (no bodies) and are `@Authenticated` with the service filtering by assignment / ownership | Single-record reads already exist; lists are needed to reach them |
| Context switching gets a visible picker in both app shells (personal / organization / expert / operations as available) | `/auth/context` is called only implicitly today |
| Account settings (display name, locale persisted to the API, sessions, sign-out everywhere, authenticator enrolment for signed-in users) live on the existing `settings` routes | One place for account security |
| CSV import is a paste-into-textarea of `email,templateKey[,orgUnitId]` rows parsed client-side into the existing import body | No file-upload infrastructure exists |

## Global Constraints

As phase 2 (no installs; semantic tokens only; translated error states with `unknown` fallback and a test per message; four locales with generated `sr-Cyrl`; sample mode uses `SAMPLE_` fixtures with the banner and disabled mutations; UI gating is convenience only; commit trailer `Co-Authored-By: Claude Fable 5.1 <noreply@anthropic.com>`; every new API route `@Authorize`/`@Authenticated`; DB suites with `TEST_DATABASE_URL`). Screenshots: 1280×800, light theme, fictional sample people only, PNG ≤ 300 KB, stored in `docs/auth/screenshots/`, embedded in `docs/auth/implementation.md` and `quick-guide.md` with captions, PDFs rebuilt.

## Review Focus

1. Ending a membership from the People page must require step-up (administration class) and show the dialog, not a bare 403. Test in Task 3.
2. A member list of more than one page must paginate with the API cursor, not silently cap at 100. Test in Task 3.
3. Revoking the current session from the sessions list must sign the user out cleanly (redirect to `/sign-in`), not leave a dead session on screen. Test in Task 2.
4. The context picker must never offer an organization the principal has no ACTIVE membership in, and switching must refresh `effectiveActions` so gated navigation updates without a reload. Test in Task 6.
5. Emergency record view must show content only after approval and must display a visible "this access is audited" notice. Test in Task 5.

---

### Task 1: API list endpoints and client methods

**Files:**
- API: `apps/api/src/invitations/invitations.controller.ts` + `ops-invitations.controller.ts` (`GET` list pending: `InvitationsRepository.listPending(orgId, { cursor, limit })`), `apps/api/src/organizations/organizations.controller.ts` + `service` + `module` (new: `GET /ops/organizations` and `GET /ops/organizations/:orgId`, `operationsResource('organization')`, `client.configure`; repository `OrganizationsRepository.list({ cursor, limit, search })`, `findById`), `apps/api/src/professional/professional.controller.ts` + `service` + `repository` (`GET professional/conversations` → conversations whose `caseId` is a CASE/SUPPORT_CASE assignment target of the caller, metadata only; `GET professional/me/conversations` → `employeeUserId = caller`), contracts (`InvitationListResponseSchema`, `OrganizationResponseSchema { id, name, slug, status, createdAt }`, `OrganizationListResponseSchema`, `ConversationSummarySchema { id, caseId, orgId, employeeUserId, expertUserId, createdAt, messageCount }`, list schemas), e2e additions in `invitations.e2e.spec.ts`, `ops-grants.e2e.spec.ts` (organizations), `professional.e2e.spec.ts`
- api-client: `packages/api-client/src/auth.ts` += `updateLocale(locale)`, `updateDisplayName(displayName)`, `totpEnrolSignedIn()` (if the no-token enrol is a separate call), `org-admin.ts` += invitations (list/create/import/revoke, org + ops), members (`updateMember`, `endMember`, org + ops), org units (`createOrgUnit`, `updateOrgUnit`, `moveOrgUnit`), `transferOwnership` (both kinds), ops-only `listOrganizations`, `getOrganization`, `suspendUser`, `reinstateUser`, `listEmergencyAccess`, `requestEmergencyAccess`, `approveEmergencyAccess`, `denyEmergencyAccess`, `revokeEmergencyAccess`, `readEmergencyRecord`; new `packages/api-client/src/professional.ts` (`listMyConversations`, `listAssignedConversations`, `getConversation`, `getMyConversation`, `getIntake`); tests for every method (method, path, CSRF, body, schema)

- [ ] API tests RED → GREEN; client tests RED → GREEN; commits `feat(api): list endpoints for invitations, organizations and conversations`, `feat(api-client): account, people, organization, emergency and professional methods`.

### Task 2: Account and security settings (workspace + admin)

**Files:** `apps/workspace/src/features/account/` (`account-settings.tsx`: display name form, locale `Select` persisted via `updateLocale` then `i18n.changeLanguage`; `sessions-list.tsx`: table from `listSessions` with current-session badge, revoke per row (`AlertDialog`), "Sign out everywhere"; `authenticator-section.tsx`: enrol for signed-in users (QR + manual key + confirm) shown when `auth.method === 'password_totp'` and no second factor, otherwise status), `use-account.ts`; `routes/_authenticated/settings.tsx` composes them; a visible **Sign out** item in the app shell user menu (both apps). Same under `apps/admin`. Translations ×4; tests per message and for Review Focus 3.
- [ ] Commit `feat(web): account and security settings with sessions and sign-out`.

### Task 3: Workspace HR People and Org units pages

**Files:** `apps/workspace/src/routes/_authenticated/_hr/hr/people.tsx`, `_hr/hr/org-units.tsx`, `features/people/` (`people-screen.tsx` with tabs Members / Invitations; members table paginated by cursor (Review Focus 2), filters (org unit, status, search), row actions: Move (dialog: org unit `Select`, line manager `Select`) → `updateMember`, End membership (reason `Select`, `withStepUp`) → `endMember` (Review Focus 1); invitations tab: pending list, Invite dialog (email, template `Select` limited to invitable templates, org unit), Import dialog (textarea CSV → rows → `importInvitations`, result table of created/skipped/errors), Revoke), `features/org-units/` (tree view from the flat list, create child, rename, move (parent `Select`), all `org_units.manage`), hooks, error mappers, sample-mode fixtures (`SAMPLE_PEOPLE`, `SAMPLE_TEAMS`, new `SAMPLE_INVITATIONS`), nav items gated by `program.overview` / `people.invite` / `org_units.manage`; translations ×4; tests.
- [ ] Commit `feat(workspace): people management and org units for HR`.

### Task 4: Admin organizations, people and users (ops)

**Files:** `apps/admin/src/routes/_authenticated/organizations/index.tsx` (API list with search; sample fallback), `$orgId.tsx` (heading from API; tabs Overview | People | Access; Overview shows org fields and the owner (from grants list filtered `employer_owner`) with **Transfer ownership** (ops route, `withStepUp`)), `$orgId/people.tsx` + `features/people/` (ops members list, End membership, Invitations list/Invite/Import/Revoke via ops routes); `features/users/` user actions on the user-access lookup result: **Suspend** (reason) / **Reinstate** with `withStepUp`; translations ×4; tests.
- [ ] Commit `feat(admin): organizations, people and user suspension from the operations workspace`.

### Task 5: Admin emergency access

**Files:** `apps/admin/src/routes/_authenticated/emergency/index.tsx`, `features/emergency/` (`emergency-screen.tsx`: list with status (pending/approved/expired/revoked), **Request access** dialog (purpose ≥ 10 chars, scope kind, scope id, duration), Approve/Deny (only when `approvedByUserId` is null and the caller is not the requester — the API enforces, the UI hides), Revoke, **Open record** (record type + id → `readEmergencyRecord` → read-only view with the audited-access notice (Review Focus 5))); error mapping incl. `self_approval_denied`, `emergency_not_active`, `step_up_required` via `withStepUp`; nav gated by `audit.read`; translations ×4; tests.
- [ ] Commit `feat(admin): emergency access management and audited record view`.

### Task 6: Context picker and expert area

**Files:** both apps: `features/context/context-picker.tsx` in the app shell header: lists personal, each ACTIVE membership organization (name from `/auth/me` memberships + org names: extend `PrincipalMembershipSchema` with `orgName` in the API `MeResponseBuilder`, or fetch names), expert (if `principal.expert`), operations (if `staffTemplates.length`); switching calls `switchContext` then `refreshPrincipal` (Review Focus 4); tests. Workspace expert area: `routes/_authenticated/_expert.tsx` (gate: `principal.expert !== null` or `can('conversation.read.assigned')`), `_expert/cases/index.tsx` (assigned conversations list), `_expert/cases/$id.tsx` (conversation messages + intake link; 403/404 as copy), employee `routes/_authenticated/conversations/$id.tsx` (participant view); `features/cases/`; translations ×4; tests.
- [ ] Commit `feat(web): context picker and expert case views`.

### Task 7: Journeys, screenshots, docs, PR

- Playwright: `e2e/auth/account.spec.ts` (display name change, sessions list, sign out everywhere), `e2e/auth/hr-people.spec.ts` (invite, move, end with step-up not firing on a fresh session, org unit create), `e2e/auth/admin-ops.spec.ts` (organizations list → People tab → end membership; emergency request/approve with two staff; suspend/reinstate), `e2e/auth/expert-cases.spec.ts` (Milica opens `conv_sample`).
- Screenshots: extend `e2e/screenshots/` with one PNG per new screen (settings, sessions, people members, invitations, import result, org units tree, admin organizations, admin people, emergency list, emergency record view, context picker open, expert case view, employee conversation view).
- Docs: `docs/auth/implementation.md` §3 map, §8 (account security), §11 (people, org units, ownership), §12 (emergency UI), §13 (expert area), §21; `docs/auth/quick-guide.md` ("What each role can do and where"); PDFs rebuilt; `phase-2-readiness.md` UI status; `e2e/README.md`.
- `pnpm verify` with DB suites; `pnpm e2e:auth`; commit `docs(auth): screens for every auth capability`; push `feat/auth-ui`; PR against `main` (or `feat/auth-foundation` if phase 2 is not merged yet).
