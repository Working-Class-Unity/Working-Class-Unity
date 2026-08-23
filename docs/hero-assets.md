# Homepage hero assets

## Add or remove wall photos

Put supported image files in `app/assets/images/hero-wall/source/`, or remove them from that directory. JPEG,
PNG, WebP, and AVIF sources are supported. The next `pnpm dev` or `pnpm build` regenerates the wall automatically;
run `pnpm assets:generate` when you want to refresh it directly.

The generator auto-orients every source, removes embedded metadata, preserves its aspect ratio, never upscales it,
and writes content-hashed AVIF and WebP variants plus `app/generated/hero-assets.json`. Commit the canonical sources,
manifest, and generated files together. `pnpm assets:check` fails when any of them drift.

The wall shuffles its order in the browser on each page load and balances the photos across two mixed-aspect lanes,
so adding a photo does not require a Vue or CSS edit.

## Replace the landscape backgrounds

Keep the three expected filenames in `app/assets/images/hero-background/source/`:

- `landscape.png` for wide screens
- `portrait.png` for tablets
- `portrait-tall.png` for phones

Then run `pnpm assets:generate`. Confirm publishing rights and consent for every supplied image before deployment.
