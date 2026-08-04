# CI-S02C2 container mirror removal

## Outcome

CI-S02C2/#91 removes the broad CI contract's raw Dockerfile, `.dockerignore`, container-build runner, container-health runner, local-object-storage implementation, and container-test loaders. It deletes their literal implementation fragments, test-title assertions, and matching mutation fixtures instead of moving those checks elsewhere.

The health runner is unchanged. The build runner still creates secret-shaped canaries at the context root and in an allowlisted source directory, but now independently inspects the actual build-stage filesystem before building the final image. This closes the review-discovered gap where removing the Dockerfile's self-checks could otherwise let a context leak evade final-image configuration/history inspection. The runner still requires the final image to default to `node:node` and inspects image configuration and full history for the canary. The health runner still uses the same image for maintenance jobs and two non-root application generations on one fresh named volume, then proves database, local-object, and backup persistence plus protected readiness, public liveness, and Docker's `healthy` to `unhealthy` transition.

The actual build proof now generates representative environment, database, journal, key/certificate, backup, and data canaries beneath both the context root and an allowlisted source tree. It executes Docker's effective context rules and inspects every generated path in the resulting build stage, so no parsed `.dockerignore` source policy remains.

One narrow focused health boundary remains: the test extracts and executes the Dockerfile's real JSON-form probe, requiring authenticated exact-ready success and silent bounded failure for an extra response field, `503`, a missing token, and an unresponsive server. Existing focused build tests retain invalid-argument and pre-existing-canary-path safety behavior.

Maintenance implementation and migration/recovery source mirrors remain assigned to CI-S02C3/#92. No workflow, dependency, lockfile, Dockerfile, `.dockerignore`, health runner, product behavior, schema, migration, deployment, or provider configuration changes in this tranche. The 43-line build-runner addition is the only production-runner change; the focused health test also adds the unresponsive-server behavior case while deleting its source mirrors.

## Baseline and working-tree reduction

The base is `master` commit `61b498df52ee3ba226e2ac0b99c7a590b5230cbc`.

| Surface                                           | Base physical/nonblank | Current physical/nonblank |      Change |
| ------------------------------------------------- | ---------------------: | ------------------------: | ----------: |
| Container-build runner                            |                97 / 84 |                 140 / 127 |   +43 / +43 |
| CI contract                                       |              805 / 734 |                 666 / 601 | -139 / -133 |
| CI contract tests                                 |              322 / 284 |                 298 / 260 |   -24 / -24 |
| Container-build focused tests                     |               108 / 99 |                   48 / 42 |   -60 / -57 |
| Container-health focused tests                    |              131 / 117 |                   96 / 85 |   -35 / -32 |
| Net touched verification code                     |          1,463 / 1,318 |             1,248 / 1,115 | -215 / -203 |
| All custom verification scripts/tests             |        12,439 / 11,199 |           12,224 / 10,996 | -215 / -203 |
| Raw `readFileSync(` calls in the contract         |                     15 |                         7 |          -8 |
| Textual `.replace(`/`.replaceAll(` test mutations |                     15 |                         8 |          -7 |

These are working-tree figures and must be refreshed if review changes the implementation.

## Official Docker basis

