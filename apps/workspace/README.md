# NestSelf Workspace

The client-organisation SPA for NestSelf, built with Vite, React, TanStack Router and Tailwind CSS.

## Routes

| Path | Access | Description |
| --- | --- | --- |
| `/` | All roles | Employee home: greeting, support areas, next appointment, channel digest |
| `/support` | All roles | Support area overview |
| `/support/:area` | All roles | Support area detail with articles, experts, and BookingDemo |
| `/appointments` | All roles | Appointments (empty state) |
| `/messages` | All roles | Messages (empty state) |
| `/messages/:threadId` | All roles | Message thread (empty state) |
| `/channels` | All roles | Channel list |
| `/channels/:channelId` | All roles | Channel feed |
| `/polls` | All roles | Polls (empty state) |
| `/settings` | All roles | Language, theme mode, privacy settings |
| `/manage` | Manager, HR admin | Team management (empty state) |
| `/manage/polls/new` | Manager, HR admin | New poll (empty state) |
| `/manage/events/new` | Manager, HR admin | New event (empty state) |
| `/hr` | HR admin only | Programme dashboard with metrics, table, and event request summary |
| `/hr/eligibility` | HR admin only | Eligibility (empty state) |
| `/hr/reports` | HR admin only | Reports (empty state) |
| `/hr/events` | HR admin only | Events (empty state) |

## Session stub

The app uses a stub `SessionProvider` that defaults to the `employee` role from `SAMPLE_SESSIONS`. The role can be switched:

- Via `?role=<orgRole>` query parameter (e.g. `?role=hr_admin`)
- Via the role switcher in the ThemeStudio panel (development only)

This is a development stub. In production, session data would come from the API.

## Development

```bash
pnpm --filter @nestself/workspace dev      # Start dev server on port 5173
pnpm --filter @nestself/workspace build    # Production build
pnpm --filter @nestself/workspace preview  # Preview production build
pnpm --filter @nestself/workspace lint     # ESLint
pnpm --filter @nestself/workspace typecheck # TypeScript check
pnpm --filter @nestself/workspace test     # Vitest
```
