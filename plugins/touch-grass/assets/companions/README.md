# Companion assets

Bundled cat companions live in one directory per cat. The first two directories are intentionally absent until their real-life references and art direction are available. Add them to `manifest.json` only after every required animation is ready.

Each companion directory may contain:

```text
water.gif
stretch.gif
snack.gif
walk.gif
eyes.gif
bedtime.gif
```

GIF and animated WebP are supported. Keep each asset under 2 MB and readable in a 92 × 104 px vignette; transparent backgrounds are preferred. All six actions are required for a complete cat pack. The bedtime animation serves both the wind-down and bedtime stages. The action-icon placeholder exists only for development and blocks release readiness.

Users can keep personal assets anywhere on their computer and import them with:

```bash
touch-grass companions add <id> --name "Cat name" --dir /absolute/path/to/assets
```

The import command rejects an incomplete pack instead of silently showing a non-cat fallback.
