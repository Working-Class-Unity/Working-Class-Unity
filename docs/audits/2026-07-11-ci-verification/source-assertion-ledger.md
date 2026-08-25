# Source and configuration assertion ledger

**Post-audit outcome:** CI-S03/#72 removes the coverage source/config fragment loader, per-file debt JSON, artifact contract, and their mutation fixtures. CI-S04/#73 removes Doctor's source/file/dependency/environment/test-title inventories, its duplicate whole-contract evaluation, and its self-referential contract mirrors; effective private-artifact Git ignore behavior and pinned ESLint import rules replace the two meaningful outcomes. CI-S02A1/#88 removes direct application authentication/social/passwordless/email/client mirrors. CI-S02A2/#89 removes the direct module manifest, state helper, middleware, request-path, hostile-origin, Sentry-gate, and focused-test mirrors, plus dead module file/test/dependency inventories. CI-S02B/#70 removes runtime configuration, readiness, worker, deployment, and isolated-integration source/test-title mirrors and confirms that no raw framework mirror remained. `INT-01D` actual-runner signal interruption is explicitly retired rather than replaced with a fixture. CI-S02C1/#90 removes Playwright config/spec/helper/runner/reporter/test-title mirrors and their mutation fixtures. CI-S02C2/#91 removes Dockerfile, `.dockerignore`, container-driver, local-object-storage, container-test, and test-title mirrors and matching mutations. Actual Docker context/image/non-root/persistence/health behavior and the executable health probe remain; effective multi-class context canaries replace the final parsed `.dockerignore` policy. CI-S02C3/#92 removes maintenance implementation/test-title mirrors and their matching mutations while actual temporary-SQLite and process behavior remains. Exact package and provider pins remain structured policy; native execution and focused behavioral tests own application behavior. The figures and line references below intentionally preserve the audited-commit baseline.

