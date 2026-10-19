// Bakes one map into the runtime format: a logic grid plus textured quads.
//
// World space: x = map column, z = map row (south is +z), y = up. 1 unit = 1
// tile. A quad's corners are [bottom-left, bottom-right, top-right, top-left]
// as seen in its texture, and `uv` is the pixel rect [u0, v0, u1, v1] in the
// atlas (v grows downward), so the texture's bottom edge maps to p0-p1.

import { readMap, readLayout, tilesetPair, metatileFor, mapNameById, newGame, NUM_METATILES_IN_PRIMARY } from './decomp.js';
import { renderMetatile, Image, AtlasPacker } from './raster.js';
import { readSprite } from './sprites.js';

export const FORMAT = { name: 'pokered3d-map', version: 1 };

const DIRS = [[0, -1, 'north'], [1, 0, 'east'], [0, 1, 'south'], [-1, 0, 'west']];

export function bakeMap(name, rules, lookup) {
  const map = readMap(name);
  const layout = readLayout(map.layout);
  const pair = tilesetPair(layout);
  const { width: W, height: H } = layout;
  const mapRules = rules.map(name);
  const S = rules.standup;

  const idx = (x, y) => y * W + x;
  const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H;
  const cells = layout.cells.map((c, i) => {
    const key = `${(c.metatile < NUM_METATILES_IN_PRIMARY ? pair.primary : pair.secondary).key}:${c.metatile}`;
    const e = lookup[key];
    if (!e) throw new Error(`${name}: no classification for ${key}`);
    return { ...c, x: i % W, y: Math.floor(i / W), e, walkable: !c.collision };
  });
  const cell = (x, y) => (inside(x, y) ? cells[idx(x, y)] : null);

  // ---- height ----
  const heightRule = rules.height;
  for (const c of cells) {
    if (heightRule.inherit.includes(c.elevation)) c.h = null;
    else c.h = heightRule.elevations?.[c.elevation] ?? (c.elevation - heightRule.ground_elevation) * heightRule.step;
  }
  // Cells with no height of their own take the nearest walkable cell's (BFS).
  {
    const queue = cells.filter((c) => c.h !== null);
    for (let q = 0; q < queue.length; q++) {
      const c = queue[q];
      for (const [dx, dy] of DIRS) {
        const n = cell(c.x + dx, c.y + dy);
        if (n && n.h === null) { n.h = c.h; queue.push(n); }
      }
    }
    for (const c of cells) if (c.h === null) c.h = 0;
  }
  if (heightRule.flat_indoors && map.map_type === 'MAP_TYPE_INDOOR') for (const c of cells) c.h = 0;

  // Nearest plain walkable ground for every cell: the texture to fill under
  // objects, and the background to cut out of them.
  const plainGround = (c) => c.walkable && !c.e.top && c.e.class === 'ground';
  const nearestGround = new Map();
  {
    const queue = cells.filter(plainGround);
    queue.forEach((c) => nearestGround.set(c, c));
    for (let q = 0; q < queue.length; q++) {
      const c = queue[q];
      for (const [dx, dy] of DIRS) {
        const n = cell(c.x + dx, c.y + dy);
        if (n && !nearestGround.has(n)) { nearestGround.set(n, nearestGround.get(c)); queue.push(n); }
      }
    }
  }

  // ---- what stands up ----
  const buildingClasses = new Set(S.buildings.classes);
  const objectRules = S.objects;
  const isBuildingCell = (c) => buildingClasses.has(c.e.class) || (c.walkable && c.e.top && buildingClasses.has(c.e.top));
  const objectClassOf = (c) => {
    if (objectRules[c.e.class] && (!c.walkable || objectRules[c.e.class].walkable)) return c.e.class;
    if (c.walkable && c.e.top && objectRules[c.e.top]) return c.e.top; // overhang over a walkable cell
    return null;
  };

  const packer = new AtlasPacker(1024);
  const quads = [];
  const quad = (kind, p, uv, alpha = false) => quads.push({ k: kind, p: p.flat().map((v) => +v.toFixed(4)), uv, a: alpha ? 1 : 0 });

  /** Stack metatile images vertically, top row first. */
  const stack = (list) => {
    const img = new Image(16, 16 * list.length);
    list.forEach((m, i) => img.blit(m, 0, i * 16));
    return img;
  };
  const objectLayer = (c) => {
    // A walk-behind overhang stands up only its second layer: the first is the ground.
    if (c.walkable && c.e.top) return renderMetatile(pair, c.metatile, { layers: [1], backdrop: false });
    const img = renderMetatile(pair, c.metatile);
    if (S.object_cutout === 'background') {
      const bg = nearestGround.get(c);
      if (bg) cutBackground(img, renderMetatile(pair, bg.metatile));
    }
    return img;
  };

  // ---- buildings: connected regions, built per column ----
  const seen = new Set();
  const buildings = [];
  for (const start of cells) {
    if (seen.has(start) || !isBuildingCell(start)) continue;
    const comp = [];
    const queue = [start];
    seen.add(start);
    while (queue.length) {
      const c = queue.pop();
      comp.push(c);
      for (const [dx, dy] of DIRS) {
        const n = cell(c.x + dx, c.y + dy);
        if (n && !seen.has(n) && isBuildingCell(n)) { seen.add(n); queue.push(n); }
      }
    }
    // Walk-behind rows alone (no blocked cells) aren't a building.
    if (comp.every((c) => c.walkable)) { comp.forEach((c) => seen.delete(c)); continue; }
    buildings.push(comp);
  }

  const wallClasses = new Set(['wall', 'door']);
  // Rooms have no roofs: indoors, each column of the back wall stands its whole stack up.
  const fullWalls = S.buildings.indoor_full_walls && map.map_type === 'MAP_TYPE_INDOOR';
  const perRow = (map.map_type === 'MAP_TYPE_INDOOR' && S.buildings.indoor_wall_height_per_row) || S.buildings.wall_height_per_row;
  for (const comp of buildings) {
    const columns = new Map();
    for (const c of comp) {
      if (!columns.has(c.x)) columns.set(c.x, []);
      columns.get(c.x).push(c);
    }
    const cols = [...columns.entries()].sort((a, b) => a[0] - b[0]).map(([x, list]) => {
      list.sort((a, b) => a.y - b.y);
      // Furniture against a room's back wall (counters, shelves, the TV) is painted
      // as the wall's lower rows: stand it up with the wall so the wall top stays level.
      if (fullWalls) {
        for (let n = cell(x, list[list.length - 1].y + 1); n && !n.walkable && !seen.has(n) && S.buildings.indoor_wall_furniture?.includes(n.e.class); n = cell(x, n.y + 1)) {
          seen.add(n);
          list.push(n);
        }
      }
      let wallRows = 0;
      for (let i = list.length - 1; i >= 0 && wallClasses.has(list[i].e.class) && !list[i].walkable; i--) wallRows++;
      return { x, list, wallRows };
    });
    // A room's back wall stands only as deep as most of its columns. Rows that
    // reach further into the room (the foot of a staircase, the railing round
    // a stairwell going down) are drawn on the floor: standing up, they'd tower.
    if (fullWalls) {
      const top = Math.min(...cols.map((c) => c.list[0].y));
      const depth = mode(cols.map((c) => c.list.length));
      for (const col of cols) while (col.list.length > 1 && col.list[col.list.length - 1].y >= top + depth) seen.delete(col.list.pop());
    }
    // One wall height for the whole building keeps the roof line straight.
    const rowsMode = mode(cols.map((c) => c.wallRows).filter((n) => n > 0)) ?? S.buildings.min_wall_rows;
    const wallH = Math.max(rowsMode, S.buildings.min_wall_rows) * perRow;
    const rise = S.buildings.roof_rise;
    const front = Math.max(...comp.map((c) => c.y)) + 1;
    const base = cell(cols[0].x, front)?.h ?? Math.min(...comp.map((c) => c.h));

    for (const col of cols) {
      const { x, list } = col;
      const zFront = list[list.length - 1].y + 1;
      const zBack = list[0].y;
      const nWall = fullWalls ? list.length : Math.max(col.wallRows, S.buildings.min_wall_rows);
      const colH = fullWalls ? nWall * perRow : wallH;
      const wallCells = list.slice(list.length - nWall);
      const roofCells = list.slice(0, list.length - nWall);

      const wallUv = packer.add(stack(wallCells.map((c) => renderMetatile(pair, c.metatile))));
      quad('wall', [[x, base, zFront], [x + 1, base, zFront], [x + 1, base + colH, zFront], [x, base + colH, zFront]], wallUv);

      if (roofCells.length) {
        const roofUv = packer.add(stack(roofCells.map((c) => (c.walkable ? objectLayer(c) : renderMetatile(pair, c.metatile)))));
        quad('roof', [[x, base + wallH, zFront], [x + 1, base + wallH, zFront], [x + 1, base + wallH + rise, zBack], [x, base + wallH + rise, zBack]], roofUv, list[0].walkable);
      }
      col.zFront = zFront; col.zBack = zBack; col.wallUv = wallUv; col.h = colH; col.rise = roofCells.length ? rise : 0;
    }
    if (S.buildings.sides) {
      for (const [col, sx, edge] of [[cols[0], cols[0].x, 0], [cols[cols.length - 1], cols[cols.length - 1].x + 1, 1]]) {
        // Stop at the first solid row: a walk-behind row only has the roof's
        // edge painted in it, so the side would poke up past the visible roof.
        const solidBack = col.list.find((c) => !c.walkable)?.y ?? col.zBack;
        const t = (col.zFront - solidBack) / (col.zFront - col.zBack);
        // A strip from just inside the wall (past its outline), stretched over the side.
        const [u0, v0, u1, v1] = col.wallUv;
        const uv = edge ? [u1 - 6, v0, u1 - 4, v1] : [u0 + 4, v0, u0 + 6, v1];
        // With no roof (a room's back wall) the top is level: no slope to follow.
        quad('side', [[sx, base, solidBack], [sx, base, col.zFront], [sx, base + col.h, col.zFront], [sx, base + col.h + col.rise * t, solidBack]], uv);
      }
    }
    buildings[buildings.indexOf(comp)] = { cells: comp.length, front, wallHeight: wallH, x0: cols[0].x, x1: cols[cols.length - 1].x + 1 };
  }
  const inBuilding = new Set();
  for (const c of seen) inBuilding.add(c);

  // ---- objects: per-column stacks, chunked from the bottom ----
  const objects = [];
  // Indoors, freestanding props (beds, tables, machines) are drawn top-down in
  // the art, so they become low blocks instead of standing up.
  const blocks = S.blocks && (S.blocks.maps !== 'indoor' || map.map_type === 'MAP_TYPE_INDOOR') ? S.blocks : null;
  const asBlock = (cls) => !!blocks?.classes.includes(cls);
  const flatOverhangs = new Set();
  for (let x = 0; x < W; x++) {
    let y = H - 1;
    while (y >= 0) {
      const c = cell(x, y);
      const cls = inBuilding.has(c) ? null : objectClassOf(c);
      if (!cls) { y--; continue; }
      // Run of same-class object cells going up from here.
      const run = [];
      let yy = y;
      while (yy >= 0) {
        const n = cell(x, yy);
        if (inBuilding.has(n) || objectClassOf(n) !== cls) break;
        run.push(n);
        yy--;
        if (n.walkable && n.e.top) break; // an overhang is always the top of its stack
      }
      const r = { max_rows: 1, height_per_row: 1, lean: 0, ...objectRules[cls] };
      for (let i = 0; i < run.length; i += r.max_rows) {
        let chunk = run.slice(i, i + r.max_rows);
        // Don't leave a lone overhang as its own chunk; fold it into this one.
        if (i + r.max_rows === run.length - 1 && run[run.length - 1].e.top) { chunk = run.slice(i); i++; }
        const bottom = chunk[0];
        const zf = bottom.y + 1;
        const h0 = bottom.h;
        if (asBlock(cls)) {
          // A walk-behind edge with nothing under it stays flat art.
          if (chunk.every((c) => c.walkable)) { chunk.forEach((c) => flatOverhangs.add(c)); continue; }
          // Low block: the art on a raised top, and a short front face.
          const hb = blocks.height, zb = zf - chunk.length;
          const uvTop = packer.add(stack([...chunk].reverse().map((c) => renderMetatile(pair, c.metatile))));
          quad('block', [[x, h0 + hb, zf], [x + 1, h0 + hb, zf], [x + 1, h0 + hb, zb], [x, h0 + hb, zb]], uvTop);
          quad('block', [[x, h0, zf], [x + 1, h0, zf], [x + 1, h0 + hb, zf], [x, h0 + hb, zf]], [uvTop[0], uvTop[3] - 3, uvTop[2], uvTop[3]]);
          objects.push({ class: cls, x, y: bottom.y, rows: chunk.length, block: true });
          continue;
        }
        const ht = chunk.length * r.height_per_row;
        const lean = (r.lean * Math.PI) / 180;
        const top = [h0 + ht * Math.cos(lean), zf - ht * Math.sin(lean)];
        const uv = packer.add(stack([...chunk].reverse().map(objectLayer)));
        quad(cls, [[x, h0, zf], [x + 1, h0, zf], [x + 1, top[0], top[1]], [x, top[0], top[1]]], uv, true);
        objects.push({ class: cls, x, y: bottom.y, rows: chunk.length });
      }
      y = yy;
    }
  }
  const standing = new Map(); // cell -> object class standing on it
  for (const o of objects) for (let r = 0; r < o.rows; r++) standing.set(cell(o.x, o.y - r), o.class);

  // ---- ground ----
  // The flat art under anything that stood up still has it painted in.
  const groundImg = new Image(W * 16, H * 16);
  for (const c of cells) {
    let img;
    if (flatOverhangs.has(c)) {
      img = renderMetatile(pair, c.metatile);
    } else if (c.walkable && c.e.top) {
      img = renderMetatile(pair, c.metatile, { layers: [0] }); // overhang: ground is the first layer
    } else if (!inBuilding.has(c) && objectRules[standing.get(c)]?.ground === 'keep') {
      img = renderMetatile(pair, c.metatile);
    } else if (inBuilding.has(c) || (standing.has(c) && !c.walkable)) {
      img = renderMetatile(pair, (nearestGround.get(c) ?? c).metatile);
      if (objectRules[standing.get(c)]?.ground === 'shade') darken(img, S.shade_amount);
    } else {
      img = renderMetatile(pair, c.metatile);
    }
    groundImg.blit(img, c.x * 16, c.y * 16);
  }
  const g = packer.add(groundImg);

  // ---- the original flat GBA view, for side-by-side comparison ----
  // FireRed draws a metatile's first layer below sprites, and its second
  // layer below them only for "covered" metatiles; otherwise above.
  const below = new Image(W * 16, H * 16), above = new Image(W * 16, H * 16);
  for (const c of cells) {
    const covered = metatileFor(pair, c.metatile).layerType === 'covered';
    below.blit(renderMetatile(pair, c.metatile, { layers: covered ? [0, 1] : [0] }), c.x * 16, c.y * 16);
    if (!covered) above.blit(renderMetatile(pair, c.metatile, { layers: [1], backdrop: false }), c.x * 16, c.y * 16);
  }
  const borderImg = new Image(layout.border_width * 16, layout.border_height * 16);
  layout.border.forEach((c, i) => borderImg.blit(renderMetatile(pair, c.metatile), (i % layout.border_width) * 16, Math.floor(i / layout.border_width) * 16));
  const original = { below: packer.add(below), above: packer.add(above), border: packer.add(borderImg) };
  for (const c of cells) {
    const [u, v] = [g[0] + c.x * 16, g[1] + c.y * 16];
    const { x, y: z, h } = c;
    if (rules.classes[c.e.class].geometry === 'none') continue; // void: nothing to draw
    quad(c.e.class === 'water' ? 'water' : 'ground', [[x, h, z + 1], [x + 1, h, z + 1], [x + 1, h, z], [x, h, z]], [u, v, u + 16, v + 16]);
    if (!rules.height.step_faces) continue;
    for (const [dx, dy, dir] of DIRS) {
      const n = cell(x + dx, z + dy);
      if (!n || n.h >= h) continue;
      // Vertical face down to the lower neighbour, textured with this cell's edge pixels.
      const lo = n.h;
      const edges = {
        south: [[x, lo, z + 1], [x + 1, lo, z + 1], [x + 1, h, z + 1], [x, h, z + 1], [u, v + 13, u + 16, v + 16]],
        north: [[x + 1, lo, z], [x, lo, z], [x, h, z], [x + 1, h, z], [u, v, u + 16, v + 3]],
        east: [[x + 1, lo, z + 1], [x + 1, lo, z], [x + 1, h, z], [x + 1, h, z + 1], [u + 13, v, u + 16, v + 16]],
        west: [[x, lo, z], [x, lo, z + 1], [x, h, z + 1], [x, h, z], [u, v, u + 3, v + 16]],
      };
      const [p0, p1, p2, p3, uv] = edges[dir];
      quad('step', [p0, p1, p2, p3], uv);
    }
  }

  // ---- sprites ----
  const B = rules.billboards;
  const { hiddenFlags } = newGame();
  const sprites = {};
  for (const gfx of new Set([B.player, ...(map.object_events ?? []).map((o) => o.graphics_id)])) {
    try {
      const s = readSprite(gfx);
      sprites[gfx] = { width: s.width, height: s.height, shadow: B.shadows?.[s.shadowSize] ?? 0.3, frames: s.frames.map((f) => packer.add(f)) };
    } catch (err) {
      console.warn(`  ${name}: no sprite for ${gfx} (${err.message}); it will show as a marker`);
    }
  }
  const facings = { MOVEMENT_TYPE_FACE_UP: 'up', MOVEMENT_TYPE_FACE_DOWN: 'down', MOVEMENT_TYPE_FACE_LEFT: 'left', MOVEMENT_TYPE_FACE_RIGHT: 'right' };

  const cameraName = mapRules.camera ?? (map.map_type === 'MAP_TYPE_INDOOR' ? 'interior' : 'default');
  return {
    atlas: packer.build(),
    data: {
      format: FORMAT,
      name,
      id: map.id,
      width: W,
      height: H,
      camera: { preset: cameraName, ...rules.cameras[cameraName] },
      grid: {
        walkable: cells.map((c) => (c.walkable ? 1 : 0)),
        height: cells.map((c) => +c.h.toFixed(3)),
        elevation: cells.map((c) => c.elevation),
        behavior: cells.map((c) => c.e.behavior),
        // The metatile's encounter type: 0 none, 1 land (tall grass, caves), 2 water.
        encounter: cells.map((c) => c.e.encounterType ?? 0),
        class: cells.map((c) => c.e.class),
      },
      connections: map.connections ?? [],
      indoor: map.map_type === 'MAP_TYPE_INDOOR',
      /** MAP_TYPE_ROUTE, …, and MAP_BATTLE_SCENE_NORMAL, …: together with the tile you stand on they pick the battle background */
      mapType: map.map_type,
      battleScene: map.battle_scene,
      music: map.music,
      warps: (map.warp_events ?? []).map((w) => ({
        x: w.x, y: w.y, behavior: cells[idx(w.x, w.y)].e.behavior,
        to: mapNameById(w.dest_map) ?? null, toWarp: Number(w.dest_warp_id),
      })),
      objects: (map.object_events ?? []).map((o) => ({
        id: o.local_id, gfx: o.graphics_id, x: o.x, y: o.y, elevation: o.elevation,
        movement: o.movement_type, facing: facings[o.movement_type] ?? 'down',
        range: [o.movement_range_x ?? 0, o.movement_range_y ?? 0],
        hidden: hiddenFlags.has(o.flag), flag: o.flag, script: o.script,
      })),
      sprites,
      billboards: { player: B.player, lean: B.lean, matchScreenSize: B.match_screen_size, feetOffset: B.feet_offset, stepSeconds: B.step_seconds },
      signs: (map.bg_events ?? []).map((b) => ({ type: b.type, x: b.x, y: b.y, script: b.script })),
      // Step-on triggers: run `script` when the player steps here while `var` equals `value`.
      triggers: (map.coord_events ?? []).filter((c) => c.type === 'trigger').map((c) => ({ x: c.x, y: c.y, var: c.var, value: c.var_value, script: c.script })),
      mapScripts: `${name}_MapScripts`,
      structures: { buildings, objects },
      atlas: { file: 'atlas.png' },
      original,
      quads,
    },
  };
}

function darken(img, amount) {
  for (let i = 0; i < img.data.length; i += 4) for (let c = 0; c < 3; c++) img.data[i + c] *= 1 - amount;
}

/** Make pixels of img that exactly match bg transparent. */
function cutBackground(img, bg) {
  for (let i = 0; i < img.data.length; i += 4) {
    if (img.data[i] === bg.data[i] && img.data[i + 1] === bg.data[i + 1] && img.data[i + 2] === bg.data[i + 2]) img.data[i + 3] = 0;
  }
}

function mode(xs) {
  const counts = new Map();
  for (const x of xs) counts.set(x, (counts.get(x) ?? 0) + 1);
  return [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
}
