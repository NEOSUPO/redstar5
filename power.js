import { nearestEdge, pointInRoom } from "./geometry.js?v=20261022d";

const PINK = "#d4145a";
const BENCHES = new Set(["bench", "sink", "balance", "kitchen"]);

export const POWER_SYMBOLS = [
  { id: "flush-1p100-15", kind: "flush", voltage: "1p100", amp: 15, label: "埋め込み 単相100V 15A" },
  { id: "flush-1p100-20", kind: "flush", voltage: "1p100", amp: 20, label: "埋め込み 単相100V 20A" },
  { id: "flush-1p200-15", kind: "flush", voltage: "1p200", amp: 15, label: "埋め込み 単相200V 15A" },
  { id: "flush-1p200-20", kind: "flush", voltage: "1p200", amp: 20, label: "埋め込み 単相200V 20A" },
  { id: "flush-1p200-30", kind: "flush", voltage: "1p200", amp: 30, label: "埋め込み 単相200V 30A" },
  { id: "flush-3p200-15", kind: "flush", voltage: "3p200", amp: 15, label: "埋め込み 三相200V 15A" },
  { id: "flush-3p200-20", kind: "flush", voltage: "3p200", amp: 20, label: "埋め込み 三相200V 20A" },
  { id: "flush-3p200-30", kind: "flush", voltage: "3p200", amp: 30, label: "埋め込み 三相200V 30A" },
  { id: "surface-1p100-15", kind: "surface", voltage: "1p100", amp: 15, label: "露出 単相100V 15A" },
  { id: "surface-1p200-15", kind: "surface", voltage: "1p200", amp: 15, label: "露出 単相200V 15A" },
  { id: "surface-3p200-15", kind: "surface", voltage: "3p200", amp: 15, label: "露出 三相200V 15A" },
  { id: "switch-20", kind: "switch", voltage: "", amp: 20, label: "手元開閉器 20A" },
  { id: "switch-30", kind: "switch", voltage: "", amp: 30, label: "手元開閉器 30A" },
];

export function symbolById(id) {
  return POWER_SYMBOLS.find((entry) => entry.id === id) || POWER_SYMBOLS[0];
}

export function voltageLabel(voltage) {
  if (voltage === "1p200") return "単相200V";
  if (voltage === "3p200") return "三相200V";
  if (voltage === "1p100") return "単相100V";
  return "";
}

export function roleLabel(role) {
  if (role === "dedicated") return "専用";
  if (role === "spare") return "予備";
  return "一般";
}

export function parsePower(text) {
  const source = String(text || "");
  if (!source.trim()) return null;
  let voltage = null;
  if (/三相|3φ|3相/.test(source)) voltage = "3p200";
  else if (/200/.test(source)) voltage = "1p200";
  else if (/100/.test(source)) voltage = "1p100";
  const ampMatch = source.match(/(\d+(?:\.\d+)?)\s*A/i);
  const amp = ampMatch ? Number(ampMatch[1]) : null;
  if (!voltage && amp == null) return null;
  return { voltage: voltage || "1p100", amp: amp || 15, dedicated: /専用/.test(source) };
}

export function heavyPower(spec, text) {
  if (!spec) return false;
  return spec.voltage !== "1p100" || spec.amp >= 20 || spec.dedicated || /専用/.test(text || "");
}

function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function num(value, fallback) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function normalizePower(plan) {
  const itemIds = new Set((plan.items || []).map((entry) => entry.id));
  const panels = (Array.isArray(plan.panels) ? plan.panels : []).map((panel) => ({
    id: panel.id || uid(),
    name: panel.name || "分電盤",
    x: num(panel.x, 0),
    y: num(panel.y, 0),
    rotation: num(panel.rotation, 0),
    roomId: panel.roomId || null,
    slots: Math.max(1, num(panel.slots, 12)),
    mainAmp: Math.max(1, num(panel.mainAmp, 100)),
  }));
  const panelIds = new Set(panels.map((panel) => panel.id));
  const breakers = (Array.isArray(plan.breakers) ? plan.breakers : []).filter((row) => panelIds.has(row.panelId)).map((row) => ({
    id: row.id || uid(),
    panelId: row.panelId,
    number: String(row.number || "1"),
    voltage: ["1p100", "1p200", "3p200"].includes(row.voltage) ? row.voltage : "1p100",
    amp: [15, 20, 30].includes(Number(row.amp)) ? Number(row.amp) : 20,
    role: ["dedicated", "general", "spare"].includes(row.role) ? row.role : "general",
    name: row.name || "",
    phase: ["L1", "L2", "L1L2", "3P"].includes(row.phase) ? row.phase : "L1",
    itemId: itemIds.has(row.itemId) ? row.itemId : null,
  }));
  const breakerIds = new Set(breakers.map((row) => row.id));
  const outlets = (Array.isArray(plan.outlets) ? plan.outlets : []).map((row) => ({
    id: row.id || uid(),
    kind: ["flush", "surface", "switch"].includes(row.kind) ? row.kind : "flush",
    voltage: ["1p100", "1p200", "3p200"].includes(row.voltage) ? row.voltage : "",
    amp: [15, 20, 30].includes(Number(row.amp)) ? Number(row.amp) : 15,
    x: num(row.x, 0),
    y: num(row.y, 0),
    rotation: num(row.rotation, 0),
    roomId: row.roomId || null,
    breakerId: breakerIds.has(row.breakerId) ? row.breakerId : null,
  }));
  plan.panels = panels;
  plan.breakers = breakers;
  plan.outlets = outlets;
}

