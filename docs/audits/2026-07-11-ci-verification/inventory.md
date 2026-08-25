# Verification inventory and operational baseline

This file preserves the audited-commit baseline. CI-S05/#74 subsequently retired `DOC-01` and deleted both documentation-link files and their call edges without replacement. CI-S03/#72 subsequently reduced coverage scripts/tests from 1,353 to 88 physical lines, deleted the 161-line debt ledger and retained artifact, and removed the repeated full-suite failure runs. CI-S04/#73 subsequently reduced Doctor from 599 to 45 physical lines, removed its duplicate source-graph/toolchain work and the dedicated auth-suite copy, and moved the real AWS import boundary to pinned ESLint rules. CI-S02A1/#88 removes direct application-auth mirrors; CI-S02A2/#89 removes direct module-state/hostile-origin mirrors and dead module file/test inventories; CI-S02B/#70 removes runtime/readiness/worker/deployment/integration mirrors. CI-S02C1/#90 removes browser mirrors while retaining actual Playwright/Axe behavior. CI-S02C2/#91 removes Dockerfile, `.dockerignore`, build/health-driver, local-object-storage, container-test, and test-title mirrors while retaining the actual Docker behavior, adding multi-class build-stage canary inspection, and keeping the executable health probe. CI-S02C3/#92 removes the maintenance implementation and test-title mirrors while retaining actual temporary-SQLite migration/recovery behavior. The historical tables below are not recalculated; current measurements are recorded in the tranche implementation documents, including [CI-S02C1](./implementation-ci-s02c1.md), [CI-S02C2](./implementation-ci-s02c2.md), and [CI-S02C3](./implementation-ci-s02c3.md).

## Method

The inventory was collected from a clean worktree at commit `3f705edac3d66ff5bea1db6098f39342baa8b57d`.

Reachability starts at:

- `.github/workflows/fast-pr.yml`;
- `.github/workflows/full-ci.yml`;
- root and web `package.json` scripts;
- static ESM imports;
- literal subprocess, Docker, and package-command calls;
- documented manual operations commands.

Physical LOC counts every line. Nonblank LOC excludes empty/whitespace-only lines. Generated Drizzle metadata is reported separately and excluded from handwritten comparisons.

Runtime uses the five most recent successful `master` Fast/Full run pairs at audit time. Flake/rerun history uses all 126 available workflow runs between 2026-07-10T01:42:35Z and 2026-07-11T11:04:07Z. This short window is a baseline, not a long-term reliability claim.

## LOC inventory

| Scope                                     | Files | Physical | Nonblank |
| ----------------------------------------- | ----: | -------: | -------: |
| Custom verification implementation        |    28 |   13,306 |   12,093 |
| Custom Node verification tests            |    15 |    4,561 |    4,159 |
| All custom verification code              |    43 |   17,867 |   16,252 |
| Selected CI/control configuration         |    23 |    1,252 |    1,190 |
| Application production TypeScript         |   110 |    6,924 |    6,093 |
| Application Vitest tests                  |    16 |    6,273 |    5,747 |
| Application test support                  |     2 |      329 |      306 |
| Root Playwright specification             |     1 |      386 |      361 |
| Handwritten SQL migrations                |     9 |      453 |      453 |
| Generated Drizzle migration metadata      |    10 |    9,086 |    9,086 |
| Tracked Markdown consumed by docs checker |    29 |    3,469 |    2,526 |

Selected CI/control configuration covers the workflows, manifests, Dockerfile and `.dockerignore`, tool/version/workspace/formatting configurations, Playwright/Vitest/ESLint/Stylelint/TypeScript/Drizzle/Nuxt configurations, coverage debt, supply-chain policy, and committed environment templates. It is a curated set of verification inputs, not every repository configuration file.

## Files at or above 500 physical lines

