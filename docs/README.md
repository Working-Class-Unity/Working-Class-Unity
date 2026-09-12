# Documentation

These guides describe the public WCU website and its events-only database.

- [Architecture](architecture.md): application boundaries and hosted integrations.
- [Release scope](basic-release.md): public pages, Stripe links, and excluded capabilities.
- [CSS and interface](baseline/css-and-interface.md): the current interface contract; component
  inventory and frontend instructions are in [app/AGENTS.md](../app/AGENTS.md).
- [Events and Solidarity](events-and-solidarity.md): event metadata and importer contract.
- [On-demand event sync](solidarity-event-sync.md): collect, review, and apply event updates.
- [Solidarity taxonomy](solidarity-taxonomy.md): organizer-owned fields, hosted forms, and tags.
- [Database cutover](database-cutover.md): convert the retired database into a new events-only file.
- [Deployment](deployment.md), [verification](ci.md), [Cloudflare](cloudflare.md), and
  [observability](observability.md): application operation.
- [Public discovery](website-discovery.md): localized metadata, sitemap, robots, and llms.txt.
- [Rebuild provenance](wcu-rebuild-provenance.md): source history and the current simplification.
- [Hero assets](hero-assets.md), [Flock overview assets](flock-overview-assets.md), and
  [long-form visualizations](design/long-form-visualizations/README.md): presentation assets and
  their source records.

Operational recovery instructions live in [ops](../ops/production.md). Production records, source
captures, database files, and credentials stay outside Git. Documentation describes commands and
boundaries; it is not evidence that a deployment or provider change has occurred.

Obsolete account, billing, AI, Files, and donor audit guides have been removed from the current tree.
Their history remains available in Git. Public campaign content and its factual sources are retained.
