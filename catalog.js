/** Shared presets load from catalog.csv. This list is the fallback when that file is missing. Sizes are millimetres. */
export const ROOM_TYPES = [
  ["実験室", "#d5e4f2"],
  ["測定室", "#e7e2f5"],
  ["培養室", "#d9f0e3"],
  ["BSL実験室", "#f6d9d9"],
  ["秤量室", "#f8efd2"],
  ["保管庫", "#e6e6e6"],
  ["フリーザー室", "#d4eef5"],
  ["実験準備室", "#f3e6d8"],
  ["共同機器室", "#dde7f8"],
  ["研究室", "#e8f0d8"],
  ["会議室", "#f7e3d4"],
  ["更衣室", "#eee6f6"],
  ["ロッカールーム", "#e8e8f2"],
  ["ホール", "#f3f0e4"],
  ["階段", "#ececec"],
  ["廊下", "#f4f4f4"],
  ["機械室", "#e5e5e0"],
  ["吹抜", "#f7f7f7"],
  ["PS", "#f6ead9"],
  ["EPS", "#f8e4c8"],
].map(([name, color]) => ({ name, color }));

export const CATALOG = [
  item("hood", "ヒュームフード", ["ライフアイテム", "ヒュームフード"], 1800, 900, 2400, "floor", "#7eafd4"),
  item("bench", "実験台", ["ライフアイテム", "ラボファニチャー"], 1800, 750, 850, "floor", "#e4d0b0"),
  item("sink", "流し台", ["ライフアイテム", "ラボファニチャー"], 1500, 750, 850, "floor", "#d7e3ea"),
  item("balance", "天秤台", ["ライフアイテム", "ラボファニチャー"], 900, 750, 850, "floor", "#efe6d6"),
  item("cabinet", "薬品保管庫", ["ライフアイテム", "ラボファニチャー"], 900, 600, 1800, "floor", "#c9d4c2"),
  item("shower", "緊急シャワー", ["ライフアイテム", "ラボファニチャー"], 400, 400, 2300, "floor", "#f0d36a"),
  item("chair", "ラボチェア", ["ライフアイテム", "ラボファニチャー"], 450, 450, 900, "floor", "#6f8fa8"),
  item("bsc", "安全キャビネット", ["ライフアイテム", "バイオテクノロジー関連設備"], 1500, 800, 2200, "floor", "#f2f6f8"),
  item("clean", "クリーンベンチ", ["ライフアイテム", "クリーン関連設備"], 1500, 800, 1900, "floor", "#e7f3f8"),
  item("outlet", "コンセント 01", ["ライフアイテム", "ユーティリティ", "コンセント"], 140, 80, 120, "wall", "#f4f4f4", { mountHeight: 1200 }),
  item("reel", "リーラーコンセント", ["ライフアイテム", "ユーティリティ", "コンセント"], 150, 150, 1200, "ceiling", "#c5ccd3", { scaleH: [800, 2500] }),
  item("pipe", "配管 直管", ["ライフアイテム", "ユーティリティ", "配管"], 250, 250, 500, "free", "#b7c0c8", { scalable: true }),
  item("elbow", "配管 90度管", ["ライフアイテム", "ユーティリティ", "配管"], 250, 100, 250, "free", "#aeb8c2", { scalable: true }),
  item("board", "盤", ["ライフアイテム", "ユーティリティ", "盤"], 900, 300, 2000, "free", "#e6d7b8", { scalable: true }),
  item("door", "左開き", ["階段/ドア/窓", "ドア"], 900, 40, 2100, "wall", "#c9a27a", { leaf: "door", swing: "single", hand: "left" }),
  item("door-right", "右開き", ["階段/ドア/窓", "ドア"], 900, 40, 2100, "wall", "#c9a27a", { leaf: "door", swing: "single", hand: "right" }),
  item("door-double", "両開き", ["階段/ドア/窓", "ドア"], 1600, 40, 2100, "wall", "#c9a27a", { leaf: "door", swing: "double" }),
  item("door-push", "押し戸", ["階段/ドア/窓", "ドア"], 900, 40, 2100, "wall", "#b9835a", { leaf: "door", swing: "push", hand: "left" }),
  item("door-slide", "引き戸", ["階段/ドア/窓", "ドア"], 1600, 40, 2100, "wall", "#d7c4a8", { leaf: "door", swing: "slide", hand: "left" }),
  item("window", "窓", ["階段/ドア/窓", "窓"], 1400, 40, 1200, "wall", "#b9d7ea", { leaf: "window", swing: "window" }),
  item("pillar", "柱", ["柱/梁", "柱"], 400, 400, 2700, "floor", "#9aa3ad", { scalable: true }),
  item("beam", "梁", ["柱/梁", "梁"], 3000, 300, 400, "ceiling", "#b7b0a4", { scalable: true }),
  item("light", "照明", ["ライフアイテム", "照明"], 600, 600, 80, "ceiling", "#f7f3e8", { light: true }),
  item("toilet", "トイレ", ["設備", "トイレ"], 900, 1600, 2200, "floor", "#e7eef2", { scalable: true }),
  item("wash", "洗面", ["設備", "洗面"], 900, 600, 1800, "floor", "#f4f1ea", { scalable: true }),
];

