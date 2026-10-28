import { CATALOG, lookupItem } from "./catalog.js?v=20261028d";
import { centroid, distanceToBoundary, outlinePoints, pointInRoom } from "./geometry.js";
import { hingePoint, leafSwing, openingCenter } from "./openings.js?v=20261022f";
import { powerToRows, rowsToPower } from "./power.js?v=20261028d";
import { CELL_MM } from "./schema.js";
import { clearMissingHosts } from "./surface.js?v=20261028d";

const FURNITURE = new Set(["bench", "sink", "balance", "chair", "door", "door-right", "door-double", "door-push", "door-slide", "window", "toilet", "wash", "pillar", "beam"]);
const OUTLETS = new Set(["outlet", "reel"]);
const UTILITIES = new Set(["pipe", "elbow", "board"]);

export function planToBook(plan) {
  const bounds = boundsOf(plan);
  const grid = paintGrid(plan, bounds, CELL_MM, 400, 300);
  const overview = paintGrid(plan, bounds, overviewCell(bounds), 40, 40);
  const equipment = equipmentRows(plan);
  const layout = layoutRows(plan);
  const drawings = [[
    plan.id,
    plan.name || "NewPlan",
    bounds.w,
    bounds.d,
    plan.settings?.wall || 150,
    new Date(plan.updatedAt || Date.now()).toISOString(),
    "",
  ]];
  return {
    projectPairs: projectPairs(plan),
    settingsPairs: settingsPairs(plan, bounds, grid),
    equipment,
    layout,
    drawings,
    grid,
    overview,
    power: powerToRows(plan),
  };
}

export function bookToPlan(tables) {
  const project = asMap(tables.projectPairs);
  const settings = asMap(tables.settingsPairs);
  const equipment = tables.equipment || [];
  const layout = tables.layout || [];
  const drawings = tables.drawings || [];
  if (!layout.length && !equipment.length) {
    throw new Error("empty");
  }
  const customItems = customItemsFrom(project, equipment);
  const masters = new Map(equipment.filter((row) => row.id).map((row) => [String(row.id), row]));
  const rooms = [];
  const items = [];
  const openings = [];
  for (const row of layout) {
    if (row.kind === "room") rooms.push(roomFrom(row));
    else if (row.kind === "opening") openings.push(openingFrom(row));
    else if (row.kind) items.push(itemFrom(row, masters, customItems));
  }
  if (!rooms.length) {
    rooms.push(fallbackRoom(drawings, items, project));
  }
  if (!items.length && equipment.length) {
    items.push(...placeEquipment(equipment, customItems));
  }
  clearMissingHosts({ items });
  const name = String(project.name || drawings[0]?.name || "Excel取込");
  return {
    id: String(drawings[0]?.id || project.active_drawing_id || "excel"),
    name,
    updatedAt: Date.now(),
    settings: settingsFrom(settings, drawings),
    rooms,
    items,
    openings,
    views: parseJson(readLong(project, "views_json"), []),
    customItems,
    underlay: parseJson(readLong(project, "underlay_json"), null),
    ...rowsToPower(tables.power),
  };
}

function projectPairs(plan) {
  const pairs = [
    ["model", "one_spreadsheet_per_project"],
    ["name", plan.name || "NewPlan"],
    ["app", "NEOSUPO★STAR β5"],
    ["note", "この1冊が1プロジェクト。機器・配置・図面はこのブックに置く。"],
    ["active_drawing_id", plan.id],
  ];
  putLong(pairs, "views_json", JSON.stringify(plan.views || []));
  putLong(pairs, "custom_items_json", JSON.stringify(plan.customItems || []));
  if (plan.underlay?.href) putLong(pairs, "underlay_json", JSON.stringify(plan.underlay));
  return pairs;
}

