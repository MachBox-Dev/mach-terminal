# Repository checks and reviews

Changes go through pull requests. Sign commits with `git commit -s` for DCO.
CodeRabbit automatic reviews are configured in `.coderabbit.yaml`; the GitHub
App must also be installed for this repository. Configuration alone does not
activate the service. Existing review integrations remain enabled.

CodeRabbit reviews ready pull requests and subsequent commits; draft PRs wait
until marked ready. It supplements tests and maintainer review. Its check must
not be made required until its actual check name and successful execution have
been observed on this repository.

CODEOWNERS requests the maintainer on changes. Required approvals remain a
repository ruleset setting; CODEOWNERS by itself does not enforce a merge gate.

Keep workflow tokens read-only unless a particular publishing job needs write
access. Untrusted pull request code runs with pull_request, never
pull_request_target. Release, deployment, and publication remain separate.

## Mach Terminal gates

The existing ruleset requires all three platform matrix jobs, Stability Signoff
and Security Baseline (ubuntu), plus its CodeQL and pull-request rules. Preserve
these names when editing CI. DCO is installed and has produced the successful
`DCO` check (GitHub App ID 1861); it is included in required status checks.
Node 24 is used consistently for CI and release validation. Dependabot checks
npm, Cargo and Actions weekly; updates still require normal PR checks/review.

Repository administration changes are separate from this source configuration.
Read back the live ruleset and verify actual app installation and PR review
before reporting the setup complete.