export function placeAnchor(plan, x, y) {
  let bench = null;
  for (const item of plan.items || []) {
    if (!BENCHES.has(item.catalogId)) continue;
    const hit = nearestRectEdge(item, x, y);
    if (!bench || hit.dist < bench.dist) bench = hit;
  }
  if (bench && bench.dist < 500) {
    return { x: bench.x, y: bench.y, rotation: readable(bench.rotation), roomId: roomAt(plan, bench.x, bench.y) };
  }
  let wall = null;
  for (const room of plan.rooms || []) {
    const hit = nearestEdge(room, x, y);
    if (!hit) continue;
    if (!wall || hit.dist < wall.dist) wall = { ...hit, room };
  }
  if (wall && wall.dist < 900) {
    return {
      x: wall.x,
      y: wall.y,
      rotation: readable(wall.edge.tangentAt(wall.along)),
      roomId: wall.room.id,
    };
  }
  return { x, y, rotation: 0, roomId: roomAt(plan, x, y) };
}

function panelAnchor(plan, x, y) {
  let room = (plan.rooms || []).find((entry) => pointInRoom(entry, x, y));
  if (!room) {
    let best = null;
    for (const entry of plan.rooms || []) {
      const hit = nearestEdge(entry, x, y);
      if (hit && (!best || hit.dist < best.dist)) best = { room: entry, dist: hit.dist };
    }
    room = best?.room || null;
  }
  if (!room?.points?.length) return { x, y, rotation: 0, roomId: null };
  let maxX = -Infinity;
  let minY = Infinity;
  for (const point of room.points) {
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
  }
  const gap = (Number(plan.settings?.wall) || 150) / 2 + 240;
  return { x: maxX + gap, y: minY, rotation: 0, roomId: room.id };
}

function readable(rotation) {
  let angle = rotation || 0;
  if (Math.cos(angle) < -0.01) angle += Math.PI;
  return angle;
}

function roomAt(plan, x, y) {
  return (plan.rooms || []).find((room) => pointInRoom(room, x, y))?.id || null;
}

export function roomName(plan, roomId, x, y) {
  const room = (plan.rooms || []).find((entry) => entry.id === roomId) || (plan.rooms || []).find((entry) => pointInRoom(entry, x, y));
  return room?.name || "";
}

function nearestRectEdge(item, x, y) {
  const rot = ((item.rot || 0) * Math.PI) / 180;
  const c = Math.cos(rot);
  const s = Math.sin(rot);
  const hw = (item.w || 0) / 2;
  const hd = (item.d || 0) / 2;
  const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, ly]) => ({
    x: item.x + lx * c - ly * s,
    y: item.y + lx * s + ly * c,
  }));
  let best = null;
  for (let i = 0; i < corners.length; i += 1) {
    const a = corners[i];
    const b = corners[(i + 1) % corners.length];
    const dx = b.x - a.x;
    const dy = b.y - a.y;
    const len2 = dx * dx + dy * dy || 1;
    const t = Math.min(1, Math.max(0, ((x - a.x) * dx + (y - a.y) * dy) / len2));
    const px = a.x + dx * t;
    const py = a.y + dy * t;
    const dist = Math.hypot(x - px, y - py);
    if (!best || dist < best.dist) best = { dist, x: px, y: py, rotation: Math.atan2(dy, dx) };
  }
  return best;
}

function breakersOf(plan, panelId) {
  return (plan.breakers || []).filter((row) => row.panelId === panelId).sort((a, b) => Number(a.number) - Number(b.number) || String(a.number).localeCompare(String(b.number)));
}

function nextNumber(plan, panelId) {
  const numbers = breakersOf(plan, panelId).map((row) => Number(row.number)).filter((value) => Number.isFinite(value));
  return (numbers.length ? Math.max(...numbers) : 0) + 1;
}

function nextPhase(plan, panelId) {
  const rows = breakersOf(plan, panelId).filter((row) => row.phase === "L1" || row.phase === "L2");
  const last = rows[rows.length - 1];
  return last?.phase === "L1" ? "L2" : "L1";
}

export function phaseFor(voltage, plan, panelId) {
  if (voltage === "3p200") return "3P";
  if (voltage === "1p200") return "L1L2";
  return nextPhase(plan, panelId);
}

export function addBreaker(plan, panel, extra = {}) {
  const voltage = extra.voltage || "1p100";
  const breaker = {
    id: uid(),
    panelId: panel.id,
    number: String(extra.number || nextNumber(plan, panel.id)),
    voltage,
    amp: extra.amp || 20,
    role: extra.role || "general",
    name: extra.name || "",
    phase: extra.phase || phaseFor(voltage, plan, panel.id),
    itemId: extra.itemId || null,
  };
  plan.breakers.push(breaker);
  return breaker;
}

export function addPanel(plan, anchor) {
  const index = (plan.panels?.length || 0) + 1;
  const panel = {
    id: uid(),
    name: `L-${index}`,
    x: anchor.x,
    y: anchor.y,
    rotation: anchor.rotation,
    roomId: anchor.roomId,
    slots: 12,
    mainAmp: 100,
  };
  plan.panels.push(panel);
  addBreaker(plan, panel, { role: "spare", phase: "L1", amp: 20, voltage: "1p100" });
  addBreaker(plan, panel, { role: "spare", phase: "L2", amp: 20, voltage: "1p100" });
  return panel;
}

export function addOutlet(plan, symbol, anchor, breakerId = null) {
  const outlet = {
    id: uid(),
    kind: symbol.kind,
    voltage: symbol.voltage,
    amp: symbol.amp,
    x: anchor.x,
    y: anchor.y,
    rotation: anchor.rotation,
    roomId: anchor.roomId,
    breakerId,
  };
  plan.outlets.push(outlet);
  return outlet;
}

export function tryAddCircuit(plan, panel) {
  const rows = breakersOf(plan, panel.id);
  if (rows.length < panel.slots) {
    return { breaker: addBreaker(plan, panel, { role: "general", name: generalName(plan, panel) }), prompt: false };
  }
  return { breaker: null, prompt: true };
}

