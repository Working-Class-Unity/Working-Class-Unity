# Working Class Unity coding SOP

This file is the canonical operating guidance for developers and coding agents throughout this
repository.

## Local files

- GitHub repositories are stored under `/home/chima/GitHub`.
- Save Git worktrees under `/home/chima/Worktrees`.

## Think before coding

- Don't assume. Don't hide confusion. Surface tradeoffs.
- State assumptions explicitly. If uncertain, ask.
- If multiple interpretations exist, present them—don't pick silently.
- If a simpler approach exists, say so. Push back when warranted.
- If something is unclear, stop. Name what's confusing. Ask.

## Use subagents aggressively

- Offload research, codebase exploration, and parallel analysis to subagents when the user or
  operating environment permits subagents.
- Keep each agent focused on one clear task.
- Protect the main context window by moving side work out of the primary thread.
- Delegate concrete, bounded work that can run in parallel without blocking the main thread.
- Do not duplicate work between the main thread and subagents.
- Integrate results deliberately, and record important findings where future agents will see them.
- For important or high-risk work, separate implementation from verification when subagents are
  available.
  - Give a fresh, non-authoring reviewer the acceptance criteria and final diff.
  - Have it derive expected behavior from the requirements, not the implementation agent's
    summary.
  - Ask whether the tests verify the intended behavior and would reject a plausible incorrect
    implementation.
  - Keep the reviewer read-only. Review overlap is intentional, but implementation work must not
    be duplicated.
- Treat user-provided or explicitly approved acceptance tests as constraints. Do not edit them
  without approval.
- Prefer a focused integration or end-to-end check over many mocked unit tests when it provides
  stronger evidence with less maintenance.
- Use mutation testing only when the repository already supports it and the change affects core,
  high-risk domain logic. Do not introduce mutation-testing tooling unless requested.

## Make documentation-based decisions

- Do not assume or hide confusion. Surface tradeoffs.
- Make decisions based on developer documentation. Search for it or use relevant MCPs.
- If multiple interpretations exist, look for well-regarded open-source repositories for examples
  to help with interpretation.
- If a simpler approach exists, explore it.

## Simplicity first

- Write the minimum code that solves the problem. Nothing speculative.
- No features beyond what was asked.
- No abstractions for single-use code.
- No flexibility or configurability that wasn't requested.
- No error handling for impossible scenarios.
- If you write 200 lines and it could be 50, rewrite it.
- Ask: “Would a senior engineer say this is overcomplicated?” If yes, simplify.

## Make surgical changes

- Touch only what you must. Clean up only your own mess.
- When editing existing code:
  - Don't improve adjacent code, comments, or formatting.
  - Don't refactor things that aren't broken.
  - Match the existing style, even if you'd do it differently.
  - If you notice unrelated dead code, mention it—don't delete it.
- When your changes create orphans:
  - Remove imports, variables, or functions that your changes made unused.
  - Don't remove pre-existing dead code unless asked.
- Every changed line should trace directly to the user's request.
- Before handoff, inspect the complete diff. Explicitly report any dependency or lockfile change,
  public API or schema change, CI or deployment change, deleted or weakened test, or new mock
  boundary.

## Execute toward a verifiable goal

- Transform tasks into the smallest verifiable goal. Tests are a verification method, not an
  automatic deliverable.
- Examples:
  - “Add validation” becomes “Define the invalid-input behavior required by the specification or
    contract; verify the smallest relevant set; implement.”
  - “Fix the bug” becomes “Reproduce the observable failure with the smallest reliable check;
    confirm it fails when practical; fix it; confirm it passes.”
  - “Refactor X” becomes “Run relevant checks before and after; add tests only for an important
    contract that was previously unprotected.”
- For a multi-step task, state a brief plan:

  ```text
  1. [Step] -> verify: [check]
  2. [Step] -> verify: [check]
  3. [Step] -> verify: [check]
  ```

- Strong success criteria let you loop independently. Weak criteria such as “make it work” require
  constant clarification.

## Verify with restraint

- Permanent tests must justify their maintenance cost.
  - Add one only when it protects an acceptance criterion, reproduced bug, stable important
    contract, or concrete security, data-integrity, or other high-impact risk.
  - Prefer the smallest set covering distinct required behaviors. For a bug, start with one minimal
    regression test that fails before the fix.
  - Test observable outcomes and stable contracts, not incidental implementation details.
  - Do not test behavior owned entirely by a framework or library. Test this project's
    configuration or integration when that is the contract at risk.
  - Do not add tests solely to increase coverage.
- Edge cases require evidence.
  - Implement or test an edge case only when required by the specification, previously observed,
    part of an existing contract, or necessary for security or data integrity.
  - Report merely conceivable cases as possible follow-ups without adding code.
- Keep diagnostic probes temporary. Remove them before handoff unless they qualify as permanent
  regression tests.
- Prefer existing fixtures and real dependencies where practical. For every new mock boundary,
  explain what it replaces and why the alternatives are unsuitable.
- Never delete, skip, weaken, or rewrite a test merely to make the implementation pass.
  - If requested behavior intentionally changes a tested contract, explain why the old assertion
    is invalid and preserve equivalent coverage for the new contract.

## Perform a subtraction pass

- After the implementation works and checks pass, review only your diff for safe reductions. Add
  no capabilities during this pass.
  - Remove agent-introduced duplication, unnecessary wrappers, one-use abstractions, speculative
    validation, impossible-state fallbacks, unrequested compatibility shims, and redundant tests
    or mocks.
  - Reuse existing project facilities where that reduces the diff without obscuring behavior.
  - Do not force a deletion when none is safe.
  - Re-run relevant checks after any reduction.
