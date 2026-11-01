# Employee listening and workplace reviews

The module that measures the employee experience in five dimensions every cycle, reports it to the employer in protected aggregates, offers a human workplace review when a result is red, and gives employees a feedback channel that is anonymous towards their employer.

## Reading order

1. [`spec.md`](spec.md): the product rules, user stories (CFG, SUR, EMP, SCO, REP, PRI, FBK, REV, OPS), state machines and fixtures. The source of every requirement.
2. [`../../adr/0002-employee-listening-module.md`](../../adr/0002-employee-listening-module.md): the decisions the spec left to the implementation and the departures from it, numbered D-EL-01 to D-EL-14.
3. [`dev.md`](dev.md): what was built and how. Modules, tables, actions and templates, jobs, routes, state machines as implemented, privacy mechanics, the scoring contract, how to run and test, sample data, known gaps and the story coverage table.
4. [`user-guide.md`](user-guide.md) (also [`user-guide.pdf`](user-guide.pdf)): what each role does, screen by screen, and what every state means. Rebuild the PDF with `pnpm docs:listening:pdf`.
5. [`../../superpowers/plans/2026-11-01-employee-listening.md`](../../superpowers/plans/2026-11-01-employee-listening.md): the eighteen-task plan the implementation followed.

The authorization model the module relies on is described in [`../../auth/implementation.md`](../../auth/implementation.md) (sections 3, 9, 11.2 and 14 name the listening modules, actions, confidential domain and jobs).