function item(id, name, category, w, d, h, place, color, extra = {}) {
  return { id, name, category, w, d, h, place, color, price: null, ...extra };
}

export function catalogById(id) {
  return CATALOG.find((entry) => entry.id === id) || null;
}

export function lookupItem(id, extras = []) {
  return extras.find((entry) => entry.id === id) || userCatalog.find((entry) => entry.id === id) || catalogById(id);
}

export function categoryTree(extras = []) {
  const root = [];
  for (const entry of [...CATALOG, ...userCatalog, ...extras]) {
    let level = root;
    for (const name of entry.category) {
      let node = level.find((child) => child.name === name);
      if (!node) {
        node = { name, children: [], items: [] };
        level.push(node);
      }
      level = node.children;
      if (name === entry.category[entry.category.length - 1]) node.items.push(entry);
    }
  }
  return root;
}

const USER_CATALOG_KEY = "neosupo-star-beta5-user-catalog-v1";
const COLUMNS = ["id", "name", "category", "w", "d", "h", "place", "color", "price", "scalable", "light", "residential", "leaf", "swing", "hand", "mountHeight", "scaleH"];
const PLACES = new Set(["floor", "wall", "ceiling", "free"]);
let userCatalog = readUserCatalog();

export async function loadSharedCatalog() {
  try {
    const response = await fetch(new URL("./catalog.csv?v=20261028d", import.meta.url), { cache: "no-cache" });
    if (!response.ok) return;
    const rows = parseCatalogCsv(await response.text());
    if (rows.length) CATALOG.splice(0, CATALOG.length, ...rows);
  } catch (error) {
    console.error(error);
  }
}

export function catalogTemplateCsv() {
  const example = {
    id: "記入例",
    name: "実験台（この行は読み込まれません）",
    category: ["ライフアイテム", "ラボファニチャー"],
    w: 1800,
    d: 750,
    h: 850,
    place: "floor",
    color: "#e4d0b0",
    price: null,
  };
  return `\uFEFF${COLUMNS.join(",")}\n${csvRow(example)}\n`;
}

export function importUserCatalog(text) {
  const shared = new Set(CATALOG.map((entry) => entry.id));
  let added = 0;
  let skipped = 0;
  for (const entry of parseCatalogCsv(text)) {
    if (shared.has(entry.id)) {
      skipped += 1;
      continue;
    }
    const index = userCatalog.findIndex((row) => row.id === entry.id);
    if (index >= 0) userCatalog[index] = entry;
    else userCatalog.push(entry);
    added += 1;
  }
  localStorage.setItem(USER_CATALOG_KEY, JSON.stringify(userCatalog));
  return { added, skipped };
}

