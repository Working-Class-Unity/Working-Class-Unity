# Audit evidence snapshot and reproduction

## Pinned repository state

| Field                               | Value                                                            |
| ----------------------------------- | ---------------------------------------------------------------- |
| Repository                          | `smallwiselabs/swl-step-by-step`                                 |
| Worktree                            | `/Users/chima/code/github/swl-step-by-step-ci-audit`             |
| Branch                              | `branch/ci-verification-audit`                                   |
| Base/HEAD during collection         | `3f705edac3d66ff5bea1db6098f39342baa8b57d`                       |
| Base commit subject                 | `[R-017I] Enable Better Auth workspace invitations safely (#66)` |
| Original checkout                   | Preserved dirty and untouched                                    |
| Audit worktree before documentation | Clean                                                            |

## Raw recent-run sample

The runtime table uses the exact audited `master` run pair and the four immediately preceding successful `master` pairs. Durations are seconds. “Full runner” is the sum of completed Full job durations; “Full wall” is workflow start to completion.

| Head      |    Fast run | Fast job |    Full run | Full runner | Pair runner | Full wall |
| --------- | ----------: | -------: | ----------: | ----------: | ----------: | --------: |
| `3f705ed` | 29150360127 |      141 | 29150360117 |         575 |         716 |       205 |
| `f7860c7` | 29148343877 |      132 | 29148343860 |         562 |         694 |       192 |
| `e9b88b2` | 29141759166 |      113 | 29141759172 |         521 |         634 |       156 |
| `4403c0c` | 29139689105 |      114 | 29139689103 |         547 |         661 |       184 |
| `a2d63f2` | 29137260232 |      130 | 29137260224 |         530 |         660 |       176 |

Sorted pair-runner values are `634, 660, 661, 694, 716`; median is 661. Type-7 linear interpolation gives p95 `694 + 0.8 × (716 - 694) = 711.6`.

Sorted Full-wall values are `156, 176, 184, 192, 205`; median is 184 and the same interpolation gives p95 `202.4`.

## Complete available run-history aggregate

Observation window: 2026-07-10T01:42:35Z through 2026-07-11T11:04:07Z.

| Workflow/event/conclusion       | Count |
| ------------------------------- | ----: |
| Fast / pull request / success   |    37 |
| Fast / pull request / failure   |     1 |
| Fast / pull request / cancelled |     3 |
| Fast / push / success           |    17 |
| Fast / push / failure           |     1 |
| Fast / push / cancelled         |     4 |
| Full / pull request / success   |    36 |
| Full / pull request / failure   |     0 |
| Full / pull request / cancelled |     5 |
| Full / push / success           |    17 |
| Full / push / failure           |     0 |
| Full / push / cancelled         |     5 |
| Total                           |   126 |
| Runs with `run_attempt > 1`     |     0 |

Failure evidence:

- Fast `master` run 29087149136 failed the formatter on committed unformatted files.
- Fast pull-request run 29096414933 failed because Gitleaks detected one potential secret.
- No failed run was rerun at the same attempt lineage, so no rerun-based flake was observed.
- Cancelled runs are reported separately and were not classified as flakes.

## Raw LOC/churn snapshot

| Measure                                     |           Value |
| ------------------------------------------- | --------------: |
| Verification files                          |              43 |
| Verification physical/nonblank LOC          | 17,867 / 16,252 |
| Implementation files                        |              28 |
| Implementation physical/nonblank LOC        | 13,306 / 12,093 |
| Test files                                  |              15 |
| Test physical/nonblank LOC                  |   4,561 / 4,159 |
| Production TypeScript files                 |             110 |
| Production TypeScript physical/nonblank LOC |   6,924 / 6,093 |
| Post-gate non-merge commits                 |              15 |
| Those touching contract/tests               |              14 |
| Those touching coverage/debt                |              12 |
| Contract follow-up churn                    |     +2,581/-311 |
| Coverage follow-up churn                    |       +256/-196 |