| File                                     | Physical | Nonblank |
| ---------------------------------------- | -------: | -------: |
| `scripts/ci-contract.mjs`                |    2,906 |    2,737 |
| `scripts/ci-runtime-smoke.mjs`           |    2,503 |    2,351 |
| `scripts/ci-contract.test.mjs`           |    1,152 |    1,084 |
| `scripts/docs-links.mjs`                 |      946 |      837 |
| `scripts/container-maintenance.test.mjs` |      829 |      755 |
| `scripts/api-smoke.mjs`                  |      670 |      578 |
| `scripts/supply-chain-policy.mjs`        |      627 |      560 |
| `scripts/doctor.mjs`                     |      596 |      543 |
| `scripts/supply-chain-scan.mjs`          |      581 |      526 |
| `scripts/ci-coverage-core.mjs`           |      538 |      493 |
| `scripts/ci-container-health.mjs`        |      511 |      465 |

## Complete component families

| Family                             | Components and physical LOC                                                                                                       | Primary caller                                        |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------- |
| Orchestration/contracts/toolchain  | `ci-contract.mjs` 2,906; `doctor.mjs` 596; `toolchain-contract.mjs` 142; `run-pnpm.mjs` 36; `format-changed.mjs` 140; tests 1,289 | Fast and Full verify                                  |
| Coverage                           | core 538; reporter 45; runner 179; tests 587                                                                                      | Full verify                                           |
| Browser                            | helpers 321; runner 365; reporter 71; tests 405                                                                                   | Full browser; tests also Fast/verify                  |
| Built runtime/framework/deployment | runtime 2,503; framework helpers/smoke 408; deployment 303; tests 373                                                             | Full runtime; framework/tests also Fast/verify        |
| Integration/API/isolation          | API 670; isolated runner 401; policy 85; test 140                                                                                 | Full integration; wrapper test also Fast/verify       |
| Container/migration/maintenance    | build 97; health 511; tests 1,068                                                                                                 | Full container; tests also Fast/verify                |
| Supply chain                       | policy 627; scanner 581; preinstall parser 283; tests 419                                                                         | Fast live scan; Fast/verify offline policy            |
| Documentation                      | checker 946; tests 280                                                                                                            | Fast and verify                                       |
| Static CSS/PWA                     | CSS 130; PWA 173                                                                                                                  | Fast and verify                                       |
| Manual operations                  | readiness 85; evidence 164                                                                                                        | Manual package commands; source-inspected by contract |

No script is wholly orphaned under static import/package/workflow analysis. `production-readiness.ts` and `production-evidence-check.mjs` are deliberately manual-only; CI inspects their source but does not execute them end to end. Several aliases are workflow-unreachable but remain documented user entrypoints.

## Per-component ledger

Runtime entries use the isolated/local or GitHub family measurement available at audit time; “not isolated” means no defensible individual timing was available. Proposal IDs are audit proposals, not authorization.

### Orchestration, contracts, and toolchain

| Component                             | Kind; physical/nonblank LOC | Callers/runtime                                                                  | Guarantee IDs and overlap/burden                                                                  | Classification/owner                                               |
| ------------------------------------- | --------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------ |
| `scripts/ci-contract.mjs`             | impl; 2,906/2,737           | Doctor + contract tests in Fast/Full; about 52 source-graph evaluations per gate | WF/CV/DOC/RT/AUTH/WS/MOD/ORG/BR/INT/DEP/DB/CT/FW; duplicates primary behavior with 913+ fragments | DB mirrors removed by #92; structured policy remains               |
| `scripts/doctor.mjs`                  | impl; 596/543               | Fast/Full; warm local 0.26s                                                      | TC/FMT/repository shape; repeats toolchain/contract and freezes inventories/content               | Simplify: CI-S04                                                   |
| `scripts/toolchain-contract.mjs`      | impl; 142/111               | bootstrap, Doctor, runner, tests; warm family under 0.2s                         | TC-01; parsed values are legitimate, Docker command strings overlap                               | Keep/simplify in CI-S04                                            |
| `scripts/run-pnpm.mjs`                | impl; 36/30                 | bootstrap, pinned commands, signatures; not isolated                             | TC-01/SC-03B; unique portable exact-pnpm bootstrap                                                | Keep                                                               |
| `scripts/format-changed.mjs`          | impl; 140/113               | Fast; warm local 0.31s with no changed files                                     | FMT-01; Git range/path safety and pinned formatter                                                | Keep                                                               |
| `scripts/ci-contract.test.mjs`        | test; 1,152/1,084           | `check:ci`; 31 cases, 230 text mutations                                         | Same broad families as contract; most fixtures mutate implementation text                         | DB source mutations removed by #92; structured-policy tests remain |
| `scripts/toolchain-contract.test.mjs` | test; 52/45                 | Fast/Full; warm local 0.19s including Node test startup                          | TC-01; meaningful value/failure fixtures                                                          | Keep                                                               |
| `scripts/format-changed.test.mjs`     | test; 85/70                 | `check:ci`; warm local 0.33s                                                     | FMT-01; focused range/path failure evidence                                                       | Keep                                                               |

