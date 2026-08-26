# Companion assets

Bundled cat companions will live in one directory per cat. The first two cats are intentionally left open until their real-life references and art direction are available.

Each companion directory may contain:

```text
water.gif
stretch.gif
snack.gif
walk.gif
eyes.gif
nap.gif
```

Animated WebP and still PNG/JPEG files also work. Keep each asset approximately square, under 2 MB, and readable at 160 px. Transparent backgrounds are preferred. The runtime falls back to the matching action icon when a file is absent.

Users can keep personal assets anywhere on their computer and import them with:

```bash
touch-grass companions add <id> --name "Cat name" --dir /absolute/path/to/assets
```
