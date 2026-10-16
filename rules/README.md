# Rule sets

The rules turn FireRed's flat, top-down map data into the tilted 2.5D view.
They are plain data, written by us and committed. The baker applies them
offline. The game only ever loads baked output, never these files.

```
vendor/pokefirered (decomp)  +  rules/*.yaml  ──►  tools/baker  ──►  build/  (gitignored)
```

Everything under `build/` is derived from Nintendo's assets. It stays out of
git and is regenerated locally.

## Running

```bash
npm install
npm run setup:decomp              # once: clones pret/pokefirered into vendor/
npm run classify -- PalletTown    # any map names from vendor/pokefirered/data/maps
```

Outputs:

- `build/rules/tilesets/<key>.json`: the resolved class of every metatile, with its reasons and stats
- `build/debug/classify.html`: map and tileset views; hover a cell to see why it got its class
- `build/debug/maps/*_classes.png`, `build/debug/tilesets/*_classes.png`: the same overlays as images

## How a metatile gets its class

Rules are tried in priority order. Each step can be overridden by the ones after it.

| # | Source | File |
|---|---|---|
| 1 | Shape heuristics, measured over **every placement** on every layout using the tileset | `classifier.yaml` |
| 2 | Metatile behavior (tall grass, water, ledges, doors, signs…) | `behaviors.yaml` |
| 3 | Animated tiles (flowers become `ground_decor`) | `animations.yaml` |
| 4 | Hand overrides | `tilesets/<key>.yaml` |

### The heuristics

- **Walkable or blocked.** Collision lives on map cells, not metatiles, so we count how often each metatile is placed with collision across all maps.
- **Wall or roof.** For a blocked cell, count rows down to walkable ground. With `wall_max_rows` (2) or fewer it's a wall face; above that it's roof. This splits houses and the lab at the right row.
- **Prop.** A blocked column only one cell tall is a fence, mailbox or similar.
- **Tree.** Blocked and mostly green.
- **Overhang (`top`).** On FireRed, a metatile's second layer draws *above* sprites, except for `covered` metatiles. A walkable metatile with enough pixels there has something drawn over the player, such as a roof edge or tree top. It gets `top: <class>`, taken from the cell **below**, because an overhang is the upper part of the object standing there.

### Classes (`classes.yaml`)

Each class has a `geometry`: `flat`, `raised`, `standing`, `billboard` or `none`. That is the contract with the baker: classification decides *what* a tile is, and geometry decides *how* it gets built.

## Map data notes

- **Elevation is not height.** On outdoor maps, walkable ground is usually elevation `3`, blocked cells `0` ("any level") and water `1`. Turning elevation into real height needs its own rule (see below).
- Metatile ids are global: `0x000–0x27F` are the primary tileset, `0x280+` the secondary.

## Planned rule sets

| Rule set | Status | Notes |
|---|---|---|
| Metatile classification | **done** | All of the above |
| Animation tagging | **done** | Ranges read from `src/tileset_anims.c` |
| Height | next | Elevation to height; blocked `0` cells inherit from neighbours; cliffs |
| Stand-up | next | Wall runs stand up from their bottom row; roofs sit on top |
| Prop grouping | next | Connected tree, building and prop cells become one object |
| Billboards | next | NPCs and player: yaw-only quads, shadow blobs, sort order |
| Materials and colour | later | Per-class shading, palette grading, water shader |
| Per-map camera | later | Angle and distance for exteriors vs interiors |

### Known gaps

- Rocky cliffs and mountain tops come out as `roof`. The geometry is right (a raised surface), but they want their own class once the height rule exists.
- Shoreline metatiles that share animated water-edge tiles can come out as `ground` or `roof`.
