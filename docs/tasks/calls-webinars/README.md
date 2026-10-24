# Consultations and webinars on Amazon Chime SDK (`NS-CALLS-01`)

Planning package for the real-time layer of NestSelf: private expert and employee video consultations, webinars for employees of client companies, and small group workshops, all on Amazon Chime SDK in eu-central-1. Written 24 October 2026 on branch `feat/calls-webinars`; revised the same day with the founder's answers (decision record v1.1, D-CW-34 to D-CW-38).

Status: ready to implement. The founder answered F-CW-01 to F-CW-10 (section 9 of `02-decisions.md`): every webinar is recorded and consultations are not, attendees never have cameras and the floor is audio given by a host, no product ceiling on audiences (250 per meeting in M2, 1,000 with replication in M3), a follow-up is scheduled on the post-call screens with manager approval where the client's policy requires it, the launch is Serbia only, and the DPIA never blocks development.

## Reading order

| File | What it is | Read it when |
| --- | --- | --- |
| `calls-webinars-review.pdf` | The review copy: plan in brief, the ten answers and how each was applied, the decisions in one line each, every story with its acceptance criteria | First read |
| `02-decisions.md` | The binding decision record: scope, provider and lifecycle, webinar delivery models, client, data and privacy, canonical names, spikes, founder questions, legal checklist | Before anything else; everything below cites it |
| `03-epic.md` | The epic charter: what it delivers, who it serves, architecture, privacy model, milestones M0 to M4, risks, exit criteria | Product review and planning |
| `04-user-stories.md` | The story catalog (`CALL-`, `WBN-`, `WKS-`, `PLT-`) with testable acceptance criteria and traceability to the product flows | Writing tests, scoping a sprint |
| `05-tasks.md` | The development backlog: tasks `T-CW-<milestone>.<n>` with files, steps, tests, gates and estimates, grouped in lanes | Starting an engineering session |
| `06-implementation-guidelines.md` | The technical reference with requirements `CW-R-nn`: adapter contract, Chime calls, lifecycle, schema and RLS, contracts, routes, real-time, worker, notifications, client package, mobile, infrastructure, security, observability, testing | Before touching the code |
| `research/01` to `06` | The research grounding with fact ids (`CORE-`, `WEB-`, `LAW-`, `COST-`, `UX-`, `OPS-`) and the codebase survey; each fact has a source and a date | When a decision's evidence is questioned |
| `research/07-spikes.md` | Written during M0 by the spike tasks | After the spikes run |
| `sources/` | The product flows and user stories v0.1 and the CMS epic v1.0 this package builds on | For context |

## How this package relates to the rest of the repository

- It does not reopen the auth strategy's video decisions (D-22, CONF-R-12, CONF-R-13, INFRA-R-22) or the auth implementation conventions in `docs/auth/implementation.md`; it builds on them.
- It owns a minimal appointment spine and the webinar occurrences; a future booking epic (`NS-BOOKING-01`) owns availability, booking, funding and rescheduling; the CMS epic (`NS-CONTENT-01`) owns the review and publication of webinar replays.
- Auth phase 2 (`docs/superpowers/plans/2026-10-24-auth-phase-2.md`) is being implemented in parallel and touches `packages/contracts/src/actions.ts`, `templates.ts` and the schema; the tasks that add `event.manage` and `event.moderate` run last in their milestone and rebase first.

## What happens next

1. M0 runs the spikes and writes `research/07-spikes.md`; any decision marked "spike" binds after that.
2. Engineering sessions take tasks from `05-tasks.md` one at a time, each in its own commit, gated by `pnpm verify`.
3. The DPIA and the legal checklist in section 10 of the decision record run alongside development and gate only the production launch (Serbian law, D-CW-38).

## Rebuilding the review PDF

`pdf/make-review-html.py` generates `pdf/calls-webinars-review.html` from the markdown (founder questions, spikes and the legal list from `02-decisions.md`, the story tables from `04-user-stories.md`, the decision one-liners kept in the script). `pdf/build-pdf.mjs` renders it with Playwright's Chromium after the in-page paginator has packed the cards and rows into fixed A4 sheets, and refuses to write when a sheet overflows. Run both from a checkout that has `node_modules` (or symlink it next to the script):

```
python3 docs/tasks/calls-webinars/pdf/make-review-html.py docs/tasks/calls-webinars
node docs/tasks/calls-webinars/pdf/build-pdf.mjs docs/tasks/calls-webinars/pdf/calls-webinars-review.html docs/tasks/calls-webinars/calls-webinars-review.pdf
```

## Conventions used in this package

Plain English, no em-dashes, no placeholders. Numbers come from cited facts or are labelled planning assumptions. Sample data is fictional and flagged. Canonical names (modules, env variables, tables, routes, actions, events, keys, jobs, packages) are defined once in section 7 of the decision record and used verbatim everywhere else.