function settingsPairs(plan, bounds, grid) {
  const settings = plan.settings || {};
  return [
    ["scale_cm_per_cell", 10],
    ["cell_px", 56],
    ["room_w_mm", bounds.w],
    ["room_d_mm", bounds.d],
    ["wall_thickness_mm", settings.wall || 150],
    ["ceiling_mm", settings.ceiling || 2700],
    ["floor_height_mm", settings.floorHeight || 4000],
    ["module_mm", settings.module || 1000],
    ["division", settings.division || 2],
    ["snap", settings.snap === false ? "false" : "true"],
    ["rotation_step", settings.rotationStep || 15],
    ["brightness", settings.brightness ?? 1],
    ["origin_x_mm", grid.originX],
    ["origin_y_mm", grid.originY],
    ["grid_cell_mm", grid.cellMm],
  ];
}

function equipmentRows(plan) {
  const groups = new Map();
  for (const entry of plan.items || []) {
    const key = [entry.catalogId, entry.w, entry.d, entry.h, entry.maker || "", entry.model || "", entry.power || "", entry.hostId ? "卓上" : ""].join("|");
    const found = groups.get(key);
    if (found) found.qty += 1;
    else groups.set(key, { entry, qty: 1 });
  }
  const rows = [];
  const used = new Set();
  for (const group of groups.values()) {
    const id = masterId(group.entry.catalogId, used);
    rows.push(equipmentRow(group.entry, id, group.qty));
  }
  for (const custom of plan.customItems || []) {
    if (rows.some((row) => row.id === custom.id)) continue;
    rows.push(equipmentRow({ ...custom, catalogId: custom.id }, custom.id, 0));
  }
  return rows;
}

function equipmentRow(entry, id, qty) {
  const cat = lookupItem(entry.catalogId, []);
  const family = familyOf(entry, cat);
  return {
    id,
    区分: categoryOf(entry, cat, family),
    "床置or卓上": placementOf(entry),
    機器名称: entry.name || cat?.name || "",
    メーカー: entry.maker || "",
    型式: entry.model || "",
    数量: qty,
    W_mm: entry.w || cat?.w || "",
    D_mm: entry.d || cat?.d || "",
    H_mm: entry.h || cat?.h || "",
    重量_kg: entry.weightKg ?? "",
    電気: entry.power || "",
    給水: entry.water || "",
    排水: entry.drain || "",
    給気: entry.supplyAir || "",
    排気: entry.exhaust || "",
    特ガス: entry.gas || "",
    備考: entry.note || "",
    iso_drive_id: "",
    family,
  };
}

