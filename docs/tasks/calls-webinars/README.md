# Consultations and webinars on Amazon Chime SDK (`NS-CALLS-01`)

Planning package for the real-time layer of NestSelf: private expert and employee video consultations, webinars for employees of client companies, and small group workshops, all on Amazon Chime SDK in eu-central-1. Written 24 October 2026 on branch `feat/calls-webinars`; revised the same day with the founder's answers (decision record v1.1, D-CW-34 to D-CW-38).

Status (25 October 2026): implemented from M0 to M2, plus the media replication of M3 (T-CW-3.2), on branch `feat/calls-p0`, one commit series per task, each task reviewed and the review findings fixed in its later commits. The consultation journeys run in a real browser against the API with the fake video provider (`pnpm e2e:calls`), and their screenshots are under `manual/`; the follow-up approval and webinar journeys (T-CW-2.6) and their screenshots were written but not yet committed when this status was written. Not built yet: certificates and the load test (T-CW-3.3, T-CW-3.4, P1) and M4 (mobile ticket route, workshops, replay captions). No spike has run against AWS yet. The planning files were amended on 25 October 2026 to match the code; `07-implementation-notes.md` records what changed and why.

Planning status (24 October 2026): ready to implement. The founder answered F-CW-01 to F-CW-10 (section 9 of `02-decisions.md`): every webinar is recorded and consultations are not, attendees never have cameras and the floor is audio given by a host, no product ceiling on audiences (250 per meeting in M2, 1,000 with replication in M3), a follow-up is scheduled on the post-call screens with manager approval where the client's policy requires it, the launch is Serbia only, and the DPIA never blocks development.

## Reading order

| File | What it is | Read it when |
| --- | --- | --- |
| `calls-webinars-review.pdf` | The review copy: plan in brief, the ten answers and how each was applied, the decisions in one line each, every story with its acceptance criteria | First read |
| `02-decisions.md` | The binding decision record: scope, provider and lifecycle, webinar delivery models, client, data and privacy, canonical names, spikes, founder questions, legal checklist | Before anything else; everything below cites it |
| `03-epic.md` | The epic charter: what it delivers, who it serves, architecture, privacy model, milestones M0 to M4, risks, exit criteria | Product review and planning |
| `04-user-stories.md` | The story catalog (`CALL-`, `WBN-`, `WKS-`, `PLT-`) with testable acceptance criteria and traceability to the product flows | Writing tests, scoping a sprint |
| `05-tasks.md` | The development backlog: tasks `T-CW-<milestone>.<n>` with files, steps, tests, gates and estimates, grouped in lanes | Starting an engineering session |
| `06-implementation-guidelines.md` | The technical reference with requirements `CW-R-nn`: adapter contract, Chime calls, lifecycle, schema and RLS, contracts, routes, real-time, worker, notifications, client package, mobile, infrastructure, security, observability, testing | Before touching the code |
| `07-implementation-notes.md` | What the implementation added to the plan: the defects only the real-browser run found and their fixes, the frontend-coverage audits and gap closures, how to run the stack and the journeys, the spikes still to run and what each binds, and the follow-ups | Before continuing the implementation or reviewing it |
| `user-manual.pdf`, `manual/` | The step-by-step guide (one user path per chapter, numbered steps, a screenshot per step on computer and phone) and its material: the generator `manual/make-manual-html.py`, the screenshots of every journey step for desktop and mobile (`manual/screenshots/`, listed in `manual/screenshots/INDEX.md`), recaptured by `pnpm e2e:calls` | Learning the screens; onboarding and support material |
| `research/01` to `06` | The research grounding with fact ids (`CORE-`, `WEB-`, `LAW-`, `COST-`, `UX-`, `OPS-`) and the codebase survey; each fact has a source and a date | When a decision's evidence is questioned |
| `research/07-spikes.md` | The eight spikes (SPIKE-CW-01 to SPIKE-CW-08) with method, prerequisites, result tables and the binding change per outcome; scripts written in T-CW-0.4; results pending the founder's run against the dev account | Before running a spike; after the spikes run |
| `sources/` | The product flows and user stories v0.1 and the CMS epic v1.0 this package builds on | For context |

