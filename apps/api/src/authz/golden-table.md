# Golden Decision Table

Each tuple in `golden-table.json` exercises the `authorize()` engine with
a deterministic `(principal, action, resource, ctx)` input and asserts
the expected `Decision`.

## Tuple shape

| Field       | Type                          | Description                                     |
|-------------|-------------------------------|-------------------------------------------------|
| `label`     | `string`                      | Human-readable name prefixed with a story code  |
| `principal` | `Principal`                   | Resolved caller (userId, context, memberships)  |
| `action`    | `Action`                      | Dotted action string from the 4.3 catalogue     |
| `resource`  | `Resource`                    | Target resource with optional scope fields      |
| `ctx`       | `AuthorizationContext` (JSON) | Pre-loaded grants, assignments, ancestor ids    |
| `expected`  | `{ allowed, denialReason }`   | Deterministic expectation                       |

Dates in the JSON are ISO-8601 strings; the test loader parses them to
`Date` objects before passing them to `authorize()`.

`GrantCondition` uses `type` as the discriminated-union key (not `kind`).

## Coverage

The table covers every template (21), every denial reason (11), every
scope type (9), every condition kind (4), delegation success and failure
paths, self-approval, emergency access lifecycle, confidential-domain
isolation, membership edge cases, and user-state denials.

Labels use prefixes: EMP, MGR, ORG, PLAT, EXP, FIN, CLFIN, COORD, CMS,
LEAD, OPS, EVT, SYS, CONF-DENY, CMSE, DELEG, OWNER.

CONF-DENY rows use the professional module's resource shape (`id` = case
id, `ownerId` = employee, `isConfidential: true`) on
`conversation.read.assigned` / `conversation.participate`:

- CONF-DENY-01: `platform` grant (platform_owner), matching CASE assignment: denied `no_matching_grant`.
- CONF-DENY-02: `organization` grant (hr_admin), matching CASE assignment: denied `no_matching_grant`.
- CONF-DENY-03: `assigned_cases` grant (expert), matching CASE assignment: allowed.
- CONF-DENY-04: `own` grant (employee), participant: allowed.
- CONF-DENY-05: `org_unit` grant with descendants (team_manager), matching CASE assignment: denied `no_matching_grant`.
- CONF-DENY-06: `assigned_clients` grant (client_operations), matching CASE and CLIENT assignments: denied `no_matching_grant`.

The deny rows carry a matching CASE assignment, so step 4 passes and the
denial comes from the step 5 administrative-scope exclusion.

## CMSE rows (T-C1.03)

CMSE-01 to CMSE-30 are cases CMS-01 to CMS-30 of cms-ee-strategy 5.8
(renamed because the CMS-01 to CMS-06 labels were already taken by the
content author and publisher rows). They cover the sixteen CMS actions, the
four editorial templates and the reviewer and publisher split. Where the
strategy table expects `confidential_domain_denied` for an administrative
grant (CMS-18, CMS-28, CMS-29), the engine returns `no_matching_grant`: that
reason is reserved for step 3 (a non-confidential action on a confidential
resource), while step 5 skips administrative scopes silently, as in
CONF-DENY-01 and CONF-DENY-02. CMSE-30 (ended CASE assignment) returns
`no_matching_assignment`.

Added in the review follow-up: CMSE-20 carries `collectionId: cat-sleep`, so
adding `media.manage` to the author grant flips it to allowed. CMSE-31 to
CMSE-35 cover an ended CASE assignment on `intake.respond` (denied), an
`intake_professional` with QUEUE and CASE assignments reading the record body
(denied: wrong scope), an author calling `content.publish` in an assigned
category, and `editorial_lead` and `platform_owner` calling `content.review`
(all denied).

DELEG rows cover a delegatee whose `ctx.grants` carries its own delegated
child grant plus the ancestor chain held by other users (as
`PrincipalLoader.loadGrants` loads it). `authorize()` matches only grants
whose `subjectUserId` is the principal's; the ancestors serve the
delegation-chain validation alone. Delegator `u51` holds the `hr_admin` root
grant; delegatee `u50` holds a child listing `people.invite` only.

- DELEG-ALLOW-01: child grant, active ancestor chain, `people.invite`: allowed.
- DELEG-DENY-01: ancestor revoked: denied `delegation_parent_revoked`.
- DELEG-DENY-02: `people.move`, an ancestor action the child does not list: denied `no_matching_grant` (the ancestor never grants to the delegatee).
- DELEG-DENY-03: child at chain depth 4: denied `delegation_depth_exceeded`.

SYS-11 evaluates as `u1`, the holder of the depth-4 grant, since another
user's grant in `ctx.grants` no longer matches.

OWNER rows cover the owner model (2026-10-24): `employer_owner` holds
`access.grant` and `access.revoke` (step-up `administration`, satisfied by the
row's recent step-up).

- OWNER-ALLOW-01: `employer_owner` grant in `o1`, `access.grant` on a `Grant` in `o1`: allowed.
- OWNER-DENY-01: the same grant, `access.grant` on a `Grant` in `o2`: denied `no_matching_grant`.

The single-owner rule (one active `employer_owner` grant per organization) is
a write-time rule in `GrantsService`, not an engine decision, so no row
covers it.

No DELEG row covers a child condition (e.g. `spending_ceiling`) that exceeds
its ancestor's: at runtime `validateDelegation` checks ancestors only for
presence, revocation and validity window, and the parent's delegation
envelope. Condition bounds are enforced when grants are written:
`GrantsService.delegate` and `update` of a delegated grant check the child
against its parent, and `update` of a parent refuses (409 `conflict`,
`details.children`) conditions that would leave an active child outside
them (AUTHZ-R-37).
