# Domain Docs

How the engineering skills should consume this repo's domain documentation when
exploring the codebase.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root. This repo's glossary is named `CONTEXT.md`,
  not `GLOSSARY.md`: the file predates the glossary name, and the package
  contract depends on it (`test/package-manifest.test.js` reads it and asserts
  `CONTEXT.md` ships in the npm package, and the documentation-synchronization
  rules in `AGENTS.md` name it). Keep the existing name; do not rename it to
  `GLOSSARY.md`, and do not create a second glossary beside it.
- **`docs/adr/`**: read ADRs that touch the area you're about to work in. ADRs
  0001–0017 exist; several are superseded or partially superseded, and
  `docs/README.md` records which is which. Read the status column there before
  treating an ADR as current.

If either is missing, **proceed silently**. Don't flag their absence; don't
suggest creating them upfront. The `/domain-modeling` skill (reached via
`/grill-with-docs` and `/improve-codebase-architecture`) creates ADRs lazily when
decisions actually get resolved.

## File structure

This is a single-context repo. There is no `GLOSSARY-MAP.md` and no per-context
`GLOSSARY.md`: the package is one seam-layered extension, not a monorepo, and
`docs/adr/` holds decisions for all of it.

```
/
├── CONTEXT.md              ← the domain glossary (legacy name, keep it)
├── docs/
│   ├── adr/               ← 0001–0017, status tracked in docs/README.md
│   └── agents/            ← these consumer rules
└── maestro/               ← core / adapters / surfaces / runtime seams
```

## Use the glossary's vocabulary

`CONTEXT.md` entries are structured as a bold term, a definition, and an
`_Avoid_:` list of synonyms the project rejects. When your output names a domain
concept (in an issue title, a refactor proposal, a hypothesis, a test name), use
the term as defined there, and do not drift to the `_Avoid_` synonyms. The
orchestration vocabulary — run session, harness adapter, surface provider,
composition root, dependency rule, worktree handoff, outcome ledger — is
load-bearing: the dependency-rule test and the seam layout encode it.

If the concept you need isn't in the glossary yet, that's a signal: either you're
inventing language the project doesn't use (reconsider) or there's a real gap
(note it for `/domain-modeling`).

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than
silently overriding:

> _Contradicts ADR-0013 (pack-neutral execution host), but worth reopening because…_

Check the ADR's status in `docs/README.md` first: contradicting a superseded ADR
(such as 0001, 0004, 0005, or 0007) is usually not a conflict at all.