## How this package relates to the rest of the repository

- It does not reopen the auth strategy's video decisions (D-22, CONF-R-12, CONF-R-13, INFRA-R-22) or the auth implementation conventions in `docs/auth/implementation.md`; it builds on them.
- It owns a minimal appointment spine and the webinar occurrences; a future booking epic (`NS-BOOKING-01`) owns availability, booking, funding and rescheduling; the CMS epic (`NS-CONTENT-01`) owns the review and publication of webinar replays.
- Auth phase 2 (`docs/superpowers/plans/2026-10-24-auth-phase-2.md`) is being implemented in parallel and touches `packages/contracts/src/actions.ts`, `templates.ts` and the schema; the tasks that add `event.manage` and `event.moderate` run last in their milestone and rebase first.

## What happens next

1. The founder runs the spikes against the dev account and records the results in `research/07-spikes.md`; any decision marked "spike" binds after that (SPIKE-CW-06 also confirms the replica floor of T-CW-3.2).
2. Engineering sessions take the remaining tasks from `05-tasks.md` (T-CW-3.3, T-CW-3.4, then M4) and the follow-ups of `07-implementation-notes.md` one at a time, each in its own commit, gated by `pnpm verify`.
3. The DPIA and the legal checklist in section 10 of the decision record run alongside development and gate only the production launch (Serbian law, D-CW-38).

## Rebuilding the review PDF

`pdf/make-review-html.py` generates `pdf/calls-webinars-review.html` from the markdown (founder questions, spikes and the legal list from `02-decisions.md`, the story tables from `04-user-stories.md`, the decision one-liners kept in the script). `pdf/build-pdf.mjs` renders it with Playwright's Chromium after the in-page paginator has packed the cards and rows into fixed A4 sheets, and refuses to write when a sheet overflows. Run both from a checkout that has `node_modules` (or symlink it next to the script):

```
python3 docs/tasks/calls-webinars/pdf/make-review-html.py docs/tasks/calls-webinars
node docs/tasks/calls-webinars/pdf/build-pdf.mjs docs/tasks/calls-webinars/pdf/calls-webinars-review.html docs/tasks/calls-webinars/calls-webinars-review.pdf
```

## Rebuilding the user manual

The manual is a tutorial: one user path per chapter (join a consultation, answer a follow-up, run a consultation, approve follow-ups, attend a webinar, create and run one, book a consultation and look up a call), numbered steps of one or two sentences, and the screen on computer and phone under each step, closed by a one-page "Good to know" on recording, privacy and retention. `manual/make-manual-html.py` generates `manual/user-manual.html` from the screenshots and `manual/screenshots/INDEX.md`, with every on-screen word read by key from the English catalog (`packages/i18n/locales/en/calls.json` and `common.json`), so a renamed button fails the build. A screen the steps do not place is added to a closing "More screens" chapter, and a planned screen without files shows as pending. `pdf/build-pdf.mjs` renders it after the in-page paginator has packed the steps into fixed A4 sheets, and refuses to write when a sheet overflows. Run both from a checkout that has `node_modules`:

```
python3 docs/tasks/calls-webinars/manual/make-manual-html.py docs/tasks/calls-webinars
node docs/tasks/calls-webinars/pdf/build-pdf.mjs docs/tasks/calls-webinars/manual/user-manual.html docs/tasks/calls-webinars/user-manual.pdf
```

## Conventions used in this package

Plain English, no em-dashes, no placeholders. Numbers come from cited facts or are labelled planning assumptions. Sample data is fictional and flagged. Canonical names (modules, env variables, tables, routes, actions, events, keys, jobs, packages) are defined once in section 7 of the decision record and used verbatim everywhere else.
