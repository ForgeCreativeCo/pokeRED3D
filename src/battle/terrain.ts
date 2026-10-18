// Which background a battle gets: BattleSetup_GetTerrainId (src/battle_setup.c)
// from the tile the player stands on and the map's type, then the map's battle
// scene (GetBattleTerrainOverride in src/battle_bg.c) where it isn't NORMAL.

const SURFABLE = new Set([
  'MB_POND_WATER', 'MB_FAST_WATER', 'MB_DEEP_WATER', 'MB_WATERFALL', 'MB_OCEAN_WATER', 'MB_UNUSED_WATER', 'MB_CYCLING_ROAD_WATER',
  'MB_EASTWARD_CURRENT', 'MB_WESTWARD_CURRENT', 'MB_NORTHWARD_CURRENT', 'MB_SOUTHWARD_CURRENT',
]);
/** sMapBattleSceneMapping */
const SCENES: Record<string, string> = {
  MAP_BATTLE_SCENE_GYM: 'BATTLE_TERRAIN_GYM', MAP_BATTLE_SCENE_INDOOR_1: 'BATTLE_TERRAIN_INDOOR_1', MAP_BATTLE_SCENE_INDOOR_2: 'BATTLE_TERRAIN_INDOOR_2',
  MAP_BATTLE_SCENE_LORELEI: 'BATTLE_TERRAIN_LORELEI', MAP_BATTLE_SCENE_BRUNO: 'BATTLE_TERRAIN_BRUNO', MAP_BATTLE_SCENE_AGATHA: 'BATTLE_TERRAIN_AGATHA',
  MAP_BATTLE_SCENE_LANCE: 'BATTLE_TERRAIN_LANCE', MAP_BATTLE_SCENE_LINK: 'BATTLE_TERRAIN_LINK',
};

/** BATTLE_TERRAIN_… for a battle started on a tile with this behavior, on a map of this type and battle scene. */
export function battleTerrain(behavior: string, mapType: string, battleScene = 'MAP_BATTLE_SCENE_NORMAL'): string {
  if (battleScene !== 'MAP_BATTLE_SCENE_NORMAL' && SCENES[battleScene]) return SCENES[battleScene];
  if (behavior === 'MB_TALL_GRASS' || behavior === 'MB_CYCLING_ROAD_PULL_DOWN_GRASS') return 'BATTLE_TERRAIN_GRASS';
  if (behavior === 'MB_UNUSED_01') return 'BATTLE_TERRAIN_LONG_GRASS';
  if (behavior === 'MB_SAND' || behavior === 'MB_SHALLOW_WATER') return 'BATTLE_TERRAIN_SAND';
  switch (mapType) {
    case 'MAP_TYPE_UNDERGROUND':
      if (behavior === 'MB_INDOOR_ENCOUNTER') return 'BATTLE_TERRAIN_BUILDING';
      return SURFABLE.has(behavior) ? 'BATTLE_TERRAIN_POND' : 'BATTLE_TERRAIN_CAVE';
    case 'MAP_TYPE_INDOOR':
    case 'MAP_TYPE_SECRET_BASE':
      return 'BATTLE_TERRAIN_BUILDING';
    case 'MAP_TYPE_UNDERWATER':
      return 'BATTLE_TERRAIN_UNDERWATER';
    case 'MAP_TYPE_OCEAN_ROUTE':
      return SURFABLE.has(behavior) ? 'BATTLE_TERRAIN_WATER' : 'BATTLE_TERRAIN_PLAIN';
  }
  if (['MB_DEEP_WATER', 'MB_FAST_WATER', 'MB_OCEAN_WATER'].includes(behavior)) return 'BATTLE_TERRAIN_WATER';
  if (SURFABLE.has(behavior)) return 'BATTLE_TERRAIN_POND';
  if (behavior === 'MB_MOUNTAIN_TOP') return 'BATTLE_TERRAIN_MOUNTAIN';
  return 'BATTLE_TERRAIN_PLAIN';
}