export function parseCatalogCsv(text) {
  const table = parseCsv(String(text || "").replace(/^\uFEFF/, ""));
  if (!table.length) return [];
  const header = table[0].map((cell) => cell.trim());
  const column = Object.fromEntries(header.map((name, index) => [name, index]));
  const items = [];
  for (const row of table.slice(1)) {
    if (row.every((cell) => !String(cell).trim())) continue;
    const id = value(row, column, "id");
    const name = value(row, column, "name");
    if (!id || !name || id === "記入例" || name.includes("記入例") || name.includes("読み込まれません")) continue;
    const category = value(row, column, "category").split("|").map((part) => part.trim()).filter(Boolean);
    const place = value(row, column, "place");
    const price = value(row, column, "price");
    const entry = {
      id,
      name,
      category: category.length ? category : ["追加器具"],
      w: number(value(row, column, "w"), 900),
      d: number(value(row, column, "d"), 600),
      h: number(value(row, column, "h"), 800),
      place: PLACES.has(place) ? place : "floor",
      color: value(row, column, "color") || "#d9d3c5",
      price: price === "" ? null : Number(price),
    };
    if (flag(row, column, "scalable")) entry.scalable = true;
    if (flag(row, column, "light")) entry.light = true;
    if (flag(row, column, "residential")) entry.residential = true;
    const leaf = value(row, column, "leaf");
    const swing = value(row, column, "swing");
    const hand = value(row, column, "hand");
    const mount = value(row, column, "mountHeight");
    const scaleH = value(row, column, "scaleH").split("|").map((part) => Number(part)).filter((part) => part > 0);
    if (leaf) entry.leaf = leaf;
    if (swing) entry.swing = swing;
    if (hand) entry.hand = hand;
    if (mount) entry.mountHeight = Number(mount);
    if (scaleH.length) entry.scaleH = scaleH;
    items.push(entry);
  }
  return items;
}

function readUserCatalog() {
  try {
    const parsed = JSON.parse(localStorage.getItem(USER_CATALOG_KEY) || "[]");
    return Array.isArray(parsed) ? parsed.filter((entry) => entry?.id && entry.id !== "記入例") : [];
  } catch {
    return [];
  }
}

function csvRow(entry) {
  const category = Array.isArray(entry.category) ? entry.category.join("|") : "";
  const scaleH = Array.isArray(entry.scaleH) ? entry.scaleH.join("|") : "";
  return [
    entry.id,
    entry.name,
    category,
    entry.w,
    entry.d,
    entry.h,
    entry.place,
    entry.color,
    entry.price ?? "",
    entry.scalable ? "1" : "",
    entry.light ? "1" : "",
    entry.residential ? "1" : "",
    entry.leaf || "",
    entry.swing || "",
    entry.hand || "",
    entry.mountHeight ?? "",
    scaleH,
  ].map(csvEscape).join(",");
}

function csvEscape(value) {
  const text = value == null ? "" : String(value);
  if (/[",\n]/.test(text)) return `"${text.replaceAll('"', '""')}"`;
  return text;
}

function parseCsv(text) {
  const rows = [];
  let row = [];
  let cell = "";
  let quoted = false;
  const source = text.replace(/\r\n/g, "\n").replace(/\r/g, "\n");
  for (let index = 0; index < source.length; index += 1) {
    const ch = source[index];
    if (quoted) {
      if (ch === '"') {
        if (source[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else quoted = false;
      } else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") {
      row.push(cell);
      cell = "";
    } else if (ch === "\n") {
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
    } else cell += ch;
  }
  if (cell.length || row.length) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}

function value(row, column, name) {
  const index = column[name];
  return index == null ? "" : String(row[index] ?? "").trim();
}

function number(text, fallback) {
  const parsed = Number(text);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

function flag(row, column, name) {
  const text = value(row, column, name).toLowerCase();
  return text === "1" || text === "true" || text === "yes";
}
