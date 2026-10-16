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
npm run classify -- PalletTown    # classify + debug overlays
npm run bake -- PalletTown Route1 PalletTown_PlayersHouse_2F   # bake maps + a 3D preview
npm run serve                     # preview at http://localhost:5179 (large bakes won't open from disk)
```

Outputs:

- `build/rules/tilesets/<key>.json`: the resolved class of every metatile, with its reasons and stats
- `build/debug/classify.html`: map and tileset views; hover a cell to see why it got its class
- `build/debug/maps/*_classes.png`, `build/debug/tilesets/*_classes.png`: the same overlays as images
- `build/maps/<Map>/map.json` + `atlas.png`: the baked map (format below)
- `build/debug/view3d.html`: 3D preview of every map in the bake. Connected outdoor maps form one area; each interior is its own area, reached through doors, exit mats and stairs. It starts where a new game does (Red's bedroom) when that map is in the bake. Walk with WASD, hop ledges, tune the camera, and compare against the original GBA view. `window.pokered.walk(dir, seconds)` drives it from a script.

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

## Height (`height.yaml`)

Each elevation value maps to a world height. Elevations `0` and `15` have no
height of their own and inherit from the nearest cell that does. Where
neighbours differ (the pond), a vertical step face fills the gap.

## Stand-up (`standup.yaml`)

**Footprint principle:** a 3D object covers exactly the cells the collision
grid blocks for it, plus its walk-behind row. Visuals and gameplay can't
disagree: there are no invisible walls, and roofs and tree tops hide the
player in the walk-behind row just like on the GBA.

- **Buildings** are connected wall/door/roof cells. Per column, the bottom run
  of wall rows stands up as the front face. The rest becomes a roof sloping
  back over the footprint, including the walk-behind row. Side walls close the
  ends.
- **Objects** (trees, props, signs, ledges, furniture) are per-column stacks,
  cut into chunks of `max_rows` from the bottom. Each chunk stands (optionally
  leaning) on the front edge of its bottom cell.
- **Cutouts:** pixels identical to the nearest plain ground tile are made
  transparent. The grass behind a fence disappears, while a forest stays solid.
- **Ground under** anything that stood up is replaced with the nearest plain
  ground, a shaded copy (`ground: shade`, used for forest floor), or left as
  the original art (`ground: keep`, used for ledges).
- **Walkable objects** (`walkable: true`) stand up over cells the player can
  enter. Tall grass uses this: short leaning tufts the player wades into.

## Baked map format (`build/maps/<Map>/map.json`)

```jsonc
{
  "format": { "name": "pokered3d-map", "version": 1 },
  "name": "PalletTown", "width": 24, "height": 20,
  "camera": { "preset": "default", "pitch": 55, "fov": 24, "view": 11 },
  "grid": {            // row-major, width * height
    "walkable": [0, 1, ...], "height": [...], "elevation": [...],
    "behavior": ["MB_NORMAL", ...], "class": ["ground", ...]
  },
  "connections": [...], "warps": [...], "objects": [...], "signs": [...],  // from the decomp map.json
  "structures": { "buildings": [...], "objects": [...] },                   // what the stand-up rule found
  "atlas": { "file": "atlas.png" },
  "quads": [ { "k": "wall", "p": [12 numbers], "uv": [u0, v0, u1, v1], "a": 0 } ]
}
```

- World space: `x` = column, `z` = row (south is +z), `y` = up. 1 unit = 1 tile.
- `p` holds 4 corners: bottom-left, bottom-right, top-right, top-left *as seen in the texture*.
- `uv` is a pixel rect in the atlas with v growing downward. `a: 1` means alpha-tested (cutout).
- `k` is `ground`, `water`, `step`, `wall`, `roof`, `side`, or an object class.

Quads in JSON keep the format engine-neutral. A glTF export for Godot can be
generated from the same data.

## Planned rule sets

| Rule set | Status | Notes |
|---|---|---|
| Metatile classification | **done** | All of the above |
| Animation tagging | **done** | Ranges read from `src/tileset_anims.c` |
| Height | **done** | Cliffs on routes will need real elevation changes to test |
| Stand-up | **done** | Buildings, objects, cutouts, ground under |
| Interiors and warps | **done** | Doors, exit mats, stairs; void, low blocks, flat floors |
| Map connections | **done** | Maps placed by their connection offsets; walk across edges |
| Prop grouping | partly | Buildings are grouped; objects are per-column chunks so far |
| Billboards | **done** | Real overworld sprites from the decomp, yaw-only, screen-size matched, shadows, hidden flags (`billboards.yaml`) |
| Materials and colour | later | Per-class shading, palette grading, water shader |
| Per-map camera | **started** | Presets in `camera.yaml`; `rules/maps/<Map>.yaml` can pick one |

## Interiors

- **Void** (the black around rooms) is detected as blocked and at least 90% black. It draws nothing, and it ends wall columns like the map edge. Void in front of furniture counts as floor, since it's just the room's front edge.
- **Freestanding props** (floor in front and behind, at most 3 rows) aren't walls. Indoors they become **low blocks** (`standup.yaml` `blocks`): art on a raised top with a short front face. Shelves, PCs and TVs (`furniture`, from behaviors) still stand.
- **Interiors are flat** (`height.yaml` `flat_indoors`): indoor elevation only sorts sprites.
- **Visibility** at the start comes from the decomp's new-game flag script, so Oak is hidden but Blue and the starters wait in the lab.
- **Warps** follow FireRed: walk into a door, press the arrow's direction on an exit mat, or step onto stairs. Other cells listed as warps are inert.

### Known gaps

- Rocky cliffs and mountain tops come out as `roof`. The geometry is right (a raised surface), but they want their own class once the height rule exists.
- Shoreline metatiles that share animated water-edge tiles can come out as `ground` or `roof`.
- NPCs with a variable sprite (`OBJ_EVENT_GFX_VAR_*`) are chosen at runtime by the game and show as a placeholder marker.