### Coverage

| Component                           | Kind; physical/nonblank LOC | Callers/runtime                                      | Guarantee IDs and overlap/burden                                                         | Classification/owner                                                   |
| ----------------------------------- | --------------------------- | ---------------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- |
| `scripts/ci-coverage-core.mjs`      | impl; 538/493               | coverage runner/tests; not isolated                  | CV-01/CV-02; duplicates native thresholds, adds debt/inventory/report schema             | Simplify: CI-S03                                                       |
| `scripts/ci-coverage-reporter.mjs`  | impl; 45/41                 | Vitest coverage config/tests; not isolated           | CV-02; primary skipped/todo/expected-failure/non-passed/missing terminal-result behavior | Keep in CI-S03 unless an official equivalent proves every failure mode |
| `scripts/ci-coverage.mjs`           | impl; 179/166               | Full verify; final GitHub coverage suite about 20.3s | CV-01/CV-02; wrapper around native coverage plus normalization                           | Simplify: CI-S03                                                       |
| `scripts/ci-coverage.test.mjs`      | test; 456/418               | `check:ci`; warm local 0.09s                         | CV-01/CV-02; parser/debt/report failure fixtures, much bookkeeping                       | Simplify/delete with CI-S03                                            |
| `scripts/ci-coverage-live.test.mjs` | test; 131/118               | Full verify; GitHub failure fixtures about 44.7s     | CV-01/CV-02; repeatedly executes complete app suite                                      | Replace with focused distinct failures in CI-S03                       |

### Browser

| Component                                         | Kind; physical/nonblank LOC | Callers/runtime                             | Guarantee IDs and overlap/burden                                 | Classification/owner                                                 |
| ------------------------------------------------- | --------------------------- | ------------------------------------------- | ---------------------------------------------------------------- | -------------------------------------------------------------------- |
| `scripts/ci-browser-helpers.mjs`                  | impl; 321/276               | browser, runtime, integration; not isolated | BR/RT/INT; shared ports/process/output/cleanup plumbing          | Retained by #90; orchestration research remains #77/#75              |
| `scripts/ci-browser-smoke.mjs`                    | impl; 365/340               | Full browser; median command 51s            | BR-01A-D/BR-02; app setup plus generic process lifecycle         | Retained by #90 except removal of fixed-count success text           |
| `scripts/playwright-foundation-reporter.mjs`      | impl; 71/64                 | Playwright browser                          | BR-01C/BR-02; unique missing/skipped/incomplete-result guarantee | #90 makes project/discovery/result parity dynamic; behavior retained |
| `scripts/ci-browser-helpers.test.mjs`             | test; 317/287               | `check:ci`; warm local 0.84s                | BR/RT/INT process failure modes; some browser lifecycle overlap  | Retained by #90; simplify only after approved orchestration work     |
| `scripts/playwright-foundation-reporter.test.mjs` | test; 88/78                 | `check:ci`; warm local 0.07s                | BR-01C/BR-02; primary fail-closed completion fixtures            | #90 expands dynamic completion and actual-config behavior cases      |

### Built runtime, framework, and deployment

