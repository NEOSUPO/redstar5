import { ensureRoom, nearestEdge } from "./geometry.js";
import { migrateOpenings } from "./openings.js?v=20261022f";
import { normalizePower } from "./power.js?v=20261026d";
import { clearMissingHosts } from "./surface.js";

const STORAGE_KEY = "neosupo-star-beta5-plans-v1";

export function createStore() {
  const listeners = new Set();
  let history = [];
  let future = [];
  let plans = loadAll();
  let activeId = plans[0]?.id || null;
  if (!activeId) {
    const created = blankPlan("NewPlan");
    plans = [created];
    activeId = created.id;
    persist();
  }

  function current() {
    return plans.find((plan) => plan.id === activeId);
  }

  function emit() {
    listeners.forEach((fn) => fn(current()));
  }

  function persist() {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(plans));
    } catch (error) {
      console.error(error);
    }
  }

  function update(mutator) {
    checkpoint();
    mutate(mutator);
  }

  function checkpoint() {
    history.push(structuredClone(current()));
    if (history.length > 80) history.shift();
    future = [];
  }

  function mutate(mutator) {
    const plan = current();
    mutator(plan);
    plan.updatedAt = Date.now();
    persist();
    emit();
  }

  return {
    subscribe(fn) {
      listeners.add(fn);
      fn(current());
      return () => listeners.delete(fn);
    },
    get: current,
    list: () => plans.map((plan) => ({ id: plan.id, name: plan.name, updatedAt: plan.updatedAt })),
    update,
    checkpoint,
    mutate,
    undo() {
      if (!history.length) return;
      future.push(structuredClone(current()));
      const prev = history.pop();
      plans = plans.map((plan) => (plan.id === activeId ? prev : plan));
      persist();
      emit();
    },
    redo() {
      if (!future.length) return;
      history.push(structuredClone(current()));
      const next = future.pop();
      plans = plans.map((plan) => (plan.id === activeId ? next : plan));
      persist();
      emit();
    },
    canUndo: () => history.length > 0,
    canRedo: () => future.length > 0,
    newPlan(settings) {
      const plan = blankPlan("NewPlan", settings);
      plans.unshift(plan);
      activeId = plan.id;
      history = [];
      future = [];
      persist();
      emit();
    },
    open(id) {
      if (!plans.some((plan) => plan.id === id)) return;
      activeId = id;
      history = [];
      future = [];
      emit();
    },
    duplicate() {
      const copy = structuredClone(current());
      copy.id = uid();
      copy.name = `${copy.name}_Copy`;
      copy.updatedAt = Date.now();
      copy.settings.exported = false;
      plans.unshift(copy);
      activeId = copy.id;
      history = [];
      future = [];
      persist();
      emit();
    },
    remove(id) {
      plans = plans.filter((plan) => plan.id !== id);
      if (!plans.length) plans = [blankPlan("NewPlan")];
      if (activeId === id) activeId = plans[0].id;
      history = [];
      future = [];
      persist();
      emit();
    },
    rename(name) {
      update((plan) => {
        plan.name = name || "NewPlan";
      });
    },
    importPlans(data) {
      const list = Array.isArray(data) ? data : [data];
      const created = list.map((entry) => {
        const plan = normalizePlan(entry);
        plan.id = uid();
        plan.updatedAt = Date.now();
        return plan;
      });
      plans = [...created, ...plans];
      activeId = created[0].id;
      history = [];
      future = [];
      persist();
      emit();
    },
  };
}

export function blankPlan(name, settings = {}) {
  return normalizePlan({
    id: uid(),
    name,
    updatedAt: Date.now(),
    settings: {
      ceiling: Number(settings.ceiling) || 2700,
      floorHeight: Number(settings.floorHeight) || 4000,
      wall: Number(settings.wall) || 150,
      module: Number(settings.module) || 1000,
      division: Number(settings.division) || 2,
      snap: true,
      rotationStep: 15,
      brightness: 1,
      exported: false,
    },
    rooms: [],
    items: [],
    openings: [],
    views: [],
    customItems: [],
    underlay: null,
  });
}

