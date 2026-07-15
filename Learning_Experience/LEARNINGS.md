# Learnings Index

One line per lesson. Read this at session start; treat each "How to apply" as a rule for the session. Protocol: [README.md](./README.md). Template: [_TEMPLATE.md](./_TEMPLATE.md).

| ID | Severity | Lesson | Rule in one line |
| --- | --- | --- | --- |
| [L001](./L001-verify-source-access-before-planning.md) | major | Planned against a private reference repo before confirming read access | Verify a source is reachable before designing on it; label inferred content as inferred. |
| [L002](./L002-keep-openspec-requirements-behavioral.md) | minor | Leaked internal function names / mechanism into an OpenSpec requirements delta | Keep OpenSpec requirements behavioural + mechanism-agnostic; put function names, markers, and mechanism in design.md. |
| [L003](./L003-unref-guard-timers-break-isolated-timeout-tests.md) | minor | An unref'd timeout-guard timer let the event loop exit before it could fire, cancelling every test | Never unref() a timer that is an operation's only completion path (timeout guards/watchdogs); unit-test timeout utils against a never-settling promise. |

<!-- Append new rows above this line. Newest at the bottom of the table. -->