function layoutRows(plan) {
  const drawingId = plan.id;
  const wall = plan.settings?.wall || 150;
  const rows = [];
  for (const room of plan.rooms || []) {
    rows.push({
      id: room.id,
      kind: "room",
      ref_id: room.name || "",
      x_mm: room.x,
      y_mm: room.y,
      w_mm: room.w,
      d_mm: room.h,
      rotation_deg: 0,
      thickness_mm: wall,
      label: room.name || "",
      fill: room.floorColor || room.color || "#d5e4f2",
      path: JSON.stringify({
        color: room.color || room.floorColor || "#d5e4f2",
        floorFinish: room.floorFinish || "床",
        wallFinish: room.wallFinish || "壁",
        wallColor: room.wallColor || "#8e98a3",
        dropCeiling: room.dropCeiling || 0,
        raisedFloor: room.raisedFloor || 0,
        points: room.points || [],
        edges: room.edges || [],
      }),
      layer: "room",
      group_id: "",
      drawing_id: drawingId,
      geom: "rect",
      stroke: room.wallColor || "#8e98a3",
    });
  }
  for (const opening of plan.openings || []) {
    const room = (plan.rooms || []).find((entry) => entry.id === opening.roomId);
    const center = room ? openingCenter(room, opening) : { x: 0, y: 0 };
    rows.push({
      id: opening.id,
      kind: "opening",
      ref_id: opening.preset || "hole",
      x_mm: center.x,
      y_mm: center.y,
      w_mm: opening.w,
      d_mm: opening.h,
      rotation_deg: 0,
      thickness_mm: opening.sill,
      label: { full: "壁抜き", hole: "開口部", waist: "腰壁" }[opening.preset] || "開口部",
      fill: "",
      path: JSON.stringify({
        roomId: opening.roomId,
        wallSide: opening.wallSide || null,
        edgeIndex: opening.edgeIndex ?? null,
        along: opening.along,
        sill: opening.sill,
        h: opening.h,
        preset: opening.preset,
      }),
      layer: "opening",
      group_id: "",
      drawing_id: drawingId,
      geom: "rect",
      stroke: "",
    });
  }
  for (const entry of plan.items || []) {
    const door = entry.leaf === "door" || entry.catalogId === "door" || /ドア|扉|引戸/.test(entry.name || "");
    rows.push({
      id: entry.id,
      kind: kindOf(entry),
      ref_id: entry.catalogId || "",
      x_mm: entry.x,
      y_mm: entry.y,
      w_mm: entry.w,
      d_mm: entry.d,
      rotation_deg: entry.rot || 0,
      thickness_mm: 0,
      label: entry.name || "",
      fill: entry.color || "#cccccc",
      path: JSON.stringify(itemMeta(entry)),
      layer: entry.leaf === "window" ? "window" : entry.leaf === "door" ? "door" : (entry.place || ""),
      group_id: entry.groupId || "",
      drawing_id: drawingId,
      geom: door ? "arc" : "rect",
      stroke: "",
    });
  }
  return rows;
}

function itemMeta(entry) {
  return {
    h: entry.h,
    z: entry.z || 0,
    price: entry.price == null || entry.price === "" ? null : Number(entry.price),
    place: entry.place || "floor",
    roomId: entry.roomId || null,
    wallSide: entry.wallSide || null,
    opening: !!entry.opening,
    openingId: entry.openingId || null,
    leaf: entry.leaf || "",
    hinge: entry.hinge || "start",
    light: !!entry.light,
    lightOn: !!entry.lightOn,
    lightLevel: entry.lightLevel || 10,
    lightColor: entry.lightColor || "#fff4d6",
    residential: !!entry.residential,
    design: entry.design || "",
    maker: entry.maker || "",
    model: entry.model || "",
    weightKg: entry.weightKg ?? "",
    power: entry.power || "",
    water: entry.water || "",
    drain: entry.drain || "",
    supplyAir: entry.supplyAir || "",
    exhaust: entry.exhaust || "",
    gas: entry.gas || "",
    note: entry.note || "",
    hostId: entry.hostId || null,
    locked: !!entry.locked,
  };
}

function openingFrom(row) {
  const meta = parseMeta(row.path);
  return {
    id: String(row.id || uid()),
    roomId: meta.roomId || null,
    wallSide: meta.wallSide || null,
    edgeIndex: meta.edgeIndex == null || meta.edgeIndex === "" ? null : Number(meta.edgeIndex),
    along: Number(meta.along) || 0,
    w: num(row.w_mm) || 1000,
    h: num(meta.h) || num(row.d_mm) || 1000,
    sill: meta.sill == null ? num(row.thickness_mm) : num(meta.sill),
    preset: meta.preset || row.ref_id || "hole",
  };
}

function roomFrom(row) {
  const meta = parseMeta(row.path);
  return {
    id: String(row.id || uid()),
    name: String(row.label || row.ref_id || "実験室"),
    x: num(row.x_mm),
    y: num(row.y_mm),
    w: num(row.w_mm) || 6000,
    h: num(row.d_mm) || 4000,
    color: meta.color || row.fill || "#d5e4f2",
    floorFinish: meta.floorFinish || "床",
    floorColor: row.fill || meta.floorColor || "#d5e4f2",
    wallFinish: meta.wallFinish || "壁",
    wallColor: meta.wallColor || row.stroke || "#8e98a3",
    dropCeiling: num(meta.dropCeiling),
    raisedFloor: num(meta.raisedFloor),
    points: Array.isArray(meta.points) ? meta.points : null,
    edges: Array.isArray(meta.edges) ? meta.edges : null,
  };
}

