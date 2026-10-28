const SURFACE_IDS = new Set(["bench", "sink", "balance"]);
const KEEP_ON_FLOOR = new Set(["hood", "cabinet", "bsc", "clean", "chair", "shower", "pillar"]);
const OVERLAP = 0.3;

export function isSurface(entry) {
  return !!entry && SURFACE_IDS.has(entry.catalogId) && !entry.hostId;
}

export function canSit(entry) {
  if (!entry || entry.openingId || entry.place !== "floor") return false;
  if (SURFACE_IDS.has(entry.catalogId) || KEEP_ON_FLOOR.has(entry.catalogId)) return false;
  return true;
}

export function counterTop(items, entry) {
  if (!entry?.hostId) return 0;
  const host = (items || []).find((row) => row.id === entry.hostId);
  return host ? Number(host.h) || 0 : Number(entry.z) || 0;
}

export function findHost(items, guest) {
  if (!canSit(guest)) return null;
  const guestArea = Math.max(1, Number(guest.w) * Number(guest.d));
  let best = null;
  let bestRatio = 0;
  for (const host of items || []) {
    if (!isSurface(host) || host.id === guest.id) continue;
    const hostArea = Math.max(1, Number(host.w) * Number(host.d));
    if (guestArea >= hostArea) continue;
    const ratio = overlapRatio(guest, host);
    if (ratio + 1e-6 >= OVERLAP && ratio > bestRatio) {
      best = host;
      bestRatio = ratio;
    }
  }
  return best;
}

export function seatItems(plan, ids) {
  const wanted = ids ? new Set(ids) : null;
  for (const entry of plan.items || []) {
    if (wanted && !wanted.has(entry.id)) continue;
    if (!canSit(entry)) continue;
    const host = findHost(plan.items, entry);
    entry.hostId = host ? host.id : null;
    entry.z = host ? Number(host.h) || 0 : 0;
  }
}

export function clearMissingHosts(plan) {
  for (const entry of plan.items || []) {
    if (!entry.hostId) continue;
    const host = plan.items.find((row) => row.id === entry.hostId);
    if (!host || !isSurface(host)) {
      entry.hostId = null;
      if (entry.place !== "wall") entry.z = 0;
    } else {
      entry.z = Number(host.h) || 0;
    }
  }
}

export function shiftGuests(plan, movedIds, starts) {
  const moved = new Set(movedIds);
  for (const entry of plan.items || []) {
    if (!entry.hostId || moved.has(entry.id) || !moved.has(entry.hostId)) continue;
    if (entry.locked) {
      entry.hostId = null;
      entry.z = 0;
      continue;
    }
    const host = plan.items.find((row) => row.id === entry.hostId);
    const hostStart = starts[entry.hostId];
    const guestStart = starts[entry.id];
    if (!host || !hostStart || !guestStart) continue;
    entry.x = guestStart.x + (host.x - hostStart.x);
    entry.y = guestStart.y + (host.y - hostStart.y);
  }
}

function overlapRatio(guest, host) {
  const samples = 6;
  let inside = 0;
  for (let i = 0; i < samples; i += 1) {
    for (let j = 0; j < samples; j += 1) {
      const lx = -guest.w / 2 + ((i + 0.5) * guest.w) / samples;
      const ly = -guest.d / 2 + ((j + 0.5) * guest.d) / samples;
      const point = worldFromLocal(guest, lx, ly);
      if (pointInRotatedRect(point.x, point.y, host)) inside += 1;
    }
  }
  return inside / (samples * samples);
}

function worldFromLocal(entry, lx, ly) {
  const theta = ((Number(entry.rot) || 0) * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  return {
    x: entry.x + lx * cos - ly * sin,
    y: entry.y + lx * sin + ly * cos,
  };
}

function pointInRotatedRect(x, y, entry) {
  const rad = (-(Number(entry.rot) || 0) * Math.PI) / 180;
  const dx = x - entry.x;
  const dy = y - entry.y;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
  return Math.abs(lx) <= entry.w / 2 && Math.abs(ly) <= entry.d / 2;
}
