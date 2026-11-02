# Triage Labels

The skills speak in terms of five canonical triage roles. This file maps those
roles to the states this repo actually records.

This repo's tracker is local markdown under `.scratch/` (see
`issue-tracker.md`), so a role is not a GitHub label: it is the value of the
`Status:` line near the top of an issue file.

| Label in mattpocock/skills | Value in our tracker  | Meaning                                  |
| -------------------------- | --------------------- | ---------------------------------------- |
| `needs-triage`             | `needs-triage`        | Maintainer needs to evaluate this issue  |
| `needs-info`               | `needs-info`          | Waiting on reporter for more information |
| `ready-for-agent`          | `ready-for-agent`     | Fully specified, ready for an AFK agent  |
| `ready-for-human`          | `ready-for-human`     | Requires human implementation            |
| `wontfix`                  | `wontfix`             | Will not be actioned                     |

Write one of these as the `Status:` value, for example:

```markdown
# 03 extract the launch command pieces

Status: ready-for-agent
Type: task
Blocked by: 02
```

`/wayfinder` tickets use `Status: claimed` and `Status: resolved` instead; those
are the wayfinding states, not triage roles.

When a skill mentions a role (e.g. "apply the AFK-ready triage label"), use the
corresponding value from this table.

The same five strings also exist as labels on the fork
`ioOvOoi/pi-herdr-agents`, created only so a future switch to GitHub Issues
would not need a rename. Nothing reads them today. Do not apply them to issues
in `giuseppecrj/pi-herdr-agents`.

Edit the "Value in our tracker" column to match whatever vocabulary you actually
use.