function itemFrom(row, masters, customItems) {
  const ref = String(row.ref_id || row.id || "");
  const cat = lookupItem(ref, customItems);
  const meta = parseMeta(row.path);
  const master = masters.get(ref) || [...masters.values()].find((entry) => entry["機器名称"] === row.label);
  return {
    id: String(row.id || uid()),
    catalogId: ref,
    name: String(row.label || master?.["機器名称"] || cat?.name || "器具"),
    color: row.fill || cat?.color || "#8fb4d4",
    place: meta.place || cat?.place || placeFrom(master?.["床置or卓上"], row.kind),
    x: num(row.x_mm),
    y: num(row.y_mm),
    rot: num(row.rotation_deg),
    w: num(row.w_mm) || num(master?.W_mm) || cat?.w || 900,
    d: num(row.d_mm) || num(master?.D_mm) || cat?.d || 600,
    h: num(meta.h) || num(master?.H_mm) || cat?.h || 800,
    z: num(meta.z) || (cat?.mountHeight || 0),
    price: meta.price == null || meta.price === "" ? null : Number(meta.price),
    groupId: row.group_id ? String(row.group_id) : null,
    roomId: meta.roomId || null,
    wallSide: meta.wallSide || null,
    opening: meta.openingId ? false : meta.opening != null ? !!meta.opening : !!cat?.opening,
    openingId: meta.openingId || null,
    leaf: meta.leaf || cat?.leaf || "",
    hinge: meta.hinge || "start",
    light: meta.light != null ? !!meta.light : !!cat?.light,
    lightOn: meta.lightOn != null ? !!meta.lightOn : !!cat?.light,
    lightLevel: num(meta.lightLevel) || 10,
    lightColor: meta.lightColor || "#fff4d6",
    residential: meta.residential != null ? !!meta.residential : !!cat?.residential,
    design: meta.design || "",
    maker: meta.maker || master?.["メーカー"] || "",
    model: meta.model || master?.["型式"] || "",
    weightKg: meta.weightKg !== "" && meta.weightKg != null ? meta.weightKg : (master?.["重量_kg"] ?? ""),
    power: meta.power || master?.["電気"] || "",
    water: meta.water || master?.["給水"] || "",
    drain: meta.drain || master?.["排水"] || "",
    supplyAir: meta.supplyAir || master?.["給気"] || "",
    exhaust: meta.exhaust || master?.["排気"] || "",
    gas: meta.gas || master?.["特ガス"] || "",
    hostId: meta.hostId || null,
    locked: !!meta.locked,
    note: meta.note || master?.["備考"] || "",
  };
}

function customItemsFrom(project, equipment) {
  const parsed = parseJson(readLong(project, "custom_items_json"), []);
  const customItems = Array.isArray(parsed) ? parsed.slice() : [];
  equipment.forEach((row, index) => {
    if (!row.id) row.id = `e${index + 1}`;
    const id = String(row.id);
    if (lookupItem(id, customItems)) return;
    customItems.push({
      id,
      name: String(row["機器名称"] || id),
      category: ["追加器具"],
      w: num(row.W_mm) || 900,
      d: num(row.D_mm) || 600,
      h: num(row.H_mm) || 800,
      place: placeFrom(row["床置or卓上"], row.family === "コンセント" ? "outlet" : ""),
      color: "#8fb4d4",
      price: null,
      scalable: true,
      light: false,
      residential: false,
      opening: false,
      mountHeight: 1200,
    });
  });
  return customItems.filter((entry) => !CATALOG.some((cat) => cat.id === entry.id));
}

