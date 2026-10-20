# The view style

How pokeRED3D looks, and the rules that keep it looking that way as more of
the game is baked. Every map, indoors and out, should follow these. The
numbers live in `rules/*.yaml` and are applied by the baker, so a new map
gets the style by being baked. Map-by-map tweaks are the exception.

The reference is the "voxel" look: a close, low camera behind the player,
chunky 3D scenery, and flat 2D people at true size.

## Camera: close and low, everywhere

| Preset | pitch | fov | view | Used by |
|---|---|---|---|---|
| `default` | 25 | 50 | 8 | outdoor maps |
| `interior` | 25 | 50 | 8 | indoor maps |

(`rules/camera.yaml`.) The camera sits about 8 tiles behind the player and
about 3.6 tiles up, looking north.

- **Why so close:** to hide the player, a building has to fit between the
  camera and the player. With the camera close, few can. Don't pull the
  camera back to "see more": that brings back the occlusion problem.
- **Indoors and out match.** Going through a door shouldn't change the
  camera.
- A map that really needs a different camera (a tight cave, say) gets its
  own preset in `camera.yaml`, picked in `rules/maps/<Map>.yaml`. Don't
  change `default` for one map.

## People: true size, nearly upright

`rules/billboards.yaml`:

- `match_screen_size: false`. A sprite stands 1 tile per 16 px of art, so
  Red is 2 tiles tall (his figure is about 19 px, so about 1.2 tiles). The
  old setting matched FireRed's on-screen size, which shrank people next to
  the walls at a low pitch.
- `lean: 5`. Almost upright, since the camera already looks at them nearly
  head-on.
- People stay flat cards that turn to face the camera. That's part of the
  look; they're not voxelised.

## Scale: the door is the yardstick

FireRed's art isn't to scale: a door (one wall row, about 15 px) is drawn
shorter than Red (about 19 px). The rule is that **a door stands about 1.2×
Red's height**, as a real one would.

| Setting (`standup.yaml` → `buildings`) | Value | Effect |
|---|---|---|
| `wall_height_per_row` | 1.5 | outdoor walls: a door ≈ 1.4 tiles; a two-row house front = 3 tiles, two storeys |
| `roof_rise` | 0.9 | roof slope, scaled up to match the taller walls |
| `indoor_wall_height_per_row` | 1.0 | rooms: counters and shelves painted on the wall stay below Red's head |

Use the door as the yardstick when adding new kinds of scenery (gyms,
caves, the Pokémon Center): it should come out a little taller than Red, and
everything else follows from it. Check with Red standing in front of a door.

## Buildings outdoors

- Per column, the bottom run of wall rows stands up as the front face at
  1.5 tiles a row. The rest of the footprint becomes a roof sloping back.
- The whole building uses one wall height (the most common one), so the roof
  line stays straight.
- Side walls close the ends. They only follow a roof slope when the column
  has a roof.
- **A building is what's joined to a door**, whatever its size or colour
  (`classifier.yaml`). Viridian's houses are only 3 rows tall with green
  roofs, and stood up as leaning tree cards before this; the gym's set-back
  wings stood as props.
- **Green eaves are roof** (`green_eaves`). A green row above the bottom
  wall row is the roof's eaves, so a green-roofed house is one storey, not a
  green "second floor".
- **Signs painted on a front are wall** (the P.C and MART signs).
- **No door, no slope.** Cliffs and rock are drawn like buildings, but with
  a level top.

## Rooms

Rooms are drawn top-down in FireRed, so standing everything up would be
wrong. The rules (`standup.yaml`):

- **The back wall stands at full height** (`indoor_full_walls`). Each column
  stands all its rows up, not just the bottom run, since rooms have no roofs.
- **The back wall is everything blocked from the top of a column down to
  the floor** (`indoor_back_wall`), whatever its tiles are classed as. Tile
  classes come from every map using a tileset, and back-wall tiles get it
  wrong: in the Pokémon Center the wall behind the nurse is walkable in other
  layouts, the machine top in the corner is green enough to be a "tree", and
  a plant's leaves leave the top row walkable. Classed by tile, each left a
  hole or a stub in the wall. The top row counts even where it's walkable.
- **Furniture against the back wall joins it** (`indoor_wall_furniture:
  [furniture, counter]`). Counters, shelves and the TV are painted as the
  wall's lower rows, so they stand with it and the top of the wall stays level.
- **The back wall is only as deep as most of its columns.** Rows that reach
  further into the room lie flat on the floor. That covers the foot of a
  staircase and the railing around a stairwell going down: standing up, they
  made 3–4 tile towers.
- **Freestanding props** (beds, tables, the lab machine) stay low blocks
  (`blocks`).
- **Counters are low blocks too** (the `counter` class, from `MB_COUNTER`).
  They're drawn from above, with the counter top painted over the nurse's or
  clerk's legs. Standing up with that top row, a counter was 2 tiles tall and
  hid the person behind it; as a block, the nurse shows from the waist up, as
  on the GBA. Shelves stay `furniture` and stand.
- Rooms are flat (`height.yaml` `flat_indoors`).

## Seeing through buildings

A low camera means buildings sometimes cover what you need to see. Two
rules handle it, both in the renderer:

- **The building in the way fades.** Any building between the camera and
  Red (a ray from the camera to his feet or head crosses its box) dithers
  away to a faint screen-door ghost of itself, easing in and out over about
  0.2 s, and comes back once he's clear. Dithering keeps the pixel look and
  needs no transparency sorting. The baker tags each building's walls,
  roof and sides with its index (`b` on a quad), so each building is its
  own mesh. `src/render/buildingFade.ts`; `MAX_FADE` is how much drops out.
- **What matters shows through, faintly, and only nearby:**

| What | How | Where |
|---|---|---|
| Red | dark-blue silhouette wherever something is in front of him; always on | `ActorViews.silhouette` |
| NPCs | the same silhouette, fading in from 7 tiles away, full within 4 | `ActorViews.fadeSilhouettes` |
| Outdoor doors | gold-tinted copy of the door tile, same distance fade | `src/render/doorGhosts.ts` |

The trick is a second copy drawn with `depthFunc: GreaterDepth`: it only
appears where something nearer has already been drawn. Keep the distance
limit: without it, far-off NPCs show through every house.

Walk-behind rows (the roof overhang that hides the player on the GBA)
count as being behind the building: it fades. Trees don't fade; the
silhouette shows Red behind them.

## Checking a new map

After baking a map, walk it in the preview and check:

1. Red in front of a door: the door is a bit taller than him.
2. Behind and between buildings: Red's silhouette shows, and a hidden door
   nearby shows its gold copy.
3. Indoors: the back wall's top edge is level with no holes, nothing towers,
   stairs read as stairs, and whoever stands behind a counter shows above it.
4. Tree rows, fences and signs: nothing pokes through a wall.

If something breaks a rule, fix it in the rule or the baker so every map
gets the fix. Per-map overrides are a last resort.

## Not done yet

- **Voxel-style scenery.** Extruding cut-out objects (trees, fences, flowers,
  signs) pixel by pixel, so they keep their thickness at a low angle. That's
  the next step toward the reference. Voxel roofs and window ledges come
  after.
- **The camera always faces north.** Walking south, you see little of what's
  ahead, since the camera sits there. Turning the camera would change the
  controls.
- **Far scenery.** The low camera sees a long way, so map edges and
  neighbouring maps show more. It may want fog.