| Component                                     | Kind; physical/nonblank LOC | Callers/runtime                                     | Guarantee IDs and overlap/burden                                                              | Classification/owner                             |
| --------------------------------------------- | --------------------------- | --------------------------------------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------------ |
| `scripts/ci-runtime-smoke.mjs`                | impl; 2,503/2,351           | Full runtime; median command 81s                    | RT-01A-C/RT-02A-C plus selected AUTH/DEP; unique Nitro behavior mixed with ordinary scenarios | Keep; source mirrors CI-S02B; design only CI-R08 |
| `scripts/framework-security-helpers.mjs`      | impl; 98/83                 | framework smoke/tests; not isolated                 | FW-01; disposable fixture support                                                             | Keep                                             |
| `scripts/framework-security-smoke.mjs`        | impl; 310/282               | Fast/Full; framework command family about 3.5s warm | FW-01; pinned real framework behavior                                                         | Keep; remove meta mirror in CI-S02B              |
| `scripts/deployment-smoke.mjs`                | impl; 303/263               | built runtime and manual `ops:smoke`; not isolated  | DEP-01; read-only transport behavior                                                          | Keep; remove meta mirror in CI-S02B              |
| `scripts/framework-security-helpers.test.mjs` | test; 74/65                 | Fast/Full framework command; not isolated           | FW-01; focused helper failures                                                                | Keep                                             |
| `scripts/deployment-smoke.test.mjs`           | test; 299/270               | `check:ci`; warm local 0.12s                        | DEP-01; transport and read-only failures plus some implementation coupling                    | Keep behavior; trim source coupling in CI-S02B   |

### Integration, API, and isolation

| Component                             | Kind; physical/nonblank LOC | Callers/runtime                      | Guarantee IDs and overlap/burden                      | Classification/owner                             |
| ------------------------------------- | --------------------------- | ------------------------------------ | ----------------------------------------------------- | ------------------------------------------------ |
| `scripts/api-smoke.mjs`               | impl/library; 670/578       | isolated integration; not isolated   | INT-01A-C; application/provider assertions            | Keep behavior; remove contract mirror in CI-S02B |
| `scripts/isolated-api-smoke.mjs`      | impl; 401/368               | Full integration; median command 35s | INT-01A-C; build/migrate/server/fixture orchestration | Keep behavior; remove contract mirror in CI-S02B |
| `scripts/isolated-smoke-policy.mjs`   | impl; 85/76                 | runtime/integration observers        | INT-01A/C and DEP-01; loopback/no-write policy        | Keep                                             |
| `scripts/isolated-api-smoke.test.mjs` | test; 140/125               | `check:ci`; warm local 0.18s         | INT-01A/C; disposal, no-write, redaction failures     | Keep                                             |

### Container, migration, and maintenance

| Component                                | Kind; physical/nonblank LOC | Callers/runtime                         | Guarantee IDs and overlap/burden                     | Classification/owner                                                                                  |
| ---------------------------------------- | --------------------------- | --------------------------------------- | ---------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| `scripts/ci-container-build.mjs`         | impl; 97/84                 | Full container; median image phase 82s  | CT-01; actual Docker context/image evidence          | Keep                                                                                                  |
| `scripts/ci-container-health.mjs`        | impl; 511/465               | Full container; median health phase 22s | CT-02/DB-01D; actual persistence/health behavior     | Keep; no generic rewrite                                                                              |
| `scripts/ci-container-build.test.mjs`    | test; 108/99                | `check:ci`; warm local 0.17s            | CT-01; declarative ignore plus source-string overlap | #91 keeps only CLI/pre-existing-path behavior; actual Docker canaries own effective context exclusion |
| `scripts/ci-container-health.test.mjs`   | test; 131/117               | `check:ci`; warm local 0.27s            | CT-02; executable probe plus driver-source mirror    | #91 keeps the executable probe and CLI behavior; removes driver mirrors                               |
| `scripts/container-maintenance.test.mjs` | behavioral test; 829/755    | `check:ci`; warm local 18.7s            | DB-01A-D; real SQLite/process recovery evidence      | Keep; source and title mirrors removed by #92                                                         |

### Supply chain