The per-file raw LOC values are preserved in the [43-component ledger](./inventory.md#per-component-ledger).

## External repository state snapshot

| Setting/API                                       | Observed result                                        |
| ------------------------------------------------- | ------------------------------------------------------ |
| Visibility/default branch                         | private / `master`                                     |
| Actions                                           | enabled; all Actions allowed                           |
| Platform full-SHA requirement                     | `false`                                                |
| Default workflow token                            | `read`                                                 |
| Workflow token may approve PR review              | `false`                                                |
| Repository Actions secrets/variables/environments | 0 / 0 / 0                                              |
| Active Actions caches                             | 0                                                      |
| Default artifact/log retention                    | 90 days                                                |
| Workflow artifact retention                       | 30 days                                                |
| Current artifact total                            | 90                                                     |
| Branch protection API                             | `403`: private repository plan does not enable feature |
| Rulesets API                                      | `403`: private repository plan does not enable feature |
| Dependabot vulnerability alerts                   | `404`: disabled by authoritative enabled-check API     |
| Secret scanning                                   | `404`: disabled                                        |
| Code scanning                                     | `403`: Advanced Security required                      |

The audit does not infer any unavailable protection from these errors.

## Candidate snapshot

| Candidate   | Exact version |  Stars | Approx. contributors | License        | Dedicated security-reporting evidence                             | Exact local audit result                                                                       |
| ----------- | ------------- | -----: | -------------------: | -------------- | ----------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- |
| actionlint  | 1.7.12        |  4,029 |                   90 | MIT            | No dedicated policy identified; release attestations from 1.7.11  | Checksum-verified macOS arm64 binary passed workflows                                          |
| ShellCheck  | 0.11.0        | 39,687 |                  177 | GPL-3.0        | No separate policy recorded in this audit                         | Checksum-verified binary passed through actionlint                                             |
| zizmor      | 1.26.1        |  5,828 |                  103 | MIT            | No dedicated policy identified; the GitHub Action remains pre-1.0 | Checksum-verified offline strict/auditor and online auditor passed                             |
| Vitest      | 4.1.6         | 16,829 |                  775 | MIT            | Private vulnerability-reporting policy                            | Already installed; native negative ceilings active                                             |
| Playwright  | 1.61.1        | 92,627 |                  775 | Apache-2.0     | Microsoft security-reporting policy                               | Already installed; exact `webServer` capability verified from pinned docs                      |
| OSV-Scanner | 2.4.0         | 10,637 |                  115 | Apache-2.0     | Google-governed; checksums and SLSA provenance                    | Existing direct pinned CLI retained                                                            |
| Gitleaks    | 8.30.1        | 28,085 |                  234 | MIT            | Current-version private advisory policy                           | Existing direct pinned CLI retained                                                            |
| Lychee      | 0.24.2        |  3,754 |                  116 | MIT/Apache-2.0 | No separate policy recorded in this audit                         | Checksum-verifiable CLI found two valid GitHub line anchors unsupported in offline anchor mode |

Stars and contributors are a 2026-07-11 GitHub API snapshot. Approximate contributor counts may include bots. Missing dedicated security-policy evidence is recorded rather than inferred.

## Selected collection commands

These are the commands most material to the conclusions, not a claim that every derived category split or ephemeral candidate-binary experiment can be reproduced from one script. All ran from the clean audit worktree and require authenticated `gh`, `jq`, standard POSIX tools, and the repository's supported Node 24 line where applicable. The tables above are the dated snapshot; repository settings, adoption data, and workflow history will drift.

### Repository and LOC

```sh
git status --short --branch
git rev-parse HEAD
git rev-parse origin/master

find scripts -maxdepth 1 -type f \
  \( -name '*.mjs' -o -name '*.ts' \) -print0 |
  xargs -0 wc -l |
  sort -nr

find scripts -maxdepth 1 -type f \
  \( -name '*.mjs' -o -name '*.ts' \) -print |
  sort |
  while IFS= read -r file; do
    physical=$(awk 'END { print NR }' "$file")
    nonblank=$(awk 'NF { count += 1 } END { print count + 0 }' "$file")
    printf '%s\t%s\t%s\n' "$physical" "$nonblank" "$file"
  done
```

The production comparator uses the same loop over `apps/web/app`, `apps/web/server`, and `apps/web/shared` TypeScript extensions, excluding test/support paths as listed in the coverage include roots.

### Commit co-change and churn

```sh
for sha in $(git rev-list --reverse --no-merges \
  d1f98338d3b0aeefe89a9ed5ba84f5f769c2d2ab..3f705edac3d66ff5bea1db6098f39342baa8b57d); do
  changed=$(git diff-tree --no-commit-id --name-only -r "$sha")
  printf '%s\t' "$sha"
  printf '%s' "$changed" | rg -q '^scripts/ci-contract(\\.test)?\\.mjs$' && printf 'contract ' || true
  printf '%s' "$changed" | rg -q '^(scripts/ci-coverage|apps/web/coverage-debt\\.json)' && printf 'coverage' || true
  printf '\n'
done

git log --no-merges --numstat --format='' \
  d1f98338d3b0aeefe89a9ed5ba84f5f769c2d2ab..3f705edac3d66ff5bea1db6098f39342baa8b57d \
  -- scripts/ci-contract.mjs scripts/ci-contract.test.mjs
```

### Complete workflow-history aggregate

```sh
gh api --paginate \
  'repos/smallwiselabs/swl-step-by-step/actions/runs?per_page=100' |
  jq -s '
    [.[].workflow_runs[] |
      select(.created_at >= "2026-07-10T01:42:35Z" and
             .created_at <= "2026-07-11T11:04:07Z")] as $runs |
    {
      count: ($runs | length),
      first: ($runs | map(.created_at) | min),
      last: ($runs | map(.created_at) | max),
      groups: ($runs |
        group_by([.name, .event, (.conclusion // "none")]) |
        map({name: .[0].name, event: .[0].event,
             conclusion: (.[0].conclusion // "none"), count: length})),
      reruns: ($runs | map(select(.run_attempt > 1) |
        {id, name, event, run_attempt, head_sha, html_url}))
    }'
```

### Five-run pair and job-duration sample

```sh
gh api --paginate \
  'repos/smallwiselabs/swl-step-by-step/actions/runs?branch=master&per_page=100' |
  jq -r '.workflow_runs[] |
    select(.event == "push" and .conclusion == "success") |
    [.id, .name, .head_sha, .run_started_at, .updated_at] | @tsv' |
  head -30

for id in \
  29150360127 29150360117 \
  29148343877 29148343860 \
  29141759166 29141759172 \
  29139689105 29139689103 \
  29137260232 29137260224; do
  gh api "repos/smallwiselabs/swl-step-by-step/actions/runs/$id/jobs?per_page=100" |
    jq -r --arg id "$id" '.jobs[] |
      [$id, .name, .started_at, .completed_at, .conclusion] | @tsv'
done
```

### External repository state

```sh
gh api repos/smallwiselabs/swl-step-by-step \
  --jq '{private,visibility,default_branch,delete_branch_on_merge,security_and_analysis}'
gh api repos/smallwiselabs/swl-step-by-step/actions/permissions
gh api repos/smallwiselabs/swl-step-by-step/actions/permissions/workflow
gh api repos/smallwiselabs/swl-step-by-step/actions/permissions/artifact-and-log-retention
gh api repos/smallwiselabs/swl-step-by-step/actions/cache/usage
gh api repos/smallwiselabs/swl-step-by-step/actions/artifacts --jq '.total_count'
gh api repos/smallwiselabs/swl-step-by-step/actions/secrets --jq '.total_count'
gh api repos/smallwiselabs/swl-step-by-step/actions/variables --jq '.total_count'
gh api repos/smallwiselabs/swl-step-by-step/environments --jq '.total_count'
gh api repos/smallwiselabs/swl-step-by-step/branches/master/protection
gh api repos/smallwiselabs/swl-step-by-step/rulesets
gh api -i repos/smallwiselabs/swl-step-by-step/vulnerability-alerts
gh api -i repos/smallwiselabs/swl-step-by-step/secret-scanning/alerts
gh api -i repos/smallwiselabs/swl-step-by-step/code-scanning/alerts
```

### Retained supply-chain artifact

Fast run `29150360127` produced artifact `8247979244`, named `supply-chain-29150360127-1`, with compressed size 17,624 bytes. Its single archive expands to:

| File                    |   Bytes | Boundary                                                           |
| ----------------------- | ------: | ------------------------------------------------------------------ |
| `osv-dependencies.json` | 228,876 | Raw dependency/finding evidence: 1,295 packages, 4 vulnerabilities |
| `summary.json`          |   1,348 | Sanitized summary                                                  |
| `pnpm-signatures.json`  |     128 | Sanitized signature summary                                        |

No Gitleaks report or canary is retained.

```sh
gh api repos/smallwiselabs/swl-step-by-step/actions/artifacts/8247979244 \
  --jq '{id,name,size_in_bytes,expired,created_at,expires_at,workflow_run}'

artifact_dir=$(mktemp -d)
gh run download 29150360127 \
  --repo smallwiselabs/swl-step-by-step \
  --name supply-chain-29150360127-1 \
  --dir "$artifact_dir"
find "$artifact_dir" -maxdepth 1 -type f -print0 | xargs -0 wc -c
jq '{packages: ([.results[].packages[]] | length), vulnerabilities: ([.results[].packages[].vulnerabilities[]?] | length)}' \
  "$artifact_dir/osv-dependencies.json"
rm -rf "$artifact_dir"
```

### Source-assertion counts

```sh
rg -o '\.includes\\(' scripts/ci-contract.mjs | wc -l
rg -o '\.indexOf\\(' scripts/ci-contract.mjs | wc -l
rg -o '\.test\\(' scripts/ci-contract.mjs | wc -l
rg -o 'readFileSync\\(' scripts/ci-contract.mjs | wc -l
rg -n 'for \(const required of \[' scripts/ci-contract.mjs
rg -o '\.replace\\(' scripts/ci-contract.test.mjs | wc -l
```

### Candidate repository/adoption snapshot

```sh
for repository in \
  rhysd/actionlint \
  koalaman/shellcheck \
  zizmorcore/zizmor \
  vitest-dev/vitest \
  microsoft/playwright \
  google/osv-scanner \
  gitleaks/gitleaks \
  lycheeverse/lychee; do
  gh api "repos/$repository" \
    --jq '[.full_name,.stargazers_count,.forks_count,.archived,.pushed_at,.license.spdx_id] | @tsv'
  gh api --paginate "repos/$repository/contributors?per_page=100&anon=true" |
    jq -s --arg repository "$repository" \
      '[.[].[]] | [$repository, length] | @tsv'
  gh api "repos/$repository/community/profile" \
    --jq '[.health_percentage,(.files.security // "unavailable")] | @tsv'
done
```

Contributor endpoints are approximate, may include bots, and can change after the snapshot. Release checksums, exact tags/commits, licenses, and security links are recorded beside each candidate in the [candidate matrix](./candidate-matrix.md). Temporary downloaded research binaries were checksum-verified and deleted; no candidate artifact is committed.

## Verification of this snapshot

The audit PR must rerun formatting and the repository documentation checker after issue/PR links are added. Full GitHub Fast and Full checks remain required before the documentation-only audit PR can merge. No candidate binary or temporary research artifact is committed.