function placeEquipment(equipment, customItems) {
  const items = [];
  let x = 1000;
  let y = 1000;
  let rowDepth = 0;
  for (const row of equipment) {
    const qty = Math.max(1, num(row["数量"]) || 1);
    const w = num(row.W_mm) || 900;
    const d = num(row.D_mm) || 600;
    for (let i = 0; i < qty; i += 1) {
      if (x + w > 14000) {
        x = 1000;
        y += rowDepth + 400;
        rowDepth = 0;
      }
      const ref = String(row.id);
      const cat = lookupItem(ref, customItems);
      items.push({
        id: uid(),
        catalogId: ref,
        name: String(row["機器名称"] || cat?.name || "器具"),
        color: cat?.color || "#8fb4d4",
        place: cat?.place || placeFrom(row["床置or卓上"], ""),
        x,
        y,
        rot: 0,
        w,
        d,
        h: num(row.H_mm) || cat?.h || 800,
        z: cat?.place === "wall" ? cat.mountHeight || 0 : 0,
        price: null,
        groupId: null,
        roomId: null,
        wallSide: null,
        opening: !!cat?.opening,
        light: !!cat?.light,
        lightOn: !!cat?.light,
        lightLevel: 10,
        lightColor: "#fff4d6",
        residential: !!cat?.residential,
        design: "",
        maker: row["メーカー"] || "",
        model: row["型式"] || "",
        weightKg: row["重量_kg"] ?? "",
        power: row["電気"] || "",
        water: row["給水"] || "",
        drain: row["排水"] || "",
        supplyAir: row["給気"] || "",
        exhaust: row["排気"] || "",
        gas: row["特ガス"] || "",
        note: row["備考"] || "",
      });
      x += w + 200;
      rowDepth = Math.max(rowDepth, d);
    }
  }
  return items;
}

function fallbackRoom(drawings, items, project) {
  const drawing = drawings[0] || {};
  let maxX = num(drawing.room_w_mm) || 0;
  let maxY = num(drawing.room_d_mm) || 0;
  for (const item of items) {
    maxX = Math.max(maxX, item.x + item.w + 1000);
    maxY = Math.max(maxY, item.y + item.d + 1000);
  }
  return {
    id: uid(),
    name: String(drawing.name || project.name || "実験室"),
    x: 0,
    y: 0,
    w: Math.max(6000, maxX),
    h: Math.max(4000, maxY),
    color: "#d5e4f2",
    floorFinish: "床",
    floorColor: "#d5e4f2",
    wallFinish: "壁",
    wallColor: "#8e98a3",
    dropCeiling: 0,
    raisedFloor: 0,
  };
}

function settingsFrom(settings, drawings) {
  const brightness = Number(settings.brightness);
  return {
    ceiling: num(settings.ceiling_mm) || 2700,
    floorHeight: num(settings.floor_height_mm) || 4000,
    wall: num(settings.wall_thickness_mm) || num(drawings[0]?.wall_thickness_mm) || 150,
    module: num(settings.module_mm) || 1000,
    division: num(settings.division) || 2,
    snap: String(settings.snap) !== "false",
    rotationStep: num(settings.rotation_step) || 15,
    brightness: [0, 1, 2].includes(brightness) ? brightness : 1,
    exported: false,
  };
}