| Component                              | Kind; physical/nonblank LOC | Callers/runtime                            | Guarantee IDs and overlap/burden                                     | Classification/owner                      |
| -------------------------------------- | --------------------------- | ------------------------------------------ | -------------------------------------------------------------------- | ----------------------------------------- |
| `scripts/supply-chain-policy.mjs`      | impl; 627/560               | Fast/Full offline policy; warm family 1.3s | SC-01/SC-02/SC-03B/C; parsed lock/exceptions/reports                 | Keep; research-only simplification CI-R07 |
| `scripts/supply-chain-scan.mjs`        | impl; 581/526               | Fast preinstall/signatures; network-bound  | SC-02/SC-03A-C; verified downloads, scanners, canary, artifacts      | Keep; research-only simplification CI-R07 |
| `scripts/pnpm-lock-preinstall.mjs`     | impl; 283/246               | scanner/policy before dependency install   | SC-01; dependency-free trust boundary, partly repeated after install | Keep unless preinstall parity is proven   |
| `scripts/supply-chain-policy.test.mjs` | test; 419/384               | Fast/Full; included in 1.3s warm family    | SC-01/SC-02/SC-03B/C; meaningful fail-closed fixtures                | Keep; research-only consolidation CI-R07  |

### Documentation, CSS/PWA, and manual operations

| Component                               | Kind; physical/nonblank LOC | Callers/runtime                                         | Guarantee IDs and overlap/burden                         | Classification/owner                       |
| --------------------------------------- | --------------------------- | ------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------ |
| `scripts/docs-links.mjs`                | impl; 946/837               | Fast/Full; warm local 0.28s                             | DOC-01; custom parser for non-live docs and edge schemes | Deleted without replacement by CI-S05/#74  |
| `scripts/docs-links.test.mjs`           | test; 280/244               | `check:ci`; warm local 0.71s                            | DOC-01; parser/traversal/anchor fixtures                 | Deleted without replacement by CI-S05/#74  |
| `scripts/css-baseline-check.mjs`        | impl; 130/102               | Fast/Full; warm local 0.12s                             | CSS-01; regex presence/absence only                      | Defer replacement to #27                   |
| `scripts/pwa-baseline-check.mjs`        | impl; 173/140               | Fast/Full; warm local 0.12s                             | PWA-01; manifest plus source regexes                     | Defer replacement to #34                   |
| `scripts/production-readiness.ts`       | manual impl; 85/76          | `ops:readiness`; not isolated; CI source-inspected only | OPS-01; manual environment readiness                     | Keep manual; staging milestone owns review |
| `scripts/production-evidence-check.mjs` | manual impl; 164/142        | `ops:evidence`; not isolated; CI source-inspected only  | OPS-01; evidence-form completeness/secret heuristics     | Keep manual; staging milestone owns review |

## Call graph

```text
fast-pr.yml
├─ supply-chain-scan preinstall
│  └─ supply-chain-policy → pnpm-lock-preinstall
├─ supply-chain-scan signatures
│  └─ run-pnpm → toolchain-contract → pnpm audit signatures
├─ bootstrap
│  └─ run-pnpm → toolchain-contract → pnpm install
└─ ci:fast
   ├─ format-changed
   ├─ doctor → toolchain-contract + ci-contract
   ├─ toolchain-contract.test
   ├─ check:ci (115 Node test cases)
   ├─ supply-chain-policy tests + live offline policy
   ├─ framework helper tests + framework smoke
   ├─ focused auth Vitest
   ├─ docs, ESLint, Stylelint, CSS, PWA
   ├─ real temporary migration check
   ├─ Nuxt typecheck
   └─ complete ordinary Vitest suite

full-ci.yml
├─ verify
│  └─ verify:pinned → check → most Fast checks again
│     ├─ coverage failure fixtures
│     ├─ final coverage suite
│     └─ production build
├─ runtime
│  └─ ci-runtime-smoke → build + migrate + workers/server + deployment-smoke
├─ browser
│  └─ ci-browser-smoke → build + migrate + server + Playwright/reporter/Axe
├─ container
│  ├─ Docker build → in-image install + production build
│  └─ health → migrate/backup/verify/restore/persistence/readiness/liveness
├─ integration
│  └─ isolated-api-smoke → build + migrate + server + api-smoke
└─ aggregate result gate
```

Static import edges:

