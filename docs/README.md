# Documentation status

The standalone WCU rebuild began by importing an exact Baseline source snapshot. Documentation was
preserved with that snapshot so later ports can be traced, but preservation does not make every
document a current WCU contract.

## Current WCU sources

- [`basic-release.md`](basic-release.md) records the source-owned exclusion of inherited AI and
  user-file capabilities and distinguishes user-file R2 from database-backup R2.
- [`wcu-rebuild-provenance.md`](wcu-rebuild-provenance.md) records the approved product direction,
  history boundary, and selective-port ledger.
- [`solidarity-taxonomy.md`](solidarity-taxonomy.md) records the current Solidarity properties,
  controlled values, forms, automations, and organizer/developer governance contract.
- [`events-and-solidarity.md`](events-and-solidarity.md) records the supported Solidarity event
  authoring, normalization, and import operation.
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

The other top-level guides and `ops/` runbooks were also imported and are non-operational donor
history. Some still contain Baseline names, old migration counts, removed routes, or excluded
provider instructions. Do not use them to provision or operate WCU unless a current WCU source
explicitly adopts the instruction. Hosted deployment remains blocked on the WCU UI, enabled-provider
certification, and a separately approved cutover.
