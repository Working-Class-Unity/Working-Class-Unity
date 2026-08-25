# CI-S02C1 browser mirror removal

## Outcome

CI-S02C1/#90 removes the broad CI contract's raw browser-source loader and literal assertions for the Playwright configuration, specification, helpers, runner, completion reporter, and their tests. Matching source mutations and test-title assertions are deleted rather than rewritten elsewhere.

The actual production-built Playwright/Axe journeys remain. The browser workflow still installs the Chromium binary selected by the exact root Playwright dependency and invokes the existing browser runner. The reporter remains app-owned because Playwright's supported reporter API provides the necessary events but does not itself impose this repository's stricter completion policy.

The former fixed six-result contract is replaced with dynamic evidence. Every configured project must discover the same nonempty logical test set. The run must then produce exactly one known terminal result for every unique discovered ID, finish every test as `passed` with expected status `passed` and outcome `expected`, and finish the full run as `passed`. A focused Node test imports and evaluates the actual exported Playwright configuration to require the custom reporter, `forbidOnly`, and Chromium projects at `1280×900` and `390×844`. This is structured behavior over Playwright's public project/suite data and the loaded configuration object, not source-text inspection.

No workflow, dependency, lockfile, product behavior, browser journey, helper implementation, process orchestration, schema, migration, container, or provider configuration changes in this tranche. Container and maintenance/migration source mirrors remain assigned to #91 and #92.

## Baseline and working-tree reduction

The base is `master` commit `949ddf419b95754df657cf10fd47d08f46ea61e1`.

| Surface                                           | Base physical/nonblank | Current physical/nonblank |      Change |
| ------------------------------------------------- | ---------------------: | ------------------------: | ----------: |
| CI contract                                       |          1,184 / 1,094 |                 805 / 734 | -379 / -360 |
| CI contract tests                                 |              530 / 478 |                 322 / 284 | -208 / -194 |
| CI contract plus tests                            |          1,714 / 1,572 |             1,127 / 1,018 | -587 / -554 |
| Playwright completion reporter                    |                71 / 64 |                 160 / 138 |   +89 / +74 |
| Reporter/config behavior tests                    |                88 / 78 |                 239 / 213 | +151 / +135 |
| Browser runner                                    |              365 / 340 |                 365 / 340 |       0 / 0 |
| Net touched verification code                     |          2,238 / 2,054 |             1,891 / 1,709 | -347 / -345 |
| All custom verification scripts/tests             |        12,786 / 11,544 |           12,439 / 11,199 | -347 / -345 |
| Raw `readFileSync(` calls in the contract         |                     23 |                        15 |          -8 |
| Textual `.replace(`/`.replaceAll(` test mutations |                     60 |                        15 |         -45 |

These are the final local code figures unless pull-request review changes the implementation.

## Official basis

