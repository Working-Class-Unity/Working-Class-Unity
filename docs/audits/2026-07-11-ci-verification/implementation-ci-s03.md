# CI-S03 native coverage implementation

## Outcome

CI-S03/#72 replaces the repository's custom coverage runner, debt ledger, normalized artifact, exact inventories, and repeated whole-suite mutation runs with pinned Vitest/V8 behavior. The retained custom coverage script/test surface is 88 physical lines:

| Component                      | Physical lines |
| ------------------------------ | -------------: |
| Strict terminal-state reporter |             26 |
| Source/ignore/symlink policy   |             23 |
| Focused tests for both         |             39 |

Coverage scripts/tests fall from 1,353 to 88 physical lines (-1,265; 93.5%). Eight structured entrypoint-policy/test lines keep all new/replacement coverage-specific custom logic at 96 lines. Deleting `coverage-debt.json` removes another 161 lines. Coverage-specific removals from the broad CI contract contribute to a total custom-verification reduction from 16,656/15,190 to 15,149/13,807 physical/nonblank lines (-1,507/-1,383).

## Official basis

- Pinned Vitest `4.1.6` documents explicit inclusion and negative maximum-uncovered thresholds in its [coverage configuration](https://github.com/vitest-dev/vitest/blob/v4.1.6/docs/config/coverage.md).
- The pinned [V8 provider source](https://github.com/vitest-dev/vitest/blob/v4.1.6/packages/coverage-v8/src/provider.ts) includes matching untested files when the complete suite runs.
- Vitest documents [`allowOnly: false`](https://github.com/vitest-dev/vitest/blob/v4.1.6/docs/config/allowonly.md), [`passWithNoTests: false`](https://github.com/vitest-dev/vitest/blob/v4.1.6/docs/config/passwithnotests.md), and the [reporter lifecycle](https://github.com/vitest-dev/vitest/blob/v4.1.6/docs/api/advanced/reporters.md).
- The pinned converter's [ignore-hint source](https://github.com/AriPerkkio/ast-v8-to-istanbul/blob/v1.0.4/src/ignore-hints.ts) shows comment-token parsing for `if`/`else`/`next`/`file`, but raw line matching for `start`/`stop`; the latter can activate inside directive-shaped strings.

## Preserved guarantees and primary evidence

| Guarantee                                                                                   | Primary evidence                                         | Distinct failure proved                                                         |
| ------------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------------------------- |
| Production TypeScript under `app`, `server`, and `shared` contributes even when unimported  | Native Vitest `coverage.include` on an unfiltered run    | A temporary unimported source file appears in totals and exceeds three ceilings |
| Aggregate uncovered debt cannot grow past 479/264/122/454                                   | Native negative thresholds with `autoUpdate: false`      | A temporary -478 statement ceiling rejects the current 479 uncovered statements |
| Skipped/todo/expected-failure/missing/non-passing tests cannot make required coverage green | Strict reporter plus focused test                        | A temporary skipped Vitest case makes the real coverage command exit nonzero    |
| Recognized coverage-ignore hints cannot bypass measurement                                  | Narrow raw-source policy matching pinned converter terms | Tab-separated comment and raw-string directives are rejected                    |
| Production source cannot escape the reviewed roots through a symlink                        | Same source policy plus focused filesystem test          | A symlink inside a temporary production root is rejected                        |
| Coverage remains direct in Full and out of Fast; Vitest/provider versions agree exactly     | Structured manifest command/reachability/dependency data | A no-op entrypoint mutation fails the existing contract test                    |

The ordinary passing run retains the exact measured baseline: 1302/1781 statements, 736/1000 branches, 334/456 functions, and 1236/1690 lines. It completed locally on Node 24 in 12.59 seconds. The recent pre-change Full workflow spent about 63.48 seconds in failure/mutation runs before its roughly 29.5-second passing coverage run; merged GitHub timing will be recorded in the PR.

## Explicit retirements

- exact source-file, test-file, and passed-result counts;
- per-file debt/classification tuples and the debt JSON;
- normalized JSON coverage output and 30-day artifact;
- raw-report sanitation and cleanup;
- the custom 120-second coverage wrapper deadline;
- coverage-runner signal/process-tree cleanup;
- coverage-runner environment allowlisting; the GitHub coverage job has no application/provider secrets configured;
- two repeated complete-suite mutations and the interrupted partial run;
- source/config/test-title assertions that mirrored these mechanisms.

Aggregate headroom can now offset a per-file regression. That accepted limitation avoids recreating the debt ledger; application behavioral and security tests remain primary.

## Rollback

Reverting the CI-S03 merge restores the former runner, debt ledger, workflow artifact, and mirrors. No application code, database state, provider configuration, dependency, or lockfile changes, so rollback has no data migration.
