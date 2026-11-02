# Branch and worktree workflow

This fork keeps a three-level branch topology so that upstream stays clean
while work can still accumulate over time.

| Branch | Role | Who writes to it |
| --- | --- | --- |
| `main` | Mirror of `upstream/main`. Never carries local commits. | Nobody. Only fast-forwarded from upstream. |
| `dev` | This fork's default branch and integration line. | Merges from `feat/*` only, through a PR. |
| `feat/<slug>` | One unit of work. Cut from `dev`. | The author. |

`origin` is `ioOvOoi/pi-herdr-agents` (this fork). `upstream` is
`giuseppecrj/pi-herdr-agents` (the originating project).

## Glossary

- **Integration line** — `dev`. Where finished feature branches land, and the
  branch a fresh clone of the fork gets.
- **Feature branch** — `feat/<slug>`. One reviewable change. Lives on the fork,
  opens a PR into `dev`, and is deleted after merge.
- **Worktree lane** — `.worktrees/<slug>`. A second checkout of the same
  repository attached to one feature branch. Every lane has its own
  `node_modules`.
- **Upstream PR** — a PR whose base is `upstream/main` and whose head is a
  *single* `feat/<slug>` on this fork. Never `dev`.
- **Mirror** — `main`. Identical to `upstream/main`; a local commit on it is a
  bug.

## Syncing the mirror

```bash
git fetch upstream
git switch main
git merge --ff-only upstream/main
git push origin main
```

If the fast-forward fails, `main` has local commits. Move them to a branch
first; do not merge upstream into `main`.

## Starting a feature

```bash
git fetch origin
git worktree add .worktrees/<slug> -b feat/<slug> origin/dev
cd .worktrees/<slug>
npm install
```

`.worktrees/` is git-ignored and npm-ignored. Each lane installs its own
dependencies: sharing `node_modules` between lanes means an `npm ci` in one lane
silently breaks verification in another.

## Committing

Small commits, conventional-commit subjects (`feat:`, `fix:`, `docs:`,
`test:`, `chore:`), an imperative subject line, and a body that says *why*.

## Opening the PR into `dev`

```bash
git push -u origin feat/<slug>
gh pr create --base dev --head feat/<slug> \
  --title "<conventional subject>" --body "<what changed and why>"
```

Review the diff, wait for CI, then merge. Squash only when the feature's internal
commits are noise; keep the merge commit when the branch's history explains the
change.

## Proposing to upstream

One feature, one upstream PR:

```bash
git push origin feat/<slug>
gh pr create --repo giuseppecrj/pi-herdr-agents \
  --base main --head ioOvOoi:feat/<slug>
```

Before opening it, confirm the branch stands on its own:

```bash
git rebase --onto upstream/main dev feat/<slug>
```

That rebase must apply without pulling in other features. If it does not, the
feature depends on work that is still only in `dev`; either land the dependency
upstream first or propose them together in one PR and say so in the body.

`dev` is never the head of an upstream PR. A long-lived integration branch would
turn every proposal into a bundle of unrelated commits.

## Finishing

```bash
git worktree remove .worktrees/<slug>   # keeps the branch
git branch -d feat/<slug>               # after the PR is merged
git push origin --delete feat/<slug>
```

Removal is the parent's job. A subagent never removes its own lane.

## Windows: which shell

On this machine Pi runs under `pi-sandbox`'s `windows-acl` runner: a
`WRITE_RESTRICTED` token at Low integrity. That sandbox allows file writes inside
the workspace but denies two things this workflow needs:

- `git fetch` / `git push` — the remote helper needs a pipe, denied as Low IL.
- `hc` — the herdr-core pipe belongs to a higher-integrity process.

Escalating the permission prompt does not help: it widens the filesystem
boundary, not the process token. Run those commands through the `pwsh` tool,
which is not confined by that runner.
