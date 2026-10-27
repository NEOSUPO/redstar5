export const APP_NAME = "NEOSUPO★STAR β5";
export const CELL_MM = 100;

export const SHEET = {
  PROJECT: "プロジェクト",
  EQUIPMENT: "機器マスタ",
  LAYOUT: "配置データ",
  DRAWINGS: "図面一覧",
  SETTINGS: "図面設定",
  CANVAS: "図面",
  POWER: "配電",
  LIST: "機器リスト",
};

export const EQUIPMENT_HEADERS = [
  "id",
  "区分",
  "床置or卓上",
  "機器名称",
  "メーカー",
  "型式",
  "数量",
  "W_mm",
  "D_mm",
  "H_mm",
  "重量_kg",
  "電気",
  "給水",
  "排水",
  "給気",
  "排気",
  "特ガス",
  "備考",
  "iso_drive_id",
  "family",
];

export const LAYOUT_HEADERS = [
  "id",
  "kind",
  "ref_id",
  "x_mm",
  "y_mm",
  "w_mm",
  "d_mm",
  "rotation_deg",
  "thickness_mm",
  "label",
  "fill",
  "path",
  "layer",
  "group_id",
  "drawing_id",
  "geom",
  "stroke",
];

export const DRAWING_HEADERS = [
  "id",
  "name",
  "room_w_mm",
  "room_d_mm",
  "wall_thickness_mm",
  "created",
  "note",
];

export const LIST_COLUMNS = {
  id: 1,
  name: 2,
  maker: 3,
  model: 4,
  qty: 5,
  w: 6,
  d: 7,
  h: 8,
  weight: 9,
  power: 10,
  water: 20,
  drain: 22,
  supplyAir: 26,
  exhaust: 28,
  gas: 30,
  note: 32,
};