export function useSpare(plan, panel) {
  const spare = breakersOf(plan, panel.id).find((row) => row.role === "spare");
  if (!spare) return null;
  spare.role = "general";
  if (!spare.name) spare.name = generalName(plan, panel);
  return spare;
}

export function growPanel(plan, panel) {
  panel.slots += 2;
  return addBreaker(plan, panel, { role: "general", name: generalName(plan, panel) });
}

function generalName(plan, panel) {
  return `${roomName(plan, panel.roomId, panel.x, panel.y)} 一般`.trim();
}

export function suggestDedicated(plan) {
  const created = [];
  for (const item of plan.items || []) {
    if (item.openingId) continue;
    const spec = parsePower(item.power);
    if (!heavyPower(spec, item.power)) continue;
    if ((plan.breakers || []).some((row) => row.itemId === item.id && row.role === "dedicated")) continue;
    let panel = nearestPanel(plan, item.x, item.y);
    if (!panel) panel = addPanel(plan, panelAnchor(plan, item.x, item.y));
    if (breakersOf(plan, panel.id).length >= panel.slots) panel.slots += 1;
    const name = `${roomName(plan, item.roomId, item.x, item.y)} ${item.name || "機器"}`.trim();
    const breaker = addBreaker(plan, panel, {
      role: "dedicated",
      voltage: spec.voltage,
      amp: spec.amp >= 30 ? 30 : spec.amp >= 20 ? 20 : 15,
      phase: phaseFor(spec.voltage, plan, panel.id),
      itemId: item.id,
      name,
    });
    const anchor = placeAnchor(plan, item.x, item.y - (item.d || 600) / 2 - 200);
    addOutlet(plan, { kind: "flush", voltage: spec.voltage, amp: breaker.amp }, anchor, breaker.id);
    created.push(breaker.id);
  }
  return created;
}

function nearestPanel(plan, x, y) {
  let best = null;
  for (const panel of plan.panels || []) {
    const dist = Math.hypot(panel.x - x, panel.y - y);
    if (!best || dist < best.dist) best = { panel, dist };
  }
  return best?.panel || null;
}

export function powerLayout(panel, plan) {
  const rows = breakersOf(plan, panel.id);
  return {
    rows,
    x: panel.x + 1100,
    y: panel.y,
    rowW: 3200,
    rowH: 340,
    empty: Math.max(0, panel.slots - rows.length),
    bodyW: 980,
    bodyH: 520,
  };
}

function rowLabel(plan, row) {
  const item = (plan.items || []).find((entry) => entry.id === row.itemId);
  const target = row.role === "spare" ? "空" : item?.name || row.name || roleLabel(row.role);
  return `${row.number}  ${voltageLabel(row.voltage)} ${row.amp}A  ${roleLabel(row.role)}  ${target}`;
}

function textWidth(ctx, text, font) {
  ctx.save();
  ctx.font = font;
  const width = ctx.measureText(String(text)).width;
  ctx.restore();
  return width;
}

export function panelFrames(ctx, plan, panel, project, scale) {
  const layout = powerLayout(panel, plan);
  const origin = project(panel.x, panel.y);
  const schedule = project(layout.x, layout.y);
  const name = panel.name || "分電盤";
  const main = `主幹 ${panel.mainAmp}A`;
  const nameFont = "13px sans-serif";
  const mainFont = "11px sans-serif";
  const rowFont = "12px sans-serif";
  const labels = layout.rows.map((row) => rowLabel(plan, row));
  let rowText = textWidth(ctx, "空きマス", rowFont);
  for (const label of labels) rowText = Math.max(rowText, textWidth(ctx, label, rowFont));
  const padX = 8;
  const rowH = Math.max(layout.rowH * scale, 22);
  const rowW = Math.max(layout.rowW * scale, rowText + padX * 2);
  const bodyW = Math.max(layout.bodyW * scale, textWidth(ctx, name, nameFont) + padX * 2, textWidth(ctx, main, mainFont) + padX * 2);
  const bodyH = Math.max(layout.bodyH * scale, 46);
  const left = Math.max(schedule.x, origin.x + bodyW + 6);
  const rows = layout.rows.map((row, index) => ({
    row,
    text: labels[index],
    x: left,
    y: schedule.y + index * rowH,
    w: rowW,
    h: Math.max(16, rowH - 2),
  }));
  const empty = [];
  for (let i = 0; i < layout.empty; i += 1) {
    empty.push({
      x: left,
      y: schedule.y + (layout.rows.length + i) * rowH,
      w: rowW,
      h: Math.max(16, rowH - 2),
    });
  }
  return {
    body: { x: origin.x, y: origin.y, w: bodyW, h: bodyH, name, main },
    rows,
    empty,
  };
}

