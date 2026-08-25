# Mobile Path

## Default Strategy

Use this order:

```text
Responsive Nuxt web app -> product-specific Capacitor or targeted native work -> full native only if justified
```

The baseline keeps one product codebase while mobile demand is still uncertain.

## Responsive Web

- Design narrow screens from the start.
- Use semantic HTML controls.
- Keep primary touch targets at least 44px tall.
- Test forms on mobile browser widths.
- Avoid hover-only interactions.
- Keep pages usable on midrange phones.

## Capacitor Triggers

Consider Capacitor when the product needs app-store distribution, native plugins, native push reliability, camera/filesystem/biometrics/deep-link access, or a mobile shell before a full native rewrite is justified.

## Native Escape Hatches

Use targeted native work before a full rewrite: one native plugin, one native screen, one native background task, or one deep-link bridge. Full native becomes reasonable only when mobile UX, native performance, background behavior, or platform-specific interaction is central to the product.