export function normalizePlan(plan) {
  if (!plan || typeof plan !== "object" || Array.isArray(plan)) {
    throw new Error("プランの形式ではありません");
  }
  const settings = {
    ceiling: 2700,
    floorHeight: 4000,
    wall: 150,
    module: 1000,
    division: 2,
    snap: true,
    rotationStep: 15,
    brightness: 1,
    exported: false,
    ...(plan.settings || {}),
  };
  settings.brightness = [0, 1, 2].includes(Number(settings.brightness)) ? Number(settings.brightness) : 1;
  const rooms = (Array.isArray(plan.rooms) ? plan.rooms : []).map((room) => ensureRoom({
    floorFinish: "床",
    floorColor: room.color || "#d5e4f2",
    wallFinish: "壁",
    wallColor: "#8e98a3",
    dropCeiling: 0,
    raisedFloor: 0,
    ...room,
  }));
  const items = (Array.isArray(plan.items) ? plan.items : []).map((entry) => ({
    price: null,
    groupId: null,
    roomId: null,
    wallSide: null,
    opening: !!entry.opening && !entry.openingId,
    leaf: entry.leaf || "",
    hinge: entry.hinge || "start",
    openingId: entry.openingId || null,
    light: entry.catalogId === "light" || !!entry.light,
    lightOn: entry.catalogId === "light" || !!entry.lightOn,
    lightLevel: entry.lightLevel || 10,
    lightColor: entry.lightColor || "#fff4d6",
    residential: !!entry.residential,
    design: entry.design || "",
    ...entry,
    price: entry.price == null || entry.price === "" ? null : Number(entry.price),
    opening: !!entry.opening && !entry.openingId,
    light: entry.catalogId === "light" || !!entry.light,
    openingId: entry.openingId || null,
    hostId: entry.hostId || null,
    locked: !!entry.locked,
  }));
  const openings = (Array.isArray(plan.openings) ? plan.openings : []).map((opening) => ({
    id: opening.id || uid(),
    roomId: opening.roomId || null,
    wallSide: opening.wallSide || null,
    edgeIndex: opening.edgeIndex == null || opening.edgeIndex === "" ? null : Number(opening.edgeIndex),
    along: Number(opening.along) || 0,
    w: Number(opening.w) || 1000,
    h: Number(opening.h) || 1000,
    sill: Number(opening.sill) || 0,
    preset: opening.preset || "hole",
  }));
  const next = {
    id: plan.id || uid(),
    name: plan.name || "NewPlan",
    updatedAt: plan.updatedAt || Date.now(),
    settings,
    rooms,
    items,
    openings,
    views: Array.isArray(plan.views) ? plan.views : [],
    customItems: Array.isArray(plan.customItems) ? plan.customItems : [],
    underlay: plan.underlay?.href ? plan.underlay : null,
    panels: plan.panels,
    breakers: plan.breakers,
    outlets: plan.outlets,
  };
  normalizePower(next);
  attachWalls(next);
  migrateOpenings(next);
  clearMissingHosts(next);
  return next;
}

function attachWalls(plan) {
  for (const entry of plan.items) {
    if (entry.place !== "wall" || entry.openingId || (entry.roomId && (entry.wallSide || entry.edgeIndex != null))) continue;
    let best = null;
    for (const room of plan.rooms) {
      const hit = nearestEdge(room, entry.x, entry.y);
      if (!best || hit.dist < best.dist) best = { ...hit, room };
    }
    if (!best) continue;
    entry.roomId = best.room.id;
    entry.edgeIndex = best.edgeIndex;
  }
}

export function uid() {
  return Math.random().toString(36).slice(2, 10);
}

function loadAll() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    const parsed = raw ? JSON.parse(raw) : [];
    if (!Array.isArray(parsed)) return [];
    return parsed.map((plan) => normalizePlan(plan));
  } catch {
    return [];
  }
}

export function snapValue(value, step, enabled) {
  if (!enabled) return value;
  const steps = (Array.isArray(step) ? step : [step]).filter((size) => size > 0);
  if (!steps.length) return value;
  let best = value;
  let bestDist = Infinity;
  for (const size of steps) {
    const snapped = Math.round(value / size) * size;
    const dist = Math.abs(snapped - value);
    if (dist < bestDist - 1e-6) {
      best = snapped;
      bestDist = dist;
    }
  }
  return best;
}
