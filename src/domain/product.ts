export type ProductCategory =
  | "smartphone"
  | "tablet"
  | "game_console"
  | "camera"
  | "computer"
  | "home_appliance"
  | "audio"
  | "other";

export type ProductCondition =
  | "new"
  | "unused"
  | "used"
  | "refurbished"
  | "unknown";

export type ProductAttributes = Record<string, unknown>;
