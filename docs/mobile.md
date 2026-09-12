# Mobile presentation

The public WCU website uses one responsive Nuxt interface across narrow and wide screens.

- Start with content-driven narrow layouts and semantic HTML.
- Keep expected touch controls at least 44 CSS pixels high.
- Verify public navigation, hosted payment links, calendar controls, and RSVP links on mobile widths.
- Avoid hover-only interactions and preserve keyboard/focus behavior.
- Check long translations, reduced motion, text resizing, and reflow without horizontal overflow.

The [interface contract](baseline/css-and-interface.md) and [app inventory](../app/AGENTS.md) govern
implementation. A native app, app-store wrapper, push notifications, or native background work is
outside this website's scope and requires a separate product decision.