```text
doctor → ci-contract, toolchain-contract
run-pnpm → toolchain-contract
ci-contract.test → ci-contract
ci-browser-helpers.test → ci-browser-helpers
ci-coverage → ci-browser-helpers, ci-coverage-core
ci-coverage.test → ci-coverage-core, ci-coverage-reporter
ci-runtime-smoke → ci-browser-helpers, isolated-smoke-policy
ci-browser-smoke → ci-browser-helpers
deployment-smoke.test → deployment-smoke
docs-links.test → docs-links
format-changed.test → format-changed
framework-security-helpers.test → framework-security-helpers
isolated-api-smoke → api-smoke, ci-browser-helpers, isolated-smoke-policy
isolated-api-smoke.test → api-smoke, isolated-smoke-policy
framework-security-smoke → framework-security-helpers
playwright-foundation-reporter.test → playwright-foundation-reporter
supply-chain-scan → supply-chain-policy → pnpm-lock-preinstall
supply-chain-policy.test → policy, scanner, pnpm-lock parser
toolchain-contract.test → toolchain-contract
```

Important subprocess edges include production build/migration/server processes, Playwright, Docker, downloaded OSV/Gitleaks binaries, pnpm signature audit, Git, SQLite, and the maintenance runner.

## Duplicate execution

### Per ready pull request

Fast and Full run concurrently. The same workflows run again after merge on the `master` push.

Fast and Full verify both execute Doctor, toolchain tests, 115 `check:ci` Node cases, supply-chain policy, framework security, focused auth compatibility, documentation, lint/style checks, CSS/PWA, migration check, typecheck, and application tests.

The ready-PR Fast + Full pair performs:

- six dependency installations: Fast, four non-container Full jobs, and one inside Docker;
- five production builds: verify, runtime, browser, integration, and container;
- four complete application-suite executions across Fast and Full verify;
- six executions of `auth-compatibility.test.ts` because it is focused separately and included in every full suite;
- two executions of the expensive migration/maintenance Node test file before separate container-health behavior.

### Contract/meta-validation

`ci-contract.test.mjs` contains 31 cases and approximately 51 expanded contract evaluations. One contract load reads about 70 actual files. Doctor loads the same contract once before those tests. This is approximately 52 whole-source-graph evaluations per Fast or Full verify gate.

The contract often proves that a behavioral test title, implementation token, or command string exists immediately before the underlying test or command executes.

### Coverage

Full verify runs the complete 16-file/152-test Vitest suite three times:

1. a tightened-threshold failure fixture;
2. a custom-reporter failure fixture;
3. the final successful coverage run.

A SIGTERM fixture starts and interrupts another coverage process. Fast separately runs the ordinary application suite.

## Runtime baseline

Five recent successful `master` run pairs:

| Job or step                   | Median |    p95 |    Range |
| ----------------------------- | -----: | -----: | -------: |
| Fast job                      |   130s | 139.2s | 113–141s |
| Fast deterministic command    |    85s |  94.6s |   69–96s |
| Full verify job               |   171s | 192.2s | 144–195s |
| Full verify command           |   146s | 164.8s | 120–167s |
| Built-runtime job             |   103s |   109s |  93–110s |
| Built-runtime command         |    81s |  83.6s |   73–84s |
| Browser job                   |   104s |   117s |  91–120s |
| Browser command               |    51s |    65s |   42–68s |
| Container job                 |   111s |   111s | 101–111s |
| Container image build/inspect |    82s |    82s |   74–82s |
| Container health phase        |    22s |    22s |      22s |
| Integration job               |    59s |  60.8s |   54–61s |
| Integration command           |    35s |    36s |   30–36s |
| Aggregate gate                |     3s |     4s |     2–4s |

Median Fast + Full runner use is 661 seconds; p95 is 711.6 seconds. Median Full workflow wall time is 184 seconds; p95 is 202.4 seconds.

At the audited commit, Full verify logs show approximately:

| Component                 |  Time |
| ------------------------- | ----: |
| `check:ci`                | 36.7s |
| Coverage failure fixtures | 44.7s |
| Final coverage suite      | 20.3s |
| Final production build    | 24.5s |

Warm local Node 24 measurements isolated the main `check:ci` cost:

| Test file                                |  Wall time |
| ---------------------------------------- | ---------: |
| `container-maintenance.test.mjs`         |      18.7s |
| Other ten `check:ci` test files combined | about 3.2s |