- Docker defines a [build context](https://docs.docker.com/build/concepts/context/) as the files a build may access. Its `.dockerignore` processing removes matched files before sending the context to the builder, supports `**`, and resolves exceptions by the last matching rule. That last-match behavior is why #91 removes the remaining pattern-presence test and instead relies on the actual multi-class canary build and build-stage filesystem inspection. Docker's [multi-stage build documentation](https://docs.docker.com/build/building/multi-stage/#stop-at-a-specific-build-stage) defines the retained `--target` mechanism used for this inspection.
- Docker documents [`USER` and runtime `--user`](https://docs.docker.com/engine/containers/run/#user): containers default to root unless the image or invocation selects another user. The actual image configuration check and runtime UID/GID observations therefore own the repository's non-root guarantee.
- Docker documents that [volumes persist independently of a container's lifecycle](https://docs.docker.com/engine/storage/volumes/) and that removing a container does not remove its named volume. The repository proves its application-specific persistence outcome by removing the first app container and starting a second on the same fresh volume, rather than by checking mount-related source strings.
- Docker's [`HEALTHCHECK` reference](https://docs.docker.com/reference/dockerfile/#healthcheck) defines the `starting`, `healthy`, and `unhealthy` states; timeout/retry behavior; and exit `0`/`1` semantics. The real container transition and focused execution of the shipped probe own those outcomes.
- Docker's [`none` network driver](https://docs.docker.com/engine/network/drivers/none/) documents complete container network-stack isolation. The unchanged maintenance runner still requests `--network none`, but this tranche does not add a second source assertion or container-inspection subsystem solely to attest that argument.

## Primary behavior by guarantee

| Guarantee/failure mode      | Primary executable owner                                                                                                           | Distinct failure caught                                                                                                                                   |
| --------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `CT-01A` context secrecy    | Actual build-stage filesystem inspection of every generated private-state canary plus final image configuration/history inspection | A representative environment/database/journal/key/certificate/backup/data file reaches the build filesystem or the generated value reaches final metadata |
| `CT-01B` non-root image     | Actual image `.Config.User` inspection plus both application generations' UID/GID and volume ownership checks                      | The image defaults to root, a container runs as root, or the fresh volume is unusable by the selected non-root identity                                   |
| `CT-02A` durable state      | Actual same-image maintenance and two-generation named-volume journey                                                              | Migration/backup/restore fails or database, local-object, backup, or mount identity is lost across replacement                                            |
| `CT-02B` readiness/liveness | Actual Docker health transition plus focused execution of the shipped probe                                                        | Wrong credentials/body/status pass, a probe hangs or emits output, dependency loss stays healthy, or liveness fails                                       |
| Container CLI safety        | Existing focused invalid-argument and pre-existing-canary behavior tests                                                           | A malformed invocation calls Docker, or the runner overwrites/deletes a user-owned canary-path file                                                       |

The actual Docker journey is the primary owner wherever Docker build, image metadata, container identity, volume lifecycle, or daemon health state is material. The focused probe test owns response acceptance, silence, and bounded failure without starting a full image for every input case.

## Deletion manifest

- raw broad-contract reads of the Dockerfile, `.dockerignore`, container-build runner/tests, container-health runner/tests, and local object-storage implementation;
- literal assertions for Dockerfile instructions, probe expressions, canary implementation, image-inspection calls, cleanup spellings, maintenance command arrays, mount strings, UID/GID expressions, local-object paths, health timing helpers, redaction expressions, and exact test titles;
- broad-contract enforcement of the complete `.dockerignore` allowlist and development-tool/output inventory;
- standalone test copies of Dockerfile/build-driver/health-driver implementation fragments;
- matching contract mutations and expected error-message assertions.

The following remain:

- the actual health runner, unchanged, plus the build runner's narrow build-stage filesystem inspection;
- the actual Dockerfile and `.dockerignore`, unchanged;
- root/nested context canaries, build-stage filesystem inspection, final image user/configuration/history inspection, and cleanup/redaction behavior in the actual build;
- same-image maintenance, fail-closed maintenance cases, named-volume persistence, two non-root application generations, and real readiness/liveness/health behavior;
- focused invalid-CLI, pre-existing-canary-path, and executable probe behavior;
- maintenance implementation and real SQLite recovery evidence pending CI-S02C3/#92.

No removed assertion is replaced with another assertion over Dockerfile/runner source fragments, function or import names, test titles, exact command spelling, or exact scenario counts.

## Runtime, faults, gates, and review

Node 24 local measurements compare this tranche with its exact `master` base. The focused selection is intentionally slower because it now waits for the shipped three-second probe timeout against an unresponsive server; the complete gates are faster despite that distinct added behavior.

| Measurement                                                   |    Base |   Head |
| ------------------------------------------------------------- | ------: | -----: |
| Focused container-build, health-probe, and contract selection |   0.68s |  3.35s |
| `ci:fast`                                                     |  63.48s | 54.68s |
| `verify:pinned`                                               | 130.06s | 78.43s |

The local Docker daemon was reachable, but its existing image/build-cache storage was already exhausted and the base build stopped with `no space left on device`. No user-owned image, cache, container, or volume was pruned for this tranche. Fresh GitHub-hosted workers therefore own the actual Docker evidence.

Representative faults were applied one at a time and reverted:

- A compound context fault removed both Dockerfile canary self-checks and appended last-match `.dockerignore` negations for every generated canary. The real build stage completed, then the new independent filesystem inspection failed at `docker run`; [the container job rejected it in 1m45s](https://github.com/smallwiselabs/swl-step-by-step/actions/runs/29179714296/job/86615103901).
- Changing the final image to `USER root` passed context inspection but failed final image identity with `Production image must default to the node:node user`; [the container job rejected it in 1m37s](https://github.com/smallwiselabs/swl-step-by-step/actions/runs/29179796166/job/86615310482).
- Mounting the named volume at `/app/not-data` passed the image build but made the read-only migration unexpectedly writable outside the intended persistent mount; [the real maintenance journey rejected it in 1m52s](https://github.com/smallwiselabs/swl-step-by-step/actions/runs/29179863633/job/86615490819).
- Replacing the shipped probe with unconditional success failed the executable probe behavior in [Full verify](https://github.com/smallwiselabs/swl-step-by-step/actions/runs/29179952380/job/86615690122) and [Fast](https://github.com/smallwiselabs/swl-step-by-step/actions/runs/29179952379/job/86615690079), then the real container journey failed because Docker remained `healthy` after the database dependency failed; [the container job rejected it in 2m41s](https://github.com/smallwiselabs/swl-step-by-step/actions/runs/29179952380/job/86615690113).

After every fault, the matching revert restored the exact implementation. Dockerfile, `.dockerignore`, and health-runner diffs against the base are empty.

The clean implementation head passed every hosted worker before the fault matrix:

| Required check                                                                                                                     | Result |
| ---------------------------------------------------------------------------------------------------------------------------------- | -----: |
| [Fast PR gate](https://github.com/smallwiselabs/swl-step-by-step/actions/runs/29179625186/job/86614880237)                         |  2m38s |
| [Full CI / verify](https://github.com/smallwiselabs/swl-step-by-step/actions/runs/29179625237/job/86614874388)                     |  2m42s |
| [Full CI / built runtime](https://github.com/smallwiselabs/swl-step-by-step/actions/runs/29179625237/job/86614874439)              |  1m47s |
| [Full CI / browser and accessibility](https://github.com/smallwiselabs/swl-step-by-step/actions/runs/29179625237/job/86614874400)  |   2m7s |
| [Full CI / container build and health](https://github.com/smallwiselabs/swl-step-by-step/actions/runs/29179625237/job/86614874414) |  2m13s |
| [Full CI / isolated integration](https://github.com/smallwiselabs/swl-step-by-step/actions/runs/29179625237/job/86614874419)       |   1m3s |
| [Full pre-merge gate](https://github.com/smallwiselabs/swl-step-by-step/actions/runs/29179625237/job/86615047171)                  |     3s |

Two independent final reviews are clean after review findings strengthened CT-01, removed the ineffective parsed pattern policy, bounded cleanup, and corrected the evidence documentation. Final pull-request-head and post-merge `master` checks remain to be recorded outside this commit so evidence updates do not recursively create another head.

## Rollback and residual risk

Reverting the CI-S02C2 merge restores only the literal container mirrors and mutation fixtures. It requires no image, volume, database, dependency, provider, deployment, schema, migration, or generated-artifact rollback.

- Renaming or refactoring Dockerfile and runner internals can now merge when their executable outcomes remain correct. That is intentional.
- No `.dockerignore` source policy freezes every production input, local tool directory, generated directory, or exact exception order. The actual build owns required-input availability and the multi-class canaries own representative private-state boundaries; review must assess newly introduced sensitive file classes.
- Build-stage filesystem inspection proves all generated representative private-state paths are absent after Docker processes the context. Image configuration/history inspection separately proves the generated value is absent from those inspected metadata surfaces. Neither is a generic raw-layer scan, software-bill-of-materials check, provenance attestation, or proof that every possible secret class is absent.
- The unchanged maintenance invocation requests `--network none`, but #91 does not add a new runtime network-inspection framework. Accidental removal of that argument is therefore review-owned unless a later bounded behavioral owner is approved.
- The former blanket prohibition on every Dockerfile `ARG` is explicitly retired as overbroad. Secret-bearing `ARG` or `ENV` remains unsafe according to Docker's official [`SecretsUsedInArgOrEnv` check](https://docs.docker.com/reference/build-checks/secrets-used-in-arg-or-env/), but adopting and making that beta build check fatal requires a separately evaluated, pinned-tool tranche; #91 does not replace the old text rule with another source assertion.
- Exact cleanup call spellings, health timing constants, maintenance/scenario counts, and test titles are no longer guarantees. Actual success/failure cleanup and bounded executable outcomes remain required.
- Real Coolify volume and routing behavior remains external staging evidence; this tranche proves the local Docker primitive only.
- Maintenance implementation and migration/recovery source mirrors remain brittle until CI-S02C3/#92; their real SQLite tests remain required throughout.
