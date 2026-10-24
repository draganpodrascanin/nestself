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

The table covers every template (17), every denial reason (11), every
scope type (9), every condition kind (4), delegation success and failure
paths, self-approval, emergency access lifecycle, confidential-domain
isolation, membership edge cases, and user-state denials.

Labels use prefixes: EMP, MGR, ORG, PLAT, EXP, FIN, CLFIN, COORD, CMS,
LEAD, OPS, EVT, SYS, CONF-DENY.

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