The maintenance file is slow because it exercises real process/SQLite behavior. Its runtime is not evidence that it should be replaced with source inspection.

## Change burden

After coverage/documentation gates were introduced at `d1f98338d3b0aeefe89a9ed5ba84f5f769c2d2ab`, there were 15 later non-merge commits through the audited commit:

- 14 modified `ci-contract.mjs` or `ci-contract.test.mjs`;
- 12 modified coverage implementation/configuration/debt files;
- contract follow-up churn was 2,581 added and 311 deleted lines;
- coverage follow-up churn was 256 added and 196 deleted lines.

The result is a high probability that an ordinary feature PR must mechanically maintain CI inventory or source-contract data even when its behavioral evidence is already complete.

## Workflow history and flake evidence

Available history contains 126 workflow runs:

| Workflow/event      | Success | Failure | Cancelled |
| ------------------- | ------: | ------: | --------: |
| Fast / pull request |      37 |       1 |         3 |
| Fast / push         |      17 |       1 |         4 |
| Full / pull request |      36 |       0 |         5 |
| Full / push         |      17 |       0 |         5 |

No run had `run_attempt > 1`. The two failures were deterministic: one formatting failure and one Gitleaks finding. Cancelled runs were not classified as flakes. This small history provides no observed rerun-based flake, but it is insufficient to estimate a durable p95 flake rate.

## Permissions, network, state, and artifacts

| Boundary               | Network/privilege                                                         | State/artifact behavior                                                                                         |
| ---------------------- | ------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Both workflows         | Top-level `contents: read`; pinned Actions; checkout credentials disabled | Default workflow permissions are read-only                                                                      |
| Fast live supply chain | GitHub releases, OSV/deps.dev, registry keys/metadata, full Git history   | One archive retained 30 days: raw OSV JSON plus sanitized signature and summary JSON; no Gitleaks report/canary |
| Bootstrap jobs         | Package registry; cache disabled                                          | Fresh dependency install in each job                                                                            |
| Verify                 | Registry during install                                                   | Sanitized coverage summary retained 30 days                                                                     |
| Browser                | Registry plus Microsoft browser and runner package repositories           | Screenshots/traces are deleted with temporary output and not uploaded                                           |
| Runtime/integration    | Registry during install; otherwise loopback/local fixtures                | Temporary DB/provider/build/capture state; no retained artifact                                                 |
| Container              | Docker daemon, Debian repositories, registry                              | Ephemeral image, container, and named volume; container/volume cleaned                                          |
| Documentation          | Git/filesystem only                                                       | External URLs are parsed, not fetched                                                                           |
| Migration/maintenance  | Real SQLite/process locks                                                 | Temporary migration, backup, restore, retry, and persistence behavior                                           |

Repository external state at audit time:

- private repository; default branch `master`;
- Actions enabled; all Actions allowed; platform SHA-pinning requirement disabled;
- default workflow token permission `read`; workflow approval capability disabled;
- no repository Actions secrets, variables, or environments;
- no active Actions caches;
- default artifact/log retention 90 days, but workflow artifacts explicitly retain 30 days;
- 90 current artifacts, primarily coverage and supply-chain summaries;
- Dependabot alerts disabled;
- secret scanning disabled;
- code scanning unavailable without Advanced Security;
- branch-protection and ruleset APIs return `403` under the current private-repository plan.

The last item means workflow checks are evidence but are not externally proven merge requirements. #1 remains the owner of repository protection and is intentionally deferred.

## Evidence collection

The immutable values used by this ledger and selected collection commands are recorded in the [evidence snapshot](./evidence-snapshot.md). External repository and candidate-adoption state will drift after the audit date.

## Uncertainty

- Runtime percentiles use five recent successful run pairs; four precede the audited commit.
- Reachability is static and may miss dynamically constructed execution.
- Network/data behavior is derived from source and workflow documentation, not syscall tracing.
- The configuration LOC set is intentionally curated.
- Cancelled run causes were not exhaustively classified.
- Branch/ruleset API denial is recorded as unavailable evidence, not proof that no other administrative control exists.
