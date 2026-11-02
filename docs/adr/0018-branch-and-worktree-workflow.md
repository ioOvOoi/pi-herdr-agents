# ADR-0018: Keep a fork integration branch and one worktree per feature

- **Status:** Accepted
- **Date:** 2026-11-03
- **Scope:** How this fork branches, where feature work happens, and what an
  upstream PR may contain
- **Contract:** [`branching.md`](../branching.md)
- **Constrained by:** [ADR-0013](0013-pack-neutral-execution-host.md) (this
  repository ships no workflow methodology; the workflow lives in contributor
  docs, not in shipped behavior)

## Context

This repository is a fork of `giuseppecrj/pi-herdr-agents`. Work arrives from
two directions: changes this fork wants and changes upstream may accept. The
default git shape — one `main`, one branch per change, PR directly upstream —
forces a choice on every change: either it is ready for upstream review the day
it is written, or it sits as an unmerged branch that drifts further from
`upstream/main` and blocks the next change that depends on it.

There is also a physical constraint. A single checkout can only have one branch
checked out, so two changes cannot be verified at the same time, and a
half-finished change blocks everything behind it.

Three alternatives were considered:

1. **Feature branches straight off `main`, each PR'd upstream immediately.** No
   drift, but no place to accumulate work and no integration point; every change
   is exposed to upstream review before it is even self-consistent.
2. **One long-lived `dev` proposed to upstream wholesale.** Simple to run, but
   the upstream PR becomes a bundle of unrelated commits that no maintainer will
   review, so it is not a real proposal path.
3. **`main` as a mirror, `dev` as a local integration line, one `feat/*` per
   change, upstream PRs taken from individual feature branches.** More branches
   to hold in mind, but it separates "accumulate" from "propose".

## Decision

1. `main` mirrors `upstream/main` and never carries a local commit. It is
   fast-forwarded from `upstream/main` and pushed to `origin`.
2. `dev` is this fork's default branch and integration line. Feature branches are
   cut from `dev`, and their PRs target `dev`.
3. Each feature branch gets its own worktree at `.worktrees/<slug>`, with its own
   `node_modules`. `.worktrees/` is git- and npm-ignored.
4. An upstream PR names one `feat/<slug>` as its head and `upstream/main` as its
   base. `dev` is never an upstream PR's head.
5. A feature that only applies on top of another unmerged feature is not proposed
   alone; either its dependency lands upstream first, or both are proposed in one
   PR that says so.
6. The parent owns integration and cleanup: merging into `dev`, removing the
   worktree, and deleting the branch. A delegated child never removes its own
   lane.

## Consequences

- `dev` can be ahead of upstream by several features without any of them being
  blocked on upstream review.
- Every upstream proposal stays single-purpose, which is what a maintainer can
  actually review.
- Rebasing a feature onto `upstream/main` is a required step before proposing it,
  because `dev` is its base but not its destination. A feature that cannot
  rebase cleanly is a signal that it carries a dependency, not a rebase problem to
  paper over.
- Disk usage grows by one `node_modules` per active lane. That is the price of
  verifying two features independently; sharing dependencies between lanes trades
  a cheap disk cost for a silent cross-lane failure.
- This is contributor workflow, not shipped behavior. It adds no command, no
  configuration key, and no role (ADR-0013). Reversing it costs a branch rename
  and a rebase, not a migration.
