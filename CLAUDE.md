# Repository working agreement

> Persistent instructions for Claude Code in this repo. Loaded automatically each session.

## PR workflow — ALWAYS

For **every** change, once the work is committed and pushed to the working branch:

1. **Open a pull request automatically** (base branch: `main`).
2. **Squash-merge that PR immediately after opening it** (`merge_method: squash`).

Notes:
- Continue developing on the designated feature branch, push, then open + squash-merge the PR.
- After a squash-merge, sync the working branch with `main` before the next change to avoid divergence.
- If the merge is blocked (branch protection, required reviews/CI), report the blocker instead of forcing it.

_Established by repo owner on 2026-06-15._
