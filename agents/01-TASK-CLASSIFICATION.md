# Task Classification

## Purpose

Classify a request by the question it must answer so architecture, runtime, UI,
and release evidence are not confused.

## Use when

Use when a request spans multiple concerns, an issue title is ambiguous, or the
agent must decide which guide and validation level apply.

## Do not use when

Do not use classification to expand scope. A secondary track is loaded only
when technically necessary for the requested outcome.

## Prerequisites

- Owner request or issue body.
- Current repository baseline.
- Product/project file when available.

## Required inputs

- User-visible outcome.
- Data or authority affected.
- Runtime environment affected.
- External writes or release actions requested.
- Acceptance criteria and required live checks.

## Classification questions

### Product or feature work

Primary question:

> What should the application do?

Identify users, minimum flows, owner-visible success criteria, non-goals, and
compatibility requirements. Route new product work to
[`qortium-native-app-workflow.md`](qortium-native-app-workflow.md).

### Architecture and security work

Primary questions:

> Who is authoritative?  
> Who may publish or mutate each entity?  
> How are conflicts reduced?  
> Can unrelated publishers replace state?  
> How are operations authenticated?  
> How does the design scale?

Route to
[`qortium-architecture-and-data-integrity.md`](qortium-architecture-and-data-integrity.md)
and, where relevant,
[`qdn-publication-discovery-and-scaling.md`](qdn-publication-discovery-and-scaling.md).

### Runtime and performance work

Primary questions:

> What does the user experience?  
> Which operation blocks progress?  
> What are the measured timings?  
> Which state transition is incorrect?

Route to
[`runtime-diagnostics-and-performance.md`](runtime-diagnostics-and-performance.md).

### UI and visual work

Primary questions:

> What should the user see?  
> Does the control work?  
> Does the visual result match the intended design?

Use the project UI conventions and select live-validation levels appropriate to
the interaction. A visual task does not automatically authorize architecture,
data, or bridge changes.

### Release work

Primary questions:

> Is the implementation already validated?  
> Is the version correct?  
> Is the artifact reproducible?  
> Can the deployed resource be traced to source?

Route to
[`qavs-versioning-and-release.md`](qavs-versioning-and-release.md).

## Workflow

1. State the primary task class.
2. List secondary classes only when required.
3. Map each acceptance criterion to one class.
4. Identify evidence each class needs.
5. Split technically independent outcomes into separate issues.
6. Choose guides and validation levels from the routing table.

## Mandatory rules

> Passing architecture tests does not prove acceptable runtime UX.

> A visual improvement does not prove data integrity.

> A release artifact does not prove the deployed application works.

- MUST NOT report one track's evidence as proof of another.
- SHOULD create separate issues for independent architecture, runtime, visual,
  dependency, and release changes.
- A critical owner-reported runtime blocker MUST be tracked explicitly even
  when broader architecture work is underway.

## Validation

Confirm every acceptance criterion has an evidence source: static, automated,
local runtime, Core/API, embedded Home, or live QDN.

## Completion criteria

- One primary class is named.
- Secondary tracks and out-of-scope tracks are explicit.
- The selected guides and validation levels match the task.

## Related files

- [`00-SESSION-START.md`](00-SESSION-START.md)
- [`issue-driven-audit-and-refactor.md`](issue-driven-audit-and-refactor.md)
- [`live-qdn-validation.md`](live-qdn-validation.md)