function paintGrid(plan, bounds, preferred, maxCols, maxRows) {
  let cellMm = preferred;
  let cols = Math.max(1, Math.ceil(bounds.w / cellMm));
  let rows = Math.max(1, Math.ceil(bounds.d / cellMm));
  while ((cols > maxCols || rows > maxRows) && cellMm < 5000) {
    cellMm += preferred;
    cols = Math.max(1, Math.ceil(bounds.w / cellMm));
    rows = Math.max(1, Math.ceil(bounds.d / cellMm));
  }
  cols = Math.min(cols, maxCols);
  rows = Math.min(rows, maxRows);
  const originX = Math.floor(bounds.minX / cellMm) * cellMm;
  const originY = Math.floor(bounds.minY / cellMm) * cellMm;
  const grid = new Map();
  const set = (c, r, color) => {
    if (c < 0 || r < 0 || c >= cols || r >= rows) return;
    const key = `${c},${r}`;
    const prev = grid.get(key);
    grid.set(key, { c, r, argb: argb(color), text: prev?.text || "" });
  };
  const label = (x, y, text) => {
    const c = Math.floor((x - originX) / cellMm);
    const r = Math.floor((y - originY) / cellMm);
    const prev = grid.get(`${c},${r}`);
    if (prev && text) prev.text = String(text);
  };
  const visit = (fn) => {
    for (let r = 0; r < rows; r += 1) {
      for (let c = 0; c < cols; c += 1) {
        fn(c, r, originX + (c + 0.5) * cellMm, originY + (r + 0.5) * cellMm);
      }
    }
  };
  const wallT = Math.max(cellMm * 0.45, Number(plan.settings?.wall) || 150);
  for (const room of plan.rooms || []) {
    const spot = centroid(room);
    visit((c, r, x, y) => {
      if (!pointInRoom(room, x, y)) return;
      const boundary = distanceToBoundary(room, x, y) <= wallT;
      set(c, r, boundary ? room.wallColor || "#8e98a3" : room.floorColor || room.color || "#d5e4f2");
    });
    label(spot.x, spot.y, room.name);
  }
  for (const opening of plan.openings || []) {
    if ((Number(opening.sill) || 0) >= 80) continue;
    const room = (plan.rooms || []).find((entry) => entry.id === opening.roomId);
    if (!room) continue;
    const center = openingCenter(room, opening);
    const wall = center.wall;
    const samples = [];
    const steps = Math.max(2, Math.ceil(opening.w / Math.max(40, cellMm / 2)));
    for (let i = 0; i <= steps; i += 1) samples.push(wall.pointAt(center.along - opening.w / 2 + (opening.w * i) / steps));
    const band = Math.max(cellMm, wallT);
    visit((c, r, x, y) => {
      const near = samples.some((point) => Math.hypot(point.x - x, point.y - y) <= band);
      if (near) set(c, r, room.floorColor || room.color || "#f4f1ea");
    });
  }
  return { cellMm, cols, rows, originX, originY, cells: [...grid.values()], merges: [], shapes: buildShapes(plan) };
}

function buildShapes(plan) {
  const shapes = [];
  for (const entry of plan.items || []) {
    if (entry.openingId) {
      const path = leafShape(plan, entry);
      if (path) shapes.push(path);
      continue;
    }
    shapes.push({
      kind: "rect",
      x: entry.x,
      y: entry.y,
      w: Math.max(10, entry.w),
      d: Math.max(10, entry.d),
      rot: Number(entry.rot) || 0,
      fill: entry.color || "#cccccc",
      text: entry.name || "",
    });
  }
  return shapes;
}