**Post-audit PWA outcome (2026-07-14):** R-030R/[#139](https://github.com/smallwiselabs/swl-step-by-step/issues/139) removes the PWA manifest/source mirrors and their duplicate baseline source test without replacement. The historical rows and line references below remain the 2026-07-11 audit snapshot.

## Quantitative baseline

At the audited commit:

- `ci-contract.mjs` and its tests contain 4,058 physical lines.
- `loadCiContract()` explicitly reads 70 raw sources/configurations representing 67 unique named files, plus discovered workflow YAML and Playwright specifications.
- Sixty required-fragment lists contain 913 literal fragments:
  - 690 runtime/application fragments;
  - 149 browser fragments;
  - 59 coverage fragments;
  - 15 documentation fragments.
- The contract also contains 121 `.includes()` sites, 16 `.indexOf()` sites, 25 regex `.test()` sites, and 73 textual `readFileSync(` occurrences: 72 calls and one required source-string literal.
- `ci-contract.test.mjs` has 31 tests and 230 textual `.replace()` mutations:
  - 153 runtime/application;
  - 37 browser;
  - 8 coverage/documentation;
  - 32 workflow/mixed.
- Expanded loops result in approximately 51 contract evaluations per contract-test run. Doctor adds another current-source evaluation.
- Doctor separately performs 177 required-path checks representing 147 unique files, and freezes 55 required scripts, 19 dependencies/dev-dependencies, 15 `.gitignore` entries, 52 environment-list entries representing 51 unique variables, and 8 literal documentation/test patterns.

These figures are lower bounds because standalone equality, call-count, order, and forbidden-fragment assertions are not all included in the fragment count.

## Classification rule

### Structured declarative policy

Parsed configuration or data can be the subject of a legitimate invariant. Examples include workflow permissions, immutable pins, exact toolchain versions, dependency declarations, exception expiry, artifact scope, and a PWA manifest.

These checks may remain in a small data-driven validator when a maintained tool cannot know repository intent.

### Literal implementation-text assertion

An assertion is presumptively removable when it requires a source fragment, function/import spelling, test title, error message, command string, or exact call order without exercising the behavior represented by that text.

These assertions can pass when the text is in a comment, dead branch, or hollow test. They also fail on harmless helper extraction, formatting, renaming, or equivalent syntax.

### Executed-source evidence

Reading SQL, configuration, or a built artifact is behavioral when the content is actually executed or loaded by the production-compatible system and its outcome is asserted. Migration SQL executed against real SQLite is not reduced to “source inspection” merely because the test first reads the file.

## Structured declarative policy to retain or narrow

| Area                                               | Current location                                                                  | Material invariant                                                                                    | Proposed treatment                                                                        |
| -------------------------------------------------- | --------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Workflow event/permission/action/artifact policy   | `scripts/ci-contract.mjs:292-706,2586-2798`                                       | Triggers, stable contexts, read-only token, immutable pins, artifact bounds, draft/aggregate behavior | Use actionlint/zizmor for generic semantics; retain small parsed repository policy        |
| Package scripts and version agreement              | `scripts/ci-contract.mjs:594-705`; `scripts/toolchain-contract.mjs:31-79,108-139` | Node/pnpm/exact script entrypoints required by workflows                                              | Keep toolchain values; remove redundant aliases/inventories only when callers/docs change |
| Supply-chain policy JSON and parsed lock/workspace | `scripts/supply-chain-policy.mjs:81-341,344-476`                                  | Exact pins, lock integrity, scanner identities, exceptions and expiry                                 | Keep; simplify wrapper only with parity                                                   |
| Coverage configuration and debt JSON               | `scripts/ci-contract.mjs:713-839`                                                 | Broad inclusion and aggregate ceilings are material; exact inventory/count bookkeeping was not        | Removed by CI-S03; native Vitest execution is primary                                     |
| PWA manifest JSON                                  | `scripts/pwa-baseline-check.mjs:13-42`                                            | Valid manifest fields                                                                                 | Keep until #34                                                                            |
| `.dockerignore` policy                             | `scripts/ci-container-build.test.mjs:13-44`                                       | Secret-shaped canaries never enter context                                                            | Removed by #91; actual multi-class Docker canaries own effective context exclusion        |

## Literal implementation-text removal candidates

Line references are against audited commit `3f705edac3d66ff5bea1db6098f39342baa8b57d`.

| Domain                                    | Contract ranges or files                | Examples of frozen implementation detail                                                    | Primary replacement evidence                                                                                                |
| ----------------------------------------- | --------------------------------------- | ------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Coverage                                  | `ci-contract.mjs:713-795,842-864`       | Config/core/runner/reporter fragments, exact test titles/counts                             | Removed by CI-S03; native coverage plus focused reporter/source-policy tests                                                |
| Documentation                             | `ci-contract.mjs:868-905`               | Checker function names, error strings, test titles                                          | None; `DOC-01` was retired and CI-S05/#74 deletes both mirror and checker                                                   |
| Runtime configuration                     | `ci-contract.mjs:915-1088`              | Nuxt/validator syntax and formatting-sensitive multiline text                               | Removed by CI-S02B; focused config tests plus unique built startup failures remain                                          |
| Module/request boundaries                 | `ci-contract.mjs:1103-1250`             | Module manifest, middleware, request-path and origin helper snippets                        | Removed by CI-S02A2; module-state/origin behavior is primary                                                                |
| Direct app auth/social/passwordless/email | `ci-contract.mjs:1272-1510` at audit    | Implementation fragments, imports, option spellings, and app test titles                    | Removed by CI-S02A1; focused Vitest plus selected built behavior is primary                                                 |
| Runtime/integration auth and workspace    | Later runner/integration ranges         | Scenario names, helper calls, personal-workspace counts, and route strings                  | Removed by CI-S02B; focused behavior and only distinct built journeys remain                                                |
| Sentry/worker/runner                      | `ci-contract.mjs:1544-1913`             | Function/import strings and exact call order                                                | Removed by CI-S02B; executable module, worker, observability, and runtime behavior remains                                  |
| Deployment/integration                    | `ci-contract.mjs:1914-2044`             | Command names, helper names, test titles                                                    | Removed by CI-S02B; actual disposable-state/no-write runners remain                                                         |
| Docker/migration/maintenance              | `ci-contract.mjs:2068-2237`             | Dockerfile/runner/maintenance implementation and test titles                                | Docker/container mirrors removed by #91 and maintenance/migration mirrors by #92; actual Docker and SQLite behavior remains |
| Browser                                   | `ci-contract.mjs:2275-2584`             | Spec assertions, runner/helper/reporter internals, fixed result/scan counts, test titles    | Removed by CI-S02C1/#90; Playwright/Axe journeys plus dynamic reporter/config tests remain                                  |
| Doctor content patterns                   | `scripts/doctor.mjs:299-340,481-488`    | Presence of words such as `Turnstile`, `billing_customers`, and `Stripe webhook signatures` | Owning behavioral tests/issues or explicit de-scoping                                                                       |
| CSS source                                | `scripts/css-baseline-check.mjs:13-61`  | Exact style fragments/regexes                                                               | Stylelint and #27 browser behavior                                                                                          |
| PWA source                                | `scripts/pwa-baseline-check.mjs:44-100` | Service-worker/registration strings                                                         | #34 browser/offline behavior                                                                                                |

Direct source assertions also exist outside `scripts/`:

| File                                                    | Assertion                     | Proposed treatment                                                                                  |
| ------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------- |
| `apps/web/tests/auth-compatibility.test.ts:13-16,30-33` | Exact adapter import spelling | Removed by CI-S02A1; parsed pins and actual configured adapter/provisioning behavior remain primary |
| `apps/web/tests/module-states.test.ts:60-67`            | Module-boundary source tokens | Removed by CI-S02A2 together with unused file/test/dependency inventories; direct behavior remains  |
| `apps/web/tests/baseline.test.ts:57-70`                 | Service-worker source strings | Defer to #34 behavior                                                                               |

`apps/web/tests/data-layer.test.ts:527-540` reads migration SQL and executes it against SQLite. It remains behavioral evidence.

## Prospective and hollow-proof assertions

At the audited commit, the contract included source fragments for behavior not yet implemented, including strings such as `/api/workspaces/workspace_1/members` and `prospective workspace` around `ci-contract.mjs:1227-1250`. Those exact application-boundary examples are not present in the current contract. CI-S02B/#70 removes the later built-runtime and isolated-integration workspace strings after focused behavior and the materially distinct built journeys are identified as their primary owners.

Test-title assertions can remain green if a test body no longer exercises its title. Source fragments can remain green in comments or dead branches. The original audit already required presence checks to become behavioral evidence, and described Doctor/CSS/PWA checks as structural or regex evidence rather than completed behavior.

## Burden evidence

Between the coverage/documentation merge-gate commit and the audited commit:

- 14 of 15 later non-merge commits modified the contract or contract tests;
- 12 of 15 modified coverage/debt files;
- contract follow-up churn was +2,581/-311 lines;
- coverage follow-up churn was +256/-196 lines.

The contract is therefore not merely a stable policy file. It is a routine product-feature co-change surface.

## Removal protocol

For each domain:

1. name the guarantee ID from the [guarantee ledger](./guarantee-ledger.md);
2. identify the primary behavior or structured policy owner;
3. prove the primary evidence passes the current implementation;
4. for retained guarantees, seed a representative failure and prove the primary evidence fails; for explicitly retired guarantees, record the accepted risk instead;
5. remove the literal source/test-title assertion and its mutation fixture;
6. run all unaffected gates;
7. record net LOC/runtime and rollback;
8. create a separate issue for any uncovered non-blocking concern.

Do not replace a removed fragment with another source fragment. If no behavior, maintained validator, or legitimate structured policy protects an approved guarantee, the pull request must stop and request a decision.

## Assertions that should not be deleted wholesale

- Middleware filename/order policy where Nuxt/Nitro ordering is itself the declared mechanism, unless a built behavior proves equivalent ordering.
- Exact workflow Action pins, permissions, events, artifacts, and stable context names.
- Preinstall dependency parsing that runs before application lifecycle scripts.
- Package-count parity across lockfile, OSV output, and registry signatures.
- The browser reporter's dynamic nonempty cross-project logical-test parity and exact discovered-ID/terminal-result integrity, proved through public Playwright project/suite callbacks and focused behavior tests.
