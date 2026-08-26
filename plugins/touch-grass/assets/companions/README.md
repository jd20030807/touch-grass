# Companion assets

Bundled cat companions live in one directory per cat. Touch Grass ships with Nian and You, both based on the project's real-life model cats. Each pack contains all six required animations and is registered in `manifest.json`.

Each companion directory may contain:

```text
water.gif
stretch.gif
snack.gif
walk.gif
eyes.gif
bedtime.gif
```

GIF and animated WebP are supported. Keep each asset under 2 MB and readable in a 92 × 104 px vignette; transparent backgrounds are preferred. The bundled Nian and You GIFs use eight restrained motion frames per loop. Custom packs may use a different frame count, but eight or more closely spaced poses generally look smoother than a short pose-to-pose loop. All six actions are required for a complete cat pack. The bedtime animation serves both the wind-down and bedtime stages. The action-icon placeholder remains a failure fallback rather than normal product art.

Users can keep personal assets anywhere on their computer and import them with:

```bash
touch-grass companions add <id> --name "Cat name" --dir /absolute/path/to/assets
```

The import command rejects an incomplete pack instead of silently showing a non-cat fallback.
