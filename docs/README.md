# Documentation status

The standalone WCU rebuild began by importing an exact Baseline source snapshot. Documentation was
preserved with that snapshot so later ports can be traced, but preservation does not make every
document a current WCU contract.

## Current WCU sources

- [`wcu-rebuild-provenance.md`](wcu-rebuild-provenance.md) records the approved product direction,
  history boundary, and selective-port ledger.
- The root [`README.md`](../README.md) describes the current application foundation and local entry
  points.
- The root [`AGENTS.md`](../AGENTS.md) governs future implementation and verification work.
- Current code, committed migration, environment examples, and executable checks resolve any
  conflict with an inherited guide.

## Imported source history

The `adr/`, `audits/`, and `baseline/` directories describe the donor Baseline application at
different points in its history. They include deliberate WCU non-features such as Organization and
Family authority, Projects, Google login, SMTP, and runtime module switches. Treat them as research
and provenance only unless a WCU decision explicitly carries a behavior forward.

The other top-level guides and `ops/` runbooks were also imported. Some still contain Baseline
names, old migration counts, removed routes, or provider-switch language. Validate them against the
current application before operational use. Hosted deployment remains blocked on the WCU UI,
credentials, provider certification, and a separately approved cutover.
