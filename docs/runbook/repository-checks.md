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
The verified `CodeRabbit` check (GitHub App ID 347564) is also required.
Node 24 is used consistently for CI and release validation. Dependabot checks
npm, Cargo and Actions weekly; updates still require normal PR checks/review.

Repository administration changes are separate from this source configuration.
Read back the live ruleset and verify actual app installation and PR review
before reporting the setup complete.

## Security baseline maintenance

On 2026-11-02 the existing lockfile failed the required RustSec gate on 16
advisories. Compatible updates moved rustls to 0.23.46, webpki to 0.103.16,
root bundles to 1.0.11 and quinn-proto to 0.11.19. Resolving zip 4.6.1
advisories requires tauri-plugin-updater 2.14.1 and zip 9; Cargo also updates
the compatible Tauri 2 framework chain (tauri 2.12.5). No new advisory ignores
were added. The existing scoped quick-xml build-time exceptions are unchanged.

The committed `Cargo.lock` is the reproducible baseline; fetch its exact versions
with `cargo fetch --manifest-path src-tauri/Cargo.toml --locked`.
To refresh the named packages to their latest compatible versions, run
`cargo update --manifest-path src-tauri/Cargo.toml
-p quinn-proto -p rustls -p rustls-webpki -p webpki-root-certs -p webpki-roots`.
Pin the updater to the remediated version with
`cargo update --manifest-path src-tauri/Cargo.toml -p tauri-plugin-updater
--precise 2.14.1`. Verify with `cargo audit -f src-tauri/Cargo.lock`, the Rust
suite and all three platform CI jobs before merging. A clean dependency audit
does not establish native updater or application acceptance.