function contains(rect, x, y) {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

export function hitPower(plan, x, y, project, scale, ctx) {
  for (let i = (plan.outlets || []).length - 1; i >= 0; i -= 1) {
    const outlet = plan.outlets[i];
    if (Math.hypot(outlet.x - x, outlet.y - y) <= 220) return { kind: "outlet", id: outlet.id, x: outlet.x, y: outlet.y };
  }
  if (!project || !ctx) return null;
  const at = project(x, y);
  for (let i = (plan.panels || []).length - 1; i >= 0; i -= 1) {
    const panel = plan.panels[i];
    const frames = panelFrames(ctx, plan, panel, project, scale);
    for (let index = frames.rows.length - 1; index >= 0; index -= 1) {
      const rect = frames.rows[index];
      if (contains(rect, at.x, at.y)) return { kind: "breaker", id: rect.row.id, x: panel.x, y: panel.y };
    }
    if (frames.empty.some((rect) => contains(rect, at.x, at.y))) return { kind: "slot", id: panel.id, x: panel.x, y: panel.y };
    if (contains(frames.body, at.x, at.y)) return { kind: "panel", id: panel.id, x: panel.x, y: panel.y };
  }
  return null;
}

export function related(plan, selection) {
  const outlets = new Set();
  const breakers = new Set();
  const panels = new Set();
  const items = new Set();
  const addBreaker = (breaker) => {
    if (!breaker) return;
    breakers.add(breaker.id);
    panels.add(breaker.panelId);
    if (breaker.itemId) items.add(breaker.itemId);
    for (const outlet of plan.outlets || []) {
      if (outlet.breakerId === breaker.id) outlets.add(outlet.id);
    }
  };
  const id = selection?.ids?.[0];
  if (selection?.kind === "outlet") {
    const outlet = (plan.outlets || []).find((row) => row.id === id);
    if (outlet) {
      outlets.add(outlet.id);
      addBreaker((plan.breakers || []).find((row) => row.id === outlet.breakerId));
    }
  } else if (selection?.kind === "breaker") {
    addBreaker((plan.breakers || []).find((row) => row.id === id));
  } else if (selection?.kind === "panel") {
    panels.add(id);
  } else if (selection?.kind === "item") {
    items.add(id);
    for (const breaker of plan.breakers || []) {
      if (breaker.itemId === id) addBreaker(breaker);
    }
  }
  return { outlets, breakers, panels, items };
}

export function powerChecks(plan) {
  const notes = [];
  const push = (text, focus) => notes.push({ text, ...focus });
  for (const panel of plan.panels || []) {
    const rows = breakersOf(plan, panel.id);
    const seen = new Map();
    for (const row of rows) {
      const key = String(row.number);
      if (seen.has(key)) push(`${panel.name} の回路番号 ${key} が重複しています`, { breakerId: row.id });
      seen.set(key, row);
    }
    if (rows.length > panel.slots) push(`${panel.name} の回路が行数より多いです`, { panelId: panel.id });
    const sum = rows.filter((row) => row.role !== "spare").reduce((acc, row) => acc + Number(row.amp), 0);
    if (sum > panel.mainAmp) push(`${panel.name} の分岐の単純合計（予備を除く） ${sum}A が主幹 ${panel.mainAmp}A を超えています`, { panelId: panel.id });
  }
  for (const outlet of plan.outlets || []) {
    if (!outlet.breakerId) push(`${outletText(outlet)} がどのブレーカーにも属していません`, { outletId: outlet.id });
  }
  for (const breaker of plan.breakers || []) {
    const outlets = (plan.outlets || []).filter((row) => row.breakerId === breaker.id);
    const sockets = outlets.filter((row) => row.kind !== "switch");
    const label = `回路 ${breaker.number}`;
    if (breaker.role === "spare" && (outlets.length || breaker.itemId)) {
      push(`${label} は予備なのに接続があります`, { breakerId: breaker.id });
    }
    if (breaker.role === "dedicated") {
      if (!breaker.itemId) push(`${label} は専用ですが機器がありません`, { breakerId: breaker.id });
      if (!sockets.length) push(`${label} は専用ですがコンセントがありません`, { breakerId: breaker.id });
      if (sockets.length > 1) push(`${label} は専用ですがコンセントが複数あります`, { breakerId: breaker.id });
    }
    for (const outlet of sockets) {
      if (outlet.amp > breaker.amp) push(`${outletText(outlet)} の ${outlet.amp}A がブレーカー ${breaker.amp}A を超えています`, { outletId: outlet.id, breakerId: breaker.id });
      if (breaker.role === "general" && (outlet.voltage !== "1p100" || outlet.amp >= 30)) {
        push(`${label} は一般ですが ${voltageLabel(outlet.voltage)} ${outlet.amp}A のコンセントがあります`, { breakerId: breaker.id });
      }
    }
    if (breaker.itemId) {
      const item = (plan.items || []).find((row) => row.id === breaker.itemId);
      const spec = parsePower(item?.power);
      const outlet = sockets[0];
      if (item && spec && outlet && spec.voltage !== outlet.voltage) {
        push(`${item.name} の電気仕様 ${voltageLabel(spec.voltage)} とコンセント ${voltageLabel(outlet.voltage)} が違います`, { itemId: item.id, outletId: outlet.id });
      }
      if (item && spec && spec.amp > breaker.amp) {
        push(`${item.name} の ${spec.amp}A がブレーカー ${breaker.amp}A を超えています`, { itemId: item.id, breakerId: breaker.id });
      }
    }
    if (breaker.role === "general") {
      const va = sockets.length * 150;
      const limit = (breaker.amp / 20) * 1500;
      if (sockets.length && va > limit) push(`${label} の見込み ${va}VA が目安 ${Math.round(limit)}VA を超えています`, { breakerId: breaker.id });
    }
  }
  for (const item of plan.items || []) {
    if (item.openingId) continue;
    const spec = parsePower(item.power);
    if (!heavyPower(spec, item.power)) continue;
    const linked = (plan.breakers || []).some((row) => row.itemId === item.id && row.role === "dedicated");
    if (!linked) push(`${item.name} の専用回路がありません`, { itemId: item.id });
  }
  return notes;
}

function outletText(outlet) {
  if (outlet.kind === "switch") return `手元開閉器 ${outlet.amp}A`;
  return `${outlet.kind === "surface" ? "露出" : "埋め込み"} ${voltageLabel(outlet.voltage)} ${outlet.amp}A`;
}

export function powerCounts(plan) {
  const symbols = new Map();
  for (const outlet of plan.outlets || []) {
    const key = outletText(outlet);
    symbols.set(key, (symbols.get(key) || 0) + 1);
  }
  return {
    symbols: [...symbols.entries()],
    spare: (plan.breakers || []).filter((row) => row.role === "spare").length,
    empty: (plan.panels || []).reduce((acc, panel) => acc + Math.max(0, panel.slots - breakersOf(plan, panel.id).length), 0),
  };
}

export function phaseLoad(plan) {
  let l1 = 0;
  let l2 = 0;
  let three = 0;
  for (const breaker of plan.breakers || []) {
    if (breaker.role === "spare") continue;
    if (breaker.phase === "L1") l1 += breaker.amp;
    else if (breaker.phase === "L2") l2 += breaker.amp;
    else if (breaker.phase === "L1L2") {
      l1 += breaker.amp;
      l2 += breaker.amp;
    } else if (breaker.phase === "3P") three += breaker.amp;
  }
  return { l1, l2, three };
}

export function drawPower(ctx, plan, ui, screen, scale) {
  if (ui.tab !== "power") return;
  const focus = related(plan, ui.selection);
  const warned = new Set();
  for (const note of powerChecks(plan)) {
    if (note.outletId) warned.add(note.outletId);
  }
  const activeBreaker = focus.breakers.size === 1 ? [...focus.breakers][0] : null;
  for (const panel of plan.panels || []) drawPanel(ctx, plan, panel, screen, scale, focus, activeBreaker);
  for (const outlet of plan.outlets || []) {
    drawOutlet(ctx, outlet, screen, scale, focus.outlets.has(outlet.id), warned.has(outlet.id));
    const breaker = (plan.breakers || []).find((row) => row.id === outlet.breakerId);
    if (breaker && activeBreaker === breaker.id) {
      const from = breakerAnchor(ctx, plan, breaker, screen, scale);
      const to = screen(outlet.x, outlet.y);
      ctx.save();
      ctx.strokeStyle = "#0060b0";
      ctx.lineWidth = 2;
      ctx.setLineDash([7, 5]);
      ctx.beginPath();
      ctx.moveTo(from.x, from.y);
      ctx.lineTo(to.x, to.y);
      ctx.stroke();
      ctx.restore();
    }
    if (breaker) {
      const at = screen(outlet.x, outlet.y);
      ctx.fillStyle = "#0060b0";
      ctx.font = "12px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText(String(breaker.number), at.x, at.y - Math.max(14, 180 * scale) - 2);
    }
  }
}

function breakerAnchor(ctx, plan, breaker, screen, scale) {
  const panel = (plan.panels || []).find((row) => row.id === breaker.panelId);
  if (!panel) return screen(breaker.x || 0, breaker.y || 0);
  const frames = panelFrames(ctx, plan, panel, screen, scale);
  const row = frames.rows.find((entry) => entry.row.id === breaker.id);
  if (!row) return { x: frames.body.x, y: frames.body.y + frames.body.h / 2 };
  return { x: row.x, y: row.y + row.h / 2 };
}

function drawPanel(ctx, plan, panel, screen, scale, focus, activeBreaker) {
  const frames = panelFrames(ctx, plan, panel, screen, scale);
  const body = frames.body;
  ctx.save();
  ctx.fillStyle = focus.panels.has(panel.id) ? "#e7f0fb" : "#fff";
  ctx.strokeStyle = focus.panels.has(panel.id) ? "#0060b0" : "#243040";
  ctx.lineWidth = 2;
  ctx.fillRect(body.x, body.y, body.w, body.h);
  ctx.strokeRect(body.x, body.y, body.w, body.h);
  ctx.fillStyle = "#243040";
  ctx.font = "13px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "top";
  ctx.fillText(body.name, body.x + 8, body.y + 8);
  ctx.font = "11px sans-serif";
  ctx.fillStyle = "#5c6775";
  ctx.fillText(body.main, body.x + 8, body.y + 26);
  ctx.restore();
  for (const rect of frames.rows) {
    drawBreakerRow(ctx, rect, frames.rows.length > 0 && (focus.breakers.has(rect.row.id) || activeBreaker === rect.row.id));
  }
  for (const rect of frames.empty) {
    ctx.save();
    ctx.fillStyle = "#f3f5f7";
    ctx.strokeStyle = "#c5ccd3";
    ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
    ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
    ctx.fillStyle = "#7b8794";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.fillText("空きマス", rect.x + 8, rect.y + rect.h / 2);
    ctx.restore();
  }
}

function drawBreakerRow(ctx, rect, on) {
  ctx.save();
  ctx.fillStyle = on ? "#e7f0fb" : "#fff";
  ctx.strokeStyle = on ? "#0060b0" : "#8e98a3";
  ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
  ctx.strokeRect(rect.x, rect.y, rect.w, rect.h);
  ctx.fillStyle = "#243040";
  ctx.font = "12px sans-serif";
  ctx.textAlign = "left";
  ctx.textBaseline = "middle";
  ctx.fillText(rect.text, rect.x + 8, rect.y + rect.h / 2);
  ctx.restore();
}

function drawOutlet(ctx, outlet, screen, scale, on, warn) {
  const at = screen(outlet.x, outlet.y);
  const r = Math.max(9, 160 * scale);
  ctx.save();
  ctx.translate(at.x, at.y);
  ctx.rotate(outlet.rotation || 0);
  ctx.fillStyle = "#fff";
  ctx.strokeStyle = on ? "#0060b0" : PINK;
  ctx.lineWidth = on ? 3 : 2;
  if (outlet.kind === "flush") {
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.fillRect(-r, -r, r * 2, r * 2);
    ctx.strokeRect(-r, -r, r * 2, r * 2);
  }
  ctx.strokeStyle = PINK;
  ctx.fillStyle = PINK;
  ctx.lineWidth = 1.5;
  if (outlet.kind === "switch") {
    ctx.font = `bold ${Math.max(11, r)}px sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("S", 0, -r * 0.15);
    ctx.font = `${Math.max(8, r * 0.42)}px sans-serif`;
    ctx.fillText(`${outlet.amp}A`, 0, r * 0.42);
  } else {
    drawGlyph(ctx, outlet.voltage, r);
    if (outlet.amp !== 15) {
      ctx.font = `${Math.max(8, r * 0.42)}px sans-serif`;
      ctx.textAlign = "left";
      ctx.textBaseline = "alphabetic";
      ctx.fillText(`${outlet.amp}A`, r * 0.15, r * 0.9);
    }
  }
  ctx.restore();
  ctx.fillStyle = "#243040";
  ctx.font = "11px sans-serif";
  ctx.textAlign = "left";
  ctx.fillText(outletText(outlet), at.x + r + 4, at.y + 4);
  if (warn) {
    ctx.fillStyle = "#c2410c";
    ctx.beginPath();
    ctx.arc(at.x + r, at.y - r, 4, 0, Math.PI * 2);
    ctx.fill();
  }
}

function drawGlyph(ctx, voltage, r) {
  ctx.beginPath();
  if (voltage === "3p200") {
    for (let i = 0; i < 3; i += 1) {
      const angle = -Math.PI / 2 + (i * 2 * Math.PI) / 3;
      ctx.moveTo(0, 0);
      ctx.lineTo(Math.cos(angle) * r * 0.62, Math.sin(angle) * r * 0.62);
    }
  } else if (voltage === "1p200") {
    ctx.moveTo(-r * 0.62, 0);
    ctx.lineTo(r * 0.62, 0);
    ctx.moveTo(-r * 0.28, -r * 0.28);
    ctx.lineTo(-r * 0.28, r * 0.28);
    ctx.moveTo(r * 0.28, -r * 0.28);
    ctx.lineTo(r * 0.28, r * 0.28);
  } else {
    ctx.moveTo(-r * 0.22, -r * 0.62);
    ctx.lineTo(-r * 0.22, r * 0.62);
    ctx.moveTo(r * 0.22, -r * 0.62);
    ctx.lineTo(r * 0.22, r * 0.62);
  }
  ctx.stroke();
}

export function powerToRows(plan) {
  const rows = [];
  for (const panel of plan.panels || []) {
    rows.push(sheetRow({
      id: panel.id,
      kind: "盤",
      name: panel.name,
      x: panel.x,
      y: panel.y,
      rotation: panel.rotation,
      roomId: panel.roomId,
      slots: panel.slots,
      mainAmp: panel.mainAmp,
    }));
  }
  for (const breaker of plan.breakers || []) {
    rows.push(sheetRow({
      id: breaker.id,
      kind: "ブレーカー",
      panelId: breaker.panelId,
      itemId: breaker.itemId,
      name: breaker.name,
      number: breaker.number,
      voltage: voltageLabel(breaker.voltage),
      amp: breaker.amp,
      role: roleLabel(breaker.role),
      phase: breaker.phase,
    }));
  }
  for (const outlet of plan.outlets || []) {
    rows.push(sheetRow({
      id: outlet.id,
      kind: outlet.kind === "switch" ? "手元開閉器" : "コンセント",
      symbol: outlet.kind === "switch" ? "" : outlet.kind === "surface" ? "露出" : "埋め込み",
      breakerId: outlet.breakerId,
      x: outlet.x,
      y: outlet.y,
      rotation: outlet.rotation,
      roomId: outlet.roomId,
      voltage: voltageLabel(outlet.voltage),
      amp: outlet.amp,
    }));
  }
  return rows;
}

function sheetRow(row) {
  return {
    id: row.id || "",
    種別: row.kind || "",
    記号: row.symbol || "",
    盤id: row.panelId || "",
    回路id: row.breakerId || "",
    機器id: row.itemId || "",
    x_mm: row.x ?? "",
    y_mm: row.y ?? "",
    角度: row.rotation ?? "",
    名称: row.name || "",
    回路番号: row.number ?? "",
    電圧: row.voltage || "",
    電流_A: row.amp ?? "",
    用途: row.role || "",
    相: row.phase || "",
    行数: row.slots ?? "",
    主幹_A: row.mainAmp ?? "",
    部屋id: row.roomId || "",
  };
}

export const POWER_HEADERS = ["id", "種別", "記号", "盤id", "回路id", "機器id", "x_mm", "y_mm", "角度", "名称", "回路番号", "電圧", "電流_A", "用途", "相", "行数", "主幹_A", "部屋id"];

function voltageCode(label) {
  if (String(label).includes("三相")) return "3p200";
  if (String(label).includes("200")) return "1p200";
  if (String(label).includes("100")) return "1p100";
  return "";
}

function roleCode(label) {
  if (label === "専用") return "dedicated";
  if (label === "予備") return "spare";
  if (label === "一般") return "general";
  return "general";
}

export function rowsToPower(rows) {
  const panels = [];
  const breakers = [];
  const outlets = [];
  for (const row of rows || []) {
    if (row.種別 === "盤") {
      panels.push({
        id: row.id,
        name: row.名称,
        x: row.x_mm,
        y: row.y_mm,
        rotation: row.角度,
        roomId: row.部屋id,
        slots: row.行数,
        mainAmp: row.主幹_A,
      });
    } else if (row.種別 === "ブレーカー") {
      breakers.push({
        id: row.id,
        panelId: row.盤id,
        number: row.回路番号,
        voltage: voltageCode(row.電圧),
        amp: row.電流_A,
        role: roleCode(row.用途),
        name: row.名称,
        phase: row.相,
        itemId: row.機器id,
      });
    } else if (row.種別 === "コンセント" || row.種別 === "手元開閉器") {
      outlets.push({
        id: row.id,
        kind: row.種別 === "手元開閉器" ? "switch" : row.記号 === "露出" ? "surface" : "flush",
        voltage: voltageCode(row.電圧),
        amp: row.電流_A,
        x: row.x_mm,
        y: row.y_mm,
        rotation: row.角度,
        roomId: row.部屋id,
        breakerId: row.回路id,
      });
    }
  }
  return { panels, breakers, outlets };
}

function esc(value) {
  return String(value ?? "").replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

export function powerPanel(plan, ui) {
  const counts = powerCounts(plan);
  const load = phaseLoad(plan);
  const max = Math.max(load.l1, load.l2, 1);
  const notes = powerChecks(plan);
  const groups = [
    ["埋め込み", POWER_SYMBOLS.filter((entry) => entry.kind === "flush")],
    ["露出", POWER_SYMBOLS.filter((entry) => entry.kind === "surface")],
    ["手元開閉器", POWER_SYMBOLS.filter((entry) => entry.kind === "switch")],
  ];
  const symbols = groups.map(([name, list]) => `
    <details open>
      <summary>${name}</summary>
      ${list.map((entry) => `<button type="button" data-power-symbol="${entry.id}" class="${ui.tool === "power" && ui.powerSymbol === entry.id ? "active" : ""}">${esc(entry.label)}</button>`).join("")}
    </details>
  `).join("");
  const panels = (plan.panels || []).map((panel) => {
    const rows = breakersOf(plan, panel.id);
    const list = rows.map((row) => `<button type="button" data-power-focus="breaker" data-id="${row.id}">${esc(row.number)} ${esc(voltageLabel(row.voltage))} ${row.amp}A ${esc(roleLabel(row.role))} ${esc(row.name || "")}</button>`).join("");
    const full = ui.powerPrompt === panel.id;
    const spare = rows.some((row) => row.role === "spare");
    return `
      <div class="side-block">
        <button type="button" data-power-focus="panel" data-id="${panel.id}">${esc(panel.name)}</button>
        <p class="note">分岐の単純合計（予備を除く） ${rows.filter((row) => row.role !== "spare").reduce((acc, row) => acc + row.amp, 0)}A / 主幹 ${panel.mainAmp}A。空きマス ${Math.max(0, panel.slots - rows.length)}</p>
        ${list}
        <button type="button" data-power-add="${panel.id}">回路を足す</button>
        ${full ? `<p class="note">この盤の行がいっぱいです。</p>${spare ? `<button type="button" data-power-spare="${panel.id}">予備を使う</button>` : ""}<button type="button" data-power-grow="${panel.id}">行を増やす</button>` : ""}
      </div>
    `;
  }).join("");
  const legend = counts.symbols.map(([name, count]) => `<li>${esc(name)} ${count}</li>`).join("");
  const warnings = notes.length
    ? notes.map((note) => `<button type="button" class="power-warn" data-power-note="${esc(note.breakerId || note.outletId || note.itemId || note.panelId || "")}" data-note-kind="${note.breakerId ? "breaker" : note.outletId ? "outlet" : note.itemId ? "item" : "panel"}">${esc(note.text)}</button>`).join("")
    : `<p class="note">対応の不足はありません。</p>`;
  return `
    <div class="side-block">
      <h2>配電</h2>
      <p class="note">このタブのときだけ、図面に配電を表示します。線は選んだ回路だけ引きます。</p>
      <button type="button" id="power-select" class="${ui.tool === "select" ? "active" : ""}">選択</button>
      <button type="button" id="power-panel" class="${ui.tool === "power" && ui.powerSymbol === "panel" ? "active" : ""}">分電盤を置く</button>
      <button type="button" id="power-suggest">専用の案を入れる</button>
    </div>
    <div class="side-block">
      <h2>記号</h2>
      ${symbols}
    </div>
    <div class="side-block">
      <h2>分電盤</h2>
      ${panels || `<p class="note">分電盤はまだありません。</p>`}
    </div>
    <div class="side-block">
      <h2>単相の偏り</h2>
      <p class="note">L1 ${load.l1}A</p>
      <div class="phase-track"><span style="width:${Math.round((load.l1 / max) * 100)}%"></span></div>
      <p class="note">L2 ${load.l2}A</p>
      <div class="phase-track"><span style="width:${Math.round((load.l2 / max) * 100)}%"></span></div>
      <p class="note">三相 ${load.three}A。見込みであり、計算書ではありません。</p>
    </div>
    <div class="side-block">
      <h2>確認</h2>
      ${warnings}
    </div>
    <div class="side-block">
      <h2>凡例</h2>
      <ul>${legend || "<li>記号はまだありません。</li>"}</ul>
      <p class="note">予備 ${counts.spare} 回路。空きマス ${counts.empty}。</p>
    </div>
    ${powerEditor(plan, ui)}
  `;
}

function powerEditor(plan, ui) {
  const id = ui.selection?.ids?.[0];
  if (ui.selection?.kind === "panel") {
    const panel = (plan.panels || []).find((row) => row.id === id);
    if (!panel) return "";
    return `
      <div class="side-block">
        <h2>分電盤の値</h2>
        <label>名称<input id="power-name" data-power-field="name" value="${esc(panel.name)}" /></label>
        <label>主幹 A<input id="power-main" data-power-field="mainAmp" type="number" min="1" value="${panel.mainAmp}" /></label>
        <label>行数<input id="power-slots" data-power-field="slots" type="number" min="1" value="${panel.slots}" /></label>
      </div>
    `;
  }
  if (ui.selection?.kind === "breaker") {
    const breaker = (plan.breakers || []).find((row) => row.id === id);
    if (!breaker) return "";
    const items = (plan.items || []).filter((entry) => !entry.openingId);
    return `
      <div class="side-block">
        <h2>回路 ${esc(breaker.number)}</h2>
        <label>回路番号<input id="power-number" data-power-field="number" value="${esc(breaker.number)}" /></label>
        <label>名称<input id="power-name" data-power-field="name" value="${esc(breaker.name)}" /></label>
        <label>電圧<select id="power-voltage" data-power-field="voltage">
          ${["1p100", "1p200", "3p200"].map((value) => `<option value="${value}" ${breaker.voltage === value ? "selected" : ""}>${voltageLabel(value)}</option>`).join("")}
        </select></label>
        <label>電流 A<select id="power-amp" data-power-field="amp">
          ${[15, 20, 30].map((value) => `<option value="${value}" ${breaker.amp === value ? "selected" : ""}>${value}</option>`).join("")}
        </select></label>
        <label>用途<select id="power-role" data-power-field="role">
          ${[["dedicated", "専用"], ["general", "一般"], ["spare", "予備"]].map(([value, label]) => `<option value="${value}" ${breaker.role === value ? "selected" : ""}>${label}</option>`).join("")}
        </select></label>
        <label>相<select id="power-phase" data-power-field="phase">
          ${["L1", "L2", "L1L2", "3P"].map((value) => `<option value="${value}" ${breaker.phase === value ? "selected" : ""}>${value}</option>`).join("")}
        </select></label>
        <label>機器<select id="power-item" data-power-field="itemId">
          <option value="">なし</option>
          ${items.map((entry) => `<option value="${entry.id}" ${breaker.itemId === entry.id ? "selected" : ""}>${esc(entry.name)}</option>`).join("")}
        </select></label>
      </div>
    `;
  }
  if (ui.selection?.kind === "outlet") {
    const outlet = (plan.outlets || []).find((row) => row.id === id);
    if (!outlet) return "";
    const options = (plan.breakers || []).map((row) => {
      const panel = (plan.panels || []).find((entry) => entry.id === row.panelId);
      return `<option value="${row.id}" ${outlet.breakerId === row.id ? "selected" : ""}>${esc(panel?.name || "")} ${esc(row.number)} ${esc(roleLabel(row.role))}</option>`;
    }).join("");
    return `
      <div class="side-block">
        <h2>${esc(outletText(outlet))}</h2>
        <label>回路<select id="power-breaker" data-power-field="breakerId">
          <option value="">未接続</option>
          ${options}
        </select></label>
        ${outlet.kind === "switch" ? `<label>電流 A<select id="power-amp" data-power-field="amp">${[15, 20, 30].map((value) => `<option value="${value}" ${outlet.amp === value ? "selected" : ""}>${value}</option>`).join("")}</select></label>` : ""}
      </div>
    `;
  }
  return "";
}

export function bindPower(sidebar, store, ui, refresh) {
  sidebar.querySelector("#power-select")?.addEventListener("click", () => ui.setTool("select"));
  sidebar.querySelector("#power-panel")?.addEventListener("click", () => ui.setPowerSymbol("panel"));
  sidebar.querySelector("#power-suggest")?.addEventListener("click", () => {
    store.update((plan) => {
      suggestDedicated(plan);
    });
    ui.setTool("select");
    refresh();
  });
  sidebar.querySelectorAll("[data-power-symbol]").forEach((button) => {
    button.addEventListener("click", () => ui.setPowerSymbol(button.dataset.powerSymbol));
  });
  sidebar.querySelectorAll("[data-power-focus]").forEach((button) => {
    button.addEventListener("click", () => {
      ui.setTool("select");
      ui.select({ kind: button.dataset.powerFocus, ids: [button.dataset.id] });
    });
  });
  sidebar.querySelectorAll("[data-power-note]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.powerNote;
      if (!id) return;
      ui.setTool("select");
      ui.select({ kind: button.dataset.noteKind, ids: [id] });
    });
  });
  sidebar.querySelectorAll("[data-power-add]").forEach((button) => {
    button.addEventListener("click", () => {
      let added = null;
      let full = false;
      store.update((plan) => {
        const panel = plan.panels.find((row) => row.id === button.dataset.powerAdd);
        if (!panel) return;
        const result = tryAddCircuit(plan, panel);
        added = result.breaker;
        full = result.prompt;
      });
      if (full) ui.setPowerPrompt(button.dataset.powerAdd);
      else {
        ui.setPowerPrompt(null);
        if (added) ui.select({ kind: "breaker", ids: [added.id] });
      }
      refresh();
    });
  });
  sidebar.querySelectorAll("[data-power-spare]").forEach((button) => {
    button.addEventListener("click", () => {
      let breaker = null;
      store.update((plan) => {
        const panel = plan.panels.find((row) => row.id === button.dataset.powerSpare);
        if (panel) breaker = useSpare(plan, panel);
      });
      ui.setPowerPrompt(null);
      if (breaker) ui.select({ kind: "breaker", ids: [breaker.id] });
      refresh();
    });
  });
  sidebar.querySelectorAll("[data-power-grow]").forEach((button) => {
    button.addEventListener("click", () => {
      let breaker = null;
      store.update((plan) => {
        const panel = plan.panels.find((row) => row.id === button.dataset.powerGrow);
        if (panel) breaker = growPanel(plan, panel);
      });
      ui.setPowerPrompt(null);
      if (breaker) ui.select({ kind: "breaker", ids: [breaker.id] });
      refresh();
    });
  });
  sidebar.querySelectorAll("[data-power-field]").forEach((input) => {
    input.addEventListener("change", () => {
      const field = input.dataset.powerField;
      const sel = ui.selection;
      if (!sel) return;
      store.update((plan) => {
        const list = sel.kind === "panel" ? plan.panels : sel.kind === "breaker" ? plan.breakers : plan.outlets;
        const row = list.find((entry) => entry.id === sel.ids[0]);
        if (!row) return;
        if (field === "mainAmp" || field === "slots" || field === "amp") row[field] = Number(input.value) || row[field];
        else if (field === "itemId" || field === "breakerId") row[field] = input.value || null;
        else if (field === "voltage") {
          row.voltage = input.value;
          row.phase = phaseFor(input.value, plan, row.panelId);
        } else row[field] = input.value;
      });
      refresh();
    });
  });
}