function leafShape(plan, entry) {
  const opening = (plan.openings || []).find((row) => row.id === entry.openingId);
  const room = opening && (plan.rooms || []).find((row) => row.id === opening.roomId);
  if (!opening || !room) return null;
  const center = openingCenter(room, opening);
  const wall = center.wall;
  const cat = lookupItem(entry.catalogId, plan.customItems);
  const swing = cat?.swing || (entry.leaf === "window" ? "window" : "single");
  const points = [];
  const pushLine = (ax, ay, bx, by) => {
    points.push({ x: ax, y: ay, jump: true });
    points.push({ x: bx, y: by });
  };
  if (swing === "window" || swing === "slide") {
    const sign = swing === "slide" && entry.hinge === "end" ? 1 : swing === "slide" ? -1 : 0;
    const shift = sign * opening.w * 0.42;
    const ang = wall.tangentAt(center.along);
    const ox = Math.cos(ang) * shift + (swing === "slide" ? wall.nx * 80 : 0);
    const oy = Math.sin(ang) * shift + (swing === "slide" ? wall.ny * 80 : 0);
    const half = opening.w * (swing === "slide" ? 0.46 : 0.5);
    pushLine(center.x + ox - Math.cos(ang) * half, center.y + oy - Math.sin(ang) * half, center.x + ox + Math.cos(ang) * half, center.y + oy + Math.sin(ang) * half);
  } else {
    const hinges = swing === "double" ? ["start", "end"] : [entry.hinge === "end" ? "end" : "start"];
    const radius = swing === "double" ? opening.w / 2 : opening.w;
    for (const hinge of hinges) {
      const pose = leafSwing(wall, hinge, swing);
      const hp = hingePoint(room, opening, hinge);
      for (let i = 0; i <= 14; i += 1) {
        const t = pose.closed + pose.delta * (i / 14);
        points.push({ x: hp.x + Math.cos(t) * radius, y: hp.y + Math.sin(t) * radius, jump: i === 0 });
      }
      points.push({ x: hp.x, y: hp.y, jump: true });
      points.push({ x: hp.x + Math.cos(pose.open) * radius, y: hp.y + Math.sin(pose.open) * radius });
    }
  }
  if (points.length < 2) return null;
  return { kind: "path", points, stroke: entry.color || "#8a5a32" };
}

function itemAabb(entry) {
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const corner of itemCorners(entry)) {
    minX = Math.min(minX, corner.x);
    minY = Math.min(minY, corner.y);
    maxX = Math.max(maxX, corner.x);
    maxY = Math.max(maxY, corner.y);
  }
  return { minX, minY, maxX, maxY };
}

