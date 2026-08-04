# CI-R08A evaluated Nuxt-config implementation evidence

**Issue:** [#77](https://github.com/smallwiselabs/swl-step-by-step/issues/77)

**Owner approval:** `APPROVE-CI-R08-IMPLEMENTATION-V2`, supplied 2026-07-12

## Outcome

Each approved Better Auth client fallback now has one independent behavioral owner in the ordinary Vitest gate. The test clears all three fallback variables, sets exactly one private sentinel, resets the module cache, captures process and console output, dynamically imports the real `nuxt.config.ts`, and requires a structured rejection for that key without disclosing the value in the error or captured output.

The built-runtime runner no longer launches three separate TSX processes that import the same config module. It retains the poisoned production build, build output/database secrecy, all 33 packaged pre-listen cases, the bounded telemetry sink, runtime precedence, migration, workers, health transitions, HTTP/auth matrices, deployment no-write observation, and cleanup. This slice changes no application, provider, schema, migration, dependency, workflow, or package-command behavior.

## Evidence ownership transition

| Guarantee                                                                                                                                 | Before                                                     | After                                    | Distinct retained packaged failure                                                                 |
| ----------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------------------------------------- |
| `RT-01D`: `NEXT_PUBLIC_AUTH_URL` rejects independently and its value is concealed                                                         | one TSX config-import child plus direct validator behavior | evaluated real-config Vitest case        | none; another process adds no build or Nitro evidence                                              |
| `RT-01D`: `NEXTAUTH_URL` rejects independently and its value is concealed                                                                 | one TSX config-import child plus direct validator behavior | evaluated real-config Vitest case        | none                                                                                               |
| `RT-01D`: `VERCEL_URL` rejects independently and its value is concealed                                                                   | one TSX config-import child plus direct validator behavior | evaluated real-config Vitest case        | none                                                                                               |
| `RT-01B`: the complete forbidden Better Auth environment surface fails before packaged TCP listen and does not contact the telemetry sink | one combined packaged startup case                         | unchanged combined packaged startup case | installed Nitro startup, listener observation, telemetry observation, and process-output redaction |
| `RT-01A`: poison values, secrets, and the build database do not enter output/artifacts/state                                              | poisoned production build                                  | unchanged poisoned production build      | real production build and generated output                                                         |

The direct `server-foundation.test.ts` cases remain because they own validator semantics without proving that `nuxt.config.ts` invokes the guard. The new Vitest cases own that top-level real-module wiring. They do not claim to prove Nuxt's fully resolved/merged configuration or CLI dotenv loading; the normal production build remains the separate composition gate.

## Reversible differential faults

The production key inventory was changed temporarily, one key at a time, and restored after each run. The command was:

```text
npm run pnpm -- --filter @smallwiselabs/web exec vitest run tests/nuxt-build-policy.test.ts
```

| Temporary fault                                                                   | Result                                                                                                  |
| --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------- |
| remove `NEXT_PUBLIC_AUTH_URL` from the production build guard                     | exactly its evaluated-config case failed; the other 8 tests passed                                      |
| remove `NEXTAUTH_URL` from the production build guard                             | exactly its evaluated-config case failed; the other 8 tests passed                                      |
| remove `VERCEL_URL` from the production build guard                               | exactly its evaluated-config case failed; the other 8 tests passed                                      |
| print the selected `NEXTAUTH_URL` sentinel inside a nested console object         | exactly its evaluated-config case failed on formatted captured-output secrecy; the other 8 tests passed |
| attach the selected `NEXTAUTH_URL` sentinel inside a non-enumerable error `cause` | exactly its evaluated-config case failed on inspected diagnostic secrecy; the other 8 tests passed      |

After restoration, all 9 focused tests passed. No fault remains in the diff.

## Measured change

| Measurement                                   |  Base | Implementation |                    Delta |
| --------------------------------------------- | ----: | -------------: | -----------------------: |
| `ci-runtime-smoke.mjs` physical lines         | 2,466 |          2,424 |                      -42 |
| `ci-runtime-smoke.mjs` nonblank lines         | 2,315 |          2,275 |                      -40 |
| `nuxt-build-policy.test.ts` physical lines    |    60 |            118 |                      +58 |
| two affected executable files, physical lines | 2,526 |          2,542 |                      +16 |
| two affected executable files, nonblank lines | 2,369 |          2,382 |                      +13 |
| managed child processes in the runtime runner |    44 |             41 |                       -3 |
| focused Vitest cases                          |     6 |              9 | +3 independent behaviors |

One equal-worktree runtime sample was 38.65 seconds before the change; two implementation samples were 41.71 and 39.04 seconds. Those noisy samples do not establish a speedup; the structural outcome is three fewer process launches. Hosted timings belong in the PR and issue evidence rather than being forecast.

## Official pinned basis

- Nuxt `4.4.8` supports `nuxt.config.ts` and explicit `defineNuxtConfig` import from `nuxt/config`: [pinned Nuxt config documentation](https://github.com/nuxt/nuxt/blob/v4.4.8/docs/2.directory-structure/3.nuxt-config.md).
- Vitest `4.1.6` documents that `vi.resetModules()` reevaluates a subsequent dynamic import, while top-level imports cannot be reevaluated: [pinned `vi.resetModules`](https://github.com/vitest-dev/vitest/blob/v4.1.6/docs/api/vi.md#vi-resetmodules).
- Vitest `4.1.6` documents `vi.stubEnv(key, undefined)` for removing an environment key and `vi.unstubAllEnvs()` for restoration: [pinned `vi.stubEnv`](https://github.com/vitest-dev/vitest/blob/v4.1.6/docs/api/vi.md#vi-stubenv) and [pinned restoration](https://github.com/vitest-dev/vitest/blob/v4.1.6/docs/api/vi.md#vi-unstuballenvs).
- Vitest `4.1.6` documents spying on a method and restoring its original implementation: [pinned `vi.spyOn`](https://github.com/vitest-dev/vitest/blob/v4.1.6/docs/api/vi.md#vi-spyon) and [pinned mock restoration](https://github.com/vitest-dev/vitest/blob/v4.1.6/docs/api/mock.md#mockrestore).
- Node 24's `formatWithOptions` preserves structured console arguments, while `inspect` recursively renders the documented `error.cause` diagnostic used by the secrecy assertion: [pinned `formatWithOptions`](https://nodejs.org/docs/latest-v24.x/api/util.html#utilformatwithoptionsinspectoptions-format-args), [pinned `inspect`](https://nodejs.org/docs/latest-v24.x/api/util.html#utilinspectobject-options), and [pinned `error.cause`](https://nodejs.org/docs/latest-v24.x/api/errors.html#errorcause).

The test uses a hard-coded approved input vector rather than importing the production key list, so deleting a production guard cannot delete its matching evidence. It stays non-concurrent because each case mutates process environment.

## Verification and rollback

Final local Node 24 evidence:

| Gate                                                                       | Result                                                                                                                   |
| -------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| focused `nuxt-build-policy.test.ts`                                        | 9/9 passed after all five reversible faults were restored                                                                |
| `format:check`, typecheck, syntax, and `git diff --check`                  | passed; 10 changed files formatted                                                                                       |
| `ci:fast`                                                                  | passed in 53.80 seconds; 92 infrastructure and 189 application tests                                                     |
| `verify:pinned`                                                            | passed in 69.25 seconds; 92 infrastructure tests, 189 coverage tests, required coverage thresholds, and production build |
| `test:runtime:ci`                                                          | passed in 39.04 seconds; 33 pre-listen, 20 origin, 10 deployment, and 19 auth/security checks                            |
| three independent code/security, scope/ledger, and official-source reviews | clean after diagnostic-capture and documentation corrections                                                             |

Hosted Fast and Full workers, independent review, final-head evidence, and the merge commit are recorded on the PR and #77 because the implementation commit cannot attest to checks that run after it exists.

Rollback is one normal code revert. It restores the three config-import child processes and removes the evaluated real-config cases; it requires no data, dependency, deployment, provider, or migration action. The accepted residual risk is normal hosted timing variance. No guarantee is retired.