- The pinned Playwright `1.61.1` [reporter types](https://github.com/microsoft/playwright/blob/v1.61.1/packages/playwright/types/testReporter.d.ts) and official [Reporter API](https://playwright.dev/docs/api/class-reporter) define `onBegin` over the resolved projects and discovered root suite, `Suite.project()` and each test's location/title hierarchy, `onTestEnd` over the completed result, and `onEnd` status override. Those public callbacks and values are the basis for the dynamic completion policy.
- Playwright `1.61.1` documents [projects](https://github.com/microsoft/playwright/blob/v1.61.1/docs/src/test-projects-js.md) as logical groups with distinct configuration. The focused test imports and evaluates the repository's actual exported configuration and requires the two approved Chromium viewport families without freezing the complete project inventory in source text.
- The published `@axe-core/playwright` `4.12.1` package identifies source commit `5f587f3a6a8aebfd1ca1bfdde5d93d6b4e1abe8f`. Its pinned [AxeBuilder documentation](https://github.com/dequelabs/axe-core-npm/blob/5f587f3a6a8aebfd1ca1bfdde5d93d6b4e1abe8f/packages/playwright/README.md) distinguishes the unmodified `analyze()` call from opt-in `include`, `exclude`, `options`, `withRules`, `withTags`, and `disableRules` configuration. The matching pinned [implementation](https://github.com/dequelabs/axe-core-npm/blob/5f587f3a6a8aebfd1ca1bfdde5d93d6b4e1abe8f/packages/playwright/src/index.ts) initializes includes, excludes, and options empty and changes them only through those modifiers. The repository calls `new AxeBuilder({ page }).analyze()` without them and asserts that returned violations are empty.
- Automated Axe results cover only the rendered states and rules the pinned engine can evaluate. This tranche therefore does not describe them as complete WCAG, manual, hidden-state, keyboard-order, or assistive-technology certification.

## Primary behavior by guarantee

| Guarantee/failure mode         | Primary behavioral owner                                                                                                    | Distinct failure caught                                                                                            |
| ------------------------------ | --------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `BR-01A` viewport/navigation   | Evaluated Playwright config plus the production-built foundation journey in required desktop/mobile Chromium projects       | A required viewport disappears, a route/title/redirect is wrong, or a rendered state overflows                     |
| `BR-01B` accessibility/focus   | Playwright focus/Enter/naming assertions plus every unscoped/default Axe analysis                                           | Focus/activation/naming fails or Axe returns a rendered-state violation                                            |
| `BR-01C` browser errors        | Playwright console, page-error, crash, failed-request, HTTP-error, external-request, hydration, and clean-page observations | An unexpected browser/runtime error occurs even though route assertions otherwise pass                             |
| `BR-01D` auth/invitation       | Existing production-built passwordless, Google route-double, and invitation journeys                                        | A return path, no-GET-mutation boundary, private response, explicit action, or authenticated handoff regresses     |
| `BR-02` result integrity       | Dynamic cross-project completion reporter plus focused reporter/config behavior tests                                       | A project is empty/partially filtered or terminal evidence is missing, duplicated, foreign, skipped, or nonpassing |
| Browser workflow/binary wiring | Parsed workflow/package policy retained in the CI contract and the actual hosted browser worker                             | The required Playwright package pin, Chromium installation order/path, browser command, or worker result is lost   |

The Playwright journey is the only primary owner for behavior materially involving a real production-built browser. The reporter is only the primary owner for completion integrity; it does not prove navigation, accessibility, authentication, or invitation behavior by itself.

## Deletion manifest

- the contract's raw reads of the browser runner, Playwright config, reporter, reporter tests, shared helpers, helper tests, and discovered browser specification text;
- literal assertions for browser spec placement, exact test and Axe counts, route/helper expressions, source fragments, assertion spellings, timeout spellings, process orchestration calls, reporter internals, reporter test titles, and fixed success output;
- matching `.replace()`/`.replaceAll()` mutation fixtures and expected contract-error strings;
- dead contract helpers used only to collect browser spec text or count/escape source patterns;
- the browser runner's fixed `6`-result/`12`-scan success sentence.

The following remain:

- exact Playwright/Axe package pins and the `test:browser:ci` package entrypoint;
- workflow Chromium installation order, temporary browser path, browser command, timeout, and aggregate result wiring;
- the actual Playwright configuration and production-built journey;
- the shared browser/process helpers and their focused behavior tests;
- dynamic completion reporter behavior and direct failure tests;
- actual evaluation of reporter wiring, `forbidOnly`, and required Chromium viewports.

No removed assertion is replaced with another assertion over source text, function names, imports, test titles, or exact inventory counts.

## Dynamic reporter decision table

| Discovered/result state                                                                                         | Outcome |
| --------------------------------------------------------------------------------------------------------------- | ------: |
| Nonempty unique discovered IDs; one matching `passed/expected/passed` result per ID; full run `passed`          |    Pass |
| A configured project has no tests or projects discover different logical test sets                              |    Fail |
| Zero discovered tests                                                                                           |    Fail |
| Duplicate discovered IDs                                                                                        |    Fail |
| Missing or duplicate terminal result for a discovered ID                                                        |    Fail |
| Unknown result ID, including a same-cardinality substitution for a missing discovered ID                        |    Fail |
| Skipped/fixme, expected failure, unexpected outcome, flaky outcome, interrupted/timed-out/failed terminal state |    Fail |
| Non-passed full-run status                                                                                      |    Fail |
| Reporter discovery/result callback throws                                                                       |    Fail |

The policy intentionally rejects flaky recovery and retries because each discovered ID must have exactly one expected passing terminal result. It guarantees nonempty logical journey parity across configured projects and completion for what Playwright discovers; it does not create a fixed inventory of which product journeys must exist.

## Runtime, faults, gates, and review

Equal-environment local measurements completed on Node 24:

| Measurement                                                |   Base |   Head |
| ---------------------------------------------------------- | -----: | -----: |
| Focused contract plus reporter/config behavior selection   |  1.03s |  0.70s |
| Production-built Playwright/Axe browser command wall clock | 50.39s | 43.58s |

Representative faults were applied one at a time and restored:

- changing the Auth navigation target failed the real production-built browser journey;
- adding an unnamed button failed the real Axe analysis with the `button-name` violation;
- emitting `console.error` failed the real browser error collector;
- omitting a discovered terminal result and substituting a foreign result ID both failed the focused dynamic reporter tests;
- changing the required mobile viewport from `390` to `391` failed the focused test that imports and evaluates the actual Playwright configuration.
- filtering every mobile-project test left three passing desktop cases but the real browser command still failed because the mobile project was empty and its logical set differed.

These faults demonstrate that the retained owners catch navigation, accessibility, unexpected browser errors, cross-project discovery/result-set integrity, and required viewport configuration without source-text mirrors. After the final parity fixtures, `ci:fast` passed in 63.48 seconds and `verify:pinned` passed in 130.06 seconds. Three independent final reviews are clean. Hosted checks and post-merge `master` evidence remain pending and must be recorded before #90 is described as complete or merged.

| Required evidence                                       | Current status                               |
| ------------------------------------------------------- | -------------------------------------------- |
| Focused reporter and evaluated-config behavior tests    | Passed; base/head selection measured above   |
| Production-built Playwright/Axe browser command         | Passed at head in 43.58s                     |
| Representative retained-guarantee failure fixtures      | Passed: all restored faults failed as stated |
| `ci:fast` and `verify:pinned`                           | Passed in 63.48s and 130.06s                 |
| Risk-proportionate independent review                   | Three independent final reviews clean        |
| Hosted pull-request head and post-merge `master` checks | Pending                                      |

## Rollback and residual risk

Reverting the CI-S02C1 merge restores the literal browser mirrors, mutation fixtures, and fixed-count reporter. It requires no database, provider, dependency, browser-download, generated-artifact, or product rollback.

- A browser test file, journey, or Axe invocation can now be removed without a generic source-contract failure. That is intentional: exact inventory bookkeeping is retired. Review and the owning behavioral acceptance criteria must identify a genuinely missing product journey.
- The structured config test requires the two approved Chromium viewport entries but does not require that they are the only projects. The dynamic reporter requires every configured project to participate with the same logical test set and covers every resulting unique test ID.
- Unscoped/default Axe analysis covers only rendered states reached by the current journeys and only violations Axe can determine automatically. Manual accessibility, hidden/inactive states, complete keyboard order/traps, assistive technology, and non-Chromium behavior remain outside this gate.
- The retained reporter is app-owned policy built on Playwright's public API. A future Playwright pin change must rerun its focused failure matrix and the real browser command.
- Browser launch/wait/shutdown orchestration is unchanged. The approved #77 research and any later separately approved #75 implementation own possible `webServer` simplification; #90 does not pre-approve or perform that rewrite.
- Container canary/health/persistence and real SQLite migration/recovery source mirrors remain unchanged until #91/#92, with their executable behavior still required.