function itemCorners(entry) {
  const theta = ((Number(entry.rot) || 0) * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const hw = (Number(entry.w) || 0) / 2;
  const hd = (Number(entry.d) || 0) / 2;
  return [[hw, hd], [hw, -hd], [-hw, hd], [-hw, -hd]].map(([lx, ly]) => ({
    x: entry.x + lx * cos - ly * sin,
    y: entry.y + lx * sin + ly * cos,
  }));
}

function itemContains(entry, x, y) {
  const theta = ((Number(entry.rot) || 0) * Math.PI) / 180;
  const dx = x - entry.x;
  const dy = y - entry.y;
  const lx = dx * Math.cos(theta) + dy * Math.sin(theta);
  const ly = -dx * Math.sin(theta) + dy * Math.cos(theta);
  return Math.abs(lx) <= (Number(entry.w) || 0) / 2 && Math.abs(ly) <= (Number(entry.d) || 0) / 2;
}

function labelRotation(rot) {
  const deg = ((Number(rot) || 0) % 360 + 360) % 360;
  const from90 = Math.abs(deg - 90);
  const from270 = Math.min(Math.abs(deg - 270), Math.abs(deg + 90));
  if (from90 <= 45 && from90 <= from270) return -90;
  if (from270 <= 45) return 90;
  return 0;
}

function mergeFree(merges, c1, r1, c2, r2) {
  return !merges.some((merge) => !(c2 < merge.c1 || c1 > merge.c2 || r2 < merge.r1 || r1 > merge.r2));
}

function boundsOf(plan) {
  const boxes = [];
  for (const room of plan.rooms || []) {
    const outline = outlinePoints(room, 100);
    if (!outline.length) continue;
    boxes.push([
      Math.min(...outline.map((point) => point.x)),
      Math.min(...outline.map((point) => point.y)),
      Math.max(...outline.map((point) => point.x)),
      Math.max(...outline.map((point) => point.y)),
    ]);
  }
  for (const entry of plan.items || []) {
    if (entry.openingId) continue;
    const footprint = itemAabb(entry);
    boxes.push([footprint.minX, footprint.minY, footprint.maxX, footprint.maxY]);
  }
  if (!boxes.length) return { minX: 0, minY: 0, w: 18400, d: 8400 };
  const minX = Math.min(...boxes.map((box) => box[0]));
  const minY = Math.min(...boxes.map((box) => box[1]));
  const maxX = Math.max(...boxes.map((box) => box[2]));
  const maxY = Math.max(...boxes.map((box) => box[3]));
  return { minX, minY, w: Math.max(CELL_MM, maxX - minX), d: Math.max(CELL_MM, maxY - minY) };
}

function overviewCell(bounds) {
  for (const mm of [100, 200, 500, 1000, 2000, 5000]) {
    if (bounds.w / mm <= 40 && bounds.d / mm <= 40) return mm;
  }
  return 5000;
}

function familyOf(entry, cat) {
  const id = entry.catalogId || entry.id;
  if (OUTLETS.has(id)) return "コンセント";
  if (UTILITIES.has(id)) return "ユーティリティ";
  if (FURNITURE.has(id)) return "什器";
  const text = Array.isArray(cat?.category) ? cat.category.join("/") : String(entry.category || "");
  if (text.includes("コンセント")) return "コンセント";
  if (text.includes("ユーティリティ")) return "ユーティリティ";
  if (/ファニチャー|設備|ドア|什器/.test(text)) return "什器";
  return "機器";
}

function categoryOf(entry, cat, family) {
  const list = cat?.category || entry.category;
  if (Array.isArray(list) && list.length) return list[list.length - 1];
  return family === "機器" ? "中型" : family;
}

function kindOf(entry) {
  if (OUTLETS.has(entry.catalogId)) return "outlet";
  if (entry.leaf === "door" || entry.leaf === "window" || entry.opening || FURNITURE.has(entry.catalogId)) return "furniture";
  return "equipment";
}

function placementOf(entry) {
  if (entry?.hostId) return "卓上";
  const place = typeof entry === "string" ? entry : entry?.place;
  if (place === "wall") return "壁付";
  if (place === "ceiling") return "天井";
  if (place === "free") return "自由";
  return "床置";
}

function placeFrom(placement, kind) {
  if (placement === "壁付" || kind === "outlet") return "wall";
  if (placement === "天井") return "ceiling";
  if (placement === "自由") return "free";
  return "floor";
}

function masterId(catalogId, used) {
  const base = String(catalogId || "item");
  if (!used.has(base)) {
    used.add(base);
    return base;
  }
  let n = 2;
  while (used.has(`${base}#${n}`)) n += 1;
  const id = `${base}#${n}`;
  used.add(id);
  return id;
}

function asMap(pairs) {
  const map = {};
  for (const pair of pairs || []) map[pair[0]] = pair[1];
  return map;
}

function putLong(pairs, key, text) {
  const size = 30000;
  if (text.length <= size) {
    pairs.push([key, text]);
    return;
  }
  const parts = Math.ceil(text.length / size);
  pairs.push([`${key}_parts`, parts]);
  for (let i = 0; i < parts; i += 1) pairs.push([`${key}_${i}`, text.slice(i * size, (i + 1) * size)]);
}

function readLong(map, key) {
  if (map[key] != null && map[key] !== "") return String(map[key]);
  const parts = Number(map[`${key}_parts`] || 0);
  if (!parts) return "";
  let text = "";
  for (let i = 0; i < parts; i += 1) text += String(map[`${key}_${i}`] || "");
  return text;
}

function parseJson(text, fallback) {
  if (!text) return fallback;
  try {
    return JSON.parse(text);
  } catch {
    return fallback;
  }
}

function parseMeta(value) {
  if (!value) return {};
  if (typeof value === "object" && !Array.isArray(value)) return value;
  const text = String(value).trim();
  if (!text.startsWith("{")) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
}

function num(value) {
  const n = Number(value);
  return Number.isFinite(n) ? n : 0;
}

function argb(color) {
  const raw = String(color || "#cccccc").replace("#", "");
  const hex = raw.length === 3 ? raw.split("").map((ch) => ch + ch).join("") : raw.padEnd(6, "0").slice(0, 6);
  return `FF${hex.toUpperCase()}`;
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}
