import { lookupItem } from "./catalog.js?v=20261028d";
import {
  centroid,
  edgeGeometry,
  nearestEdge,
  moveVertex,
  outlinePoints,
  pointInRoom,
  rectanglePoints,
  roomArea,
  syncBounds,
} from "./geometry.js?v=20261022d";
import {
  attachLeaf,
  clampOpenings,
  createOpening,
  cutsForWall,
  doorOpening,
  hingePoint,
  hitOpening,
  leafSwing,
  moveOpening,
  nearestOpeningOnWall,
  nearestWall,
  openingCenter,
  syncLeaves,
} from "./openings.js?v=20261022f";
import { addBreaker, addOutlet, addPanel, drawPower, hitPower, placeAnchor, symbolById } from "./power.js?v=20261028d";
import { snapValue, uid } from "./store.js?v=20261028d";
import { seatItems, shiftGuests } from "./surface.js?v=20261028d";

const images = new Map();
let notifyUnderlay = () => {};

export function createView2d(canvas, store, ui) {
  const ctx = canvas.getContext("2d");
  const cam = { x: 4000, y: 3000, scale: 0.08 };
  const pointer = { down: false, button: 0, sx: 0, sy: 0 };
  let drag = null;
  let measure = null;
  let placedRoomId = null;

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    draw();
  }

  function world(sx, sy) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (sx - rect.width / 2) / cam.scale + cam.x,
      y: (sy - rect.height / 2) / cam.scale + cam.y,
    };
  }

  function coords(point) {
    return [point.x, point.y];
  }

  function screen(x, y) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (x - cam.x) * cam.scale + rect.width / 2,
      y: (y - cam.y) * cam.scale + rect.height / 2,
    };
  }

  function step() {
    const settings = store.get().settings;
    return settings.module / settings.division;
  }

  function snapSteps() {
    const settings = store.get().settings;
    return [step(), (Number(settings.wall) || 150) / 2];
  }

  function draw() {
    const rect = canvas.getBoundingClientRect();
    ctx.clearRect(0, 0, rect.width, rect.height);
    ctx.fillStyle = "#e4eeea";
    ctx.fillRect(0, 0, rect.width, rect.height);
    drawGrid(rect);
    const plan = store.get();
    drawUnderlay(plan.underlay);
    for (const room of plan.rooms) drawRoom(room, plan);
    drawOpeningMarks(plan);
    const loose = [];
    const atop = [];
    for (const entry of plan.items) {
      if (entry.openingId) drawLeaf(entry, plan);
      else if (entry.hostId) atop.push(entry);
      else loose.push(entry);
    }
    for (const entry of loose) drawItem(entry, plan);
    for (const entry of atop) drawItem(entry, plan);
    drawPower(ctx, plan, ui, screen, cam.scale);
    if (measure?.a && measure?.b) drawMeasure(measure.a, measure.b);
    if (drag?.kind === "new-room") drawDraft(drag.start, drag.current);
    if (drag?.kind === "marquee") drawDraft(drag.start, drag.current);
    drawUnderlaySelection(plan.underlay);
  }

  function drawGrid(rect) {
    const gap = step();
    if (gap * cam.scale < 8) return;
    const topLeft = world(0, 0);
    const bottomRight = world(rect.width, rect.height);
    const x0 = Math.floor(topLeft.x / gap) * gap;
    const y0 = Math.floor(topLeft.y / gap) * gap;
    ctx.beginPath();
    ctx.strokeStyle = "rgba(255,255,255,0.55)";
    ctx.lineWidth = 1;
    for (let x = x0; x < bottomRight.x; x += gap) {
      const s = screen(x, 0);
      ctx.moveTo(s.x, 0);
      ctx.lineTo(s.x, rect.height);
    }
    for (let y = y0; y < bottomRight.y; y += gap) {
      const s = screen(0, y);
      ctx.moveTo(0, s.y);
      ctx.lineTo(rect.width, s.y);
    }
    ctx.stroke();
  }

  function drawUnderlay(underlay) {
    const image = underlayImage(underlay);
    if (!image) return;
    const a = screen(underlay.x, underlay.y);
    const b = screen(underlay.x + underlay.w, underlay.y + underlay.h);
    ctx.save();
    ctx.globalAlpha = 0.72;
    ctx.drawImage(image, a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.restore();
  }

  function drawUnderlaySelection(underlay) {
    if (ui.selection?.kind !== "underlay" || !underlay) return;
    const a = screen(underlay.x, underlay.y);
    const b = screen(underlay.x + underlay.w, underlay.y + underlay.h);
    ctx.save();
    ctx.strokeStyle = "#0060b0";
    ctx.lineWidth = 2;
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.fillStyle = "#ffffff";
    for (const corner of underlayCorners(underlay)) {
      const at = screen(corner.x, corner.y);
      ctx.beginPath();
      ctx.rect(at.x - 5, at.y - 5, 10, 10);
      ctx.fill();
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawRoom(room, plan) {
    const outline = outlinePoints(room, 36);
    if (!outline.length) return;
    ctx.fillStyle = room.floorColor || room.color;
    traceOutline(outline);
    ctx.fill();
    if (room.dropCeiling > 0) {
      const center = centroid(room);
      ctx.save();
      ctx.strokeStyle = "rgba(36,48,64,0.45)";
      ctx.setLineDash([5, 4]);
      traceOutline(outline.map((point) => {
        const vx = center.x - point.x;
        const vy = center.y - point.y;
        const len = Math.hypot(vx, vy) || 1;
        return { x: point.x + (vx / len) * plan.settings.wall, y: point.y + (vy / len) * plan.settings.wall };
      }));
      ctx.stroke();
      ctx.restore();
    }
    drawWalls(room, plan);
    const label = screen(centroid(room).x, centroid(room).y);
    ctx.fillStyle = "#243040";
    ctx.font = "13px sans-serif";
    ctx.textAlign = "center";
    ctx.fillText(room.name, label.x, label.y - 8);
    ctx.fillText(`${(roomArea(room) / 1e6).toFixed(2)} ㎡`, label.x, label.y + 10);
    if (room.floorFinish && room.floorFinish !== "床") ctx.fillText(room.floorFinish, label.x, label.y + 26);
    if (selected("room", room.id)) {
      ctx.save();
      ctx.strokeStyle = "#0060b0";
      ctx.lineWidth = 2;
      traceOutline(outline);
      ctx.stroke();
      ctx.restore();
      drawVertexHandles(room);
    }
  }

  function traceOutline(outline) {
    ctx.beginPath();
    outline.forEach((point, index) => {
      const at = screen(point.x, point.y);
      if (index === 0) ctx.moveTo(at.x, at.y);
      else ctx.lineTo(at.x, at.y);
    });
    ctx.closePath();
  }

  function drawWalls(room, plan) {
    const t = plan.settings.wall;
    ctx.fillStyle = room.wallColor || "#8e98a3";
    const joins = room.points.map((_, index) => cornerJoin(room, index, t));
    for (let index = 0; index < room.points.length; index += 1) {
      const edge = edgeGeometry(room, index);
      const gaps = cutsForWall(plan, room, index).filter((cut) => cut.walkable);
      const startJoin = joins[index];
      const endJoin = joins[(index + 1) % room.points.length];
      const ceiling = Math.max(400, Number(plan.settings?.ceiling) || 2700);
      const openEnds = {
        start: wallEndOpen(plan, room, index - 1, true, t, ceiling),
        end: wallEndOpen(plan, room, index + 1, false, t, ceiling),
      };
      for (const [from, to] of subtractSpans(0, edge.length, gaps)) fillWallPiece(edge, from, to, t, startJoin, endJoin, openEnds);
    }
    for (let index = 0; index < joins.length; index += 1) {
      const join = joins[index];
      if (join.miter || join.arc || cornerCutOpen(plan, room, index, t)) continue;
      if (!join.innerA || !join.innerB || polyArea([join.vertex, join.innerB, join.innerA]) < 8) continue;
      fillWorld([join.vertex, join.innerB, join.innerA]);
    }
    if (ui.wallPick?.roomId !== room.id || ui.wallPick.edgeIndex == null) return;
    const edge = edgeGeometry(room, ui.wallPick.edgeIndex);
    ctx.save();
    ctx.strokeStyle = "#0060b0";
    ctx.lineWidth = 3;
    const a = screen(edge.a.x, edge.a.y);
    const b = screen(edge.b.x, edge.b.y);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    const steps = edge.arc ? 16 : 1;
    for (let i = 1; i <= steps; i += 1) {
      const point = screen(...Object.values(edge.pointAt((edge.length * i) / steps)));
      ctx.lineTo(point.x, point.y);
    }
    ctx.stroke();
    ctx.restore();
  }

  function cornerJoin(room, vertexIndex, thickness) {
    const prev = edgeGeometry(room, vertexIndex - 1);
    const next = edgeGeometry(room, vertexIndex);
    const vertex = next.a;
    if (prev.arc || next.arc) return { vertex, miter: false, arc: true };
    const nA = prev.inwardAt(prev.length);
    const nB = next.inwardAt(0);
    const tA = angleVector(prev.tangentAt(prev.length));
    const tB = angleVector(next.tangentAt(0));
    const innerA = { x: vertex.x + nA.x * thickness, y: vertex.y + nA.y * thickness };
    const innerB = { x: vertex.x + nB.x * thickness, y: vertex.y + nB.y * thickness };
    const hit = lineIntersect(innerA, tA, innerB, tB);
    const offset = hit ? { x: hit.x - vertex.x, y: hit.y - vertex.y } : null;
    const inward = offset && dot(offset, nA) > thickness * 0.15 && dot(offset, nB) > thickness * 0.15;
    if (!hit || !inward) return { vertex, innerA, innerB, miter: false };
    const len = Math.hypot(offset.x, offset.y) || 1;
    const scale = Math.min(1, (thickness * 3) / len);
    return {
      vertex,
      inner: { x: vertex.x + offset.x * scale, y: vertex.y + offset.y * scale },
      innerA,
      innerB,
      miter: true,
      clamped: scale < 0.999,
    };
  }

  function wallEndOpen(plan, room, edgeIndex, atEnd, thickness, ceiling) {
    const count = room.points.length;
    const index = ((edgeIndex % count) + count) % count;
    const edge = edgeGeometry(room, index);
    return cutsForWall(plan, room, index).some((cut) => {
      const reaches = atEnd ? cut.b > edge.length - thickness - 20 : cut.a < thickness + 20;
      const sill = Number(cut.sill) || 0;
      return reaches && sill < 80 && sill + (Number(cut.h) || 0) >= ceiling - 80;
    });
  }

  function cornerCutOpen(plan, room, vertexIndex, thickness) {
    const count = room.points.length;
    const prevIndex = (vertexIndex - 1 + count) % count;
    const prev = edgeGeometry(room, prevIndex);
    const next = edgeGeometry(room, vertexIndex);
    const open = (cut, edge, atEnd) => (Number(cut.sill) || 0) < 80 && (atEnd ? cut.b > edge.length - thickness - 20 : cut.a < thickness + 20);
    return cutsForWall(plan, room, prevIndex).some((cut) => open(cut, prev, true))
      || cutsForWall(plan, room, vertexIndex).some((cut) => open(cut, next, false));
  }

  function drawVertexHandles(room) {
    for (let index = 0; index < room.points.length; index += 1) {
      const at = screen(room.points[index].x, room.points[index].y);
      const on = ui.wallPick?.roomId === room.id && ui.wallPick.vertexIndex === index;
      ctx.beginPath();
      ctx.fillStyle = on ? "#0060b0" : "#ffffff";
      ctx.strokeStyle = "#0060b0";
      ctx.lineWidth = 2;
      ctx.arc(at.x, at.y, on ? 7 : 5, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();
    }
  }

  function subtractSpans(start, end, cuts) {
    let cursor = start;
    const pieces = [];
    for (const cut of cuts) {
      if (cut.a > cursor + 1) pieces.push([cursor, cut.a]);
      cursor = Math.max(cursor, cut.b);
    }
    if (end > cursor + 1) pieces.push([cursor, end]);
    return pieces;
  }

  function fillWallPiece(edge, from, to, thickness, startJoin, endJoin, openEnds) {
    if (edge.arc) {
      const length = Math.max(1, to - from);
      const steps = Math.max(6, Math.ceil(length / 70));
      const outer = [];
      const inner = [];
      for (let i = 0; i <= steps; i += 1) {
        const along = from + (length * i) / steps;
        const point = edge.pointAt(along);
        const normal = edge.inwardAt(along);
        outer.push(point);
        inner.push({ x: point.x + normal.x * thickness, y: point.y + normal.y * thickness });
      }
      fillWorld([...outer, ...inner.reverse()]);
      return;
    }
    const normal = edge.inwardAt(0);
    const offsetAt = (along) => {
      const point = edge.pointAt(along);
      return { x: point.x + normal.x * thickness, y: point.y + normal.y * thickness };
    };
    const atStart = from <= 1 && startJoin?.miter && !openEnds?.start;
    const atEnd = to >= edge.length - 1 && endJoin?.miter && !openEnds?.end;
    const inner0 = atStart ? startJoin.inner : offsetAt(from);
    const inner1 = atEnd ? endJoin.inner : offsetAt(to);
    const poly = [edge.pointAt(from), edge.pointAt(to), inner1];
    const span = Math.max(1, to - from);
    if (atEnd && endJoin.clamped) {
      const knee = offsetAt(Math.max(from, to - Math.min(thickness * 2, span / 2)));
      if (Math.hypot(knee.x - inner1.x, knee.y - inner1.y) > 1) poly.push(knee);
    }
    if (atStart && startJoin.clamped) {
      const knee = offsetAt(Math.min(to, from + Math.min(thickness * 2, span / 2)));
      if (Math.hypot(knee.x - inner0.x, knee.y - inner0.y) > 1) poly.push(knee);
    }
    poly.push(inner0);
    fillWorld(poly);
  }

  function fillWorld(points) {
    if (points.length < 3) return;
    ctx.beginPath();
    points.forEach((point, index) => {
      const at = screen(point.x, point.y);
      if (index === 0) ctx.moveTo(at.x, at.y);
      else ctx.lineTo(at.x, at.y);
    });
    ctx.closePath();
    ctx.fill();
  }

  function angleVector(angle) {
    return { x: Math.cos(angle), y: Math.sin(angle) };
  }

  function dot(a, b) {
    return a.x * b.x + a.y * b.y;
  }

  function lineIntersect(point, dir, other, otherDir) {
    const det = dir.x * otherDir.y - dir.y * otherDir.x;
    if (Math.abs(det) < 1e-6) return null;
    const s = ((other.x - point.x) * otherDir.y - (other.y - point.y) * otherDir.x) / det;
    return { x: point.x + dir.x * s, y: point.y + dir.y * s };
  }

  function polyArea(points) {
    let sum = 0;
    for (let i = 0; i < points.length; i += 1) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      sum += a.x * b.y - b.x * a.y;
    }
    return Math.abs(sum) / 2;
  }

  function drawOpeningMarks(plan) {
    for (const opening of plan.openings || []) {
      const room = plan.rooms.find((entry) => entry.id === opening.roomId);
      if (!room) continue;
      const center = openingCenter(room, opening);
      const wall = center.wall;
      const half = opening.w / 2;
      const a = screen(...coords(wall.pointAt(center.along - half)));
      const b = screen(...coords(wall.pointAt(center.along + half)));
      const on = selected("opening", opening.id);
      ctx.save();
      ctx.strokeStyle = on ? "#0060b0" : "rgba(20,24,32,0.7)";
      ctx.lineWidth = on ? 3 : 2;
      const hasLeaf = (plan.items || []).some((entry) => entry.openingId === opening.id);
      if (opening.sill >= 80) {
        ctx.setLineDash([5, 4]);
        ctx.beginPath();
        ctx.moveTo(a.x, a.y);
        ctx.lineTo(b.x, b.y);
        ctx.stroke();
      } else if (on && !hasLeaf) {
        const n = screen(center.x + wall.nx * 180, center.y + wall.ny * 180);
        const c = screen(center.x, center.y);
        ctx.beginPath();
        ctx.moveTo(c.x, c.y);
        ctx.lineTo(n.x, n.y);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  function drawLeaf(entry, plan) {
    const opening = (plan.openings || []).find((row) => row.id === entry.openingId);
    const room = opening && plan.rooms.find((row) => row.id === opening.roomId);
    if (!opening || !room) return;
    const center = openingCenter(room, opening);
    const wall = center.wall;
    const cat = lookupItem(entry.catalogId, plan.customItems);
    const swing = cat?.swing || (entry.leaf === "window" ? "window" : "single");
    ctx.save();
    ctx.strokeStyle = selected("item", entry.id) || selected("opening", opening.id) ? "#0060b0" : (entry.color || "#8a5a32");
    ctx.lineWidth = 2;
    if (swing === "window") {
      strokeAlong(center, wall, opening.w, 0, 0);
      strokeAlong(center, wall, opening.w * 0.7, 0, 70);
    } else if (swing === "slide") {
      const sign = entry.hinge === "end" ? 1 : -1;
      strokeAlong(center, wall, opening.w * 0.92, sign * opening.w * 0.42, 80);
    } else {
      const hinges = swing === "double" ? ["start", "end"] : [entry.hinge === "end" ? "end" : "start"];
      const radius = swing === "double" ? opening.w / 2 : opening.w;
      for (const hinge of hinges) traceSwing(room, opening, hinge, radius, swing);
    }
    ctx.restore();
  }

  function strokeAlong(center, wall, length, alongShift, inwardShift) {
    const ang = wall.tangentAt(center.along);
    const mx = center.x + Math.cos(ang) * alongShift + wall.nx * inwardShift;
    const my = center.y + Math.sin(ang) * alongShift + wall.ny * inwardShift;
    const hx = Math.cos(ang) * length / 2;
    const hy = Math.sin(ang) * length / 2;
    const a = screen(mx - hx, my - hy);
    const b = screen(mx + hx, my + hy);
    ctx.beginPath();
    ctx.moveTo(a.x, a.y);
    ctx.lineTo(b.x, b.y);
    ctx.stroke();
  }

  function traceSwing(room, opening, hinge, radius, swing) {
    const pose = leafSwing(openingCenter(room, opening).wall, hinge, swing);
    const hp = hingePoint(room, opening, hinge);
    ctx.beginPath();
    for (let i = 0; i <= 12; i += 1) {
      const t = pose.closed + pose.delta * (i / 12);
      const p = screen(hp.x + Math.cos(t) * radius, hp.y + Math.sin(t) * radius);
      if (i === 0) ctx.moveTo(p.x, p.y);
      else ctx.lineTo(p.x, p.y);
    }
    ctx.stroke();
    const hingeScreen = screen(hp.x, hp.y);
    const tip = screen(hp.x + Math.cos(pose.open) * radius, hp.y + Math.sin(pose.open) * radius);
    ctx.beginPath();
    ctx.moveTo(hingeScreen.x, hingeScreen.y);
    ctx.lineTo(tip.x, tip.y);
    ctx.stroke();
  }

  function drawItem(entry, plan) {
    const cat = lookupItem(entry.catalogId, plan.customItems);
    const center = screen(entry.x, entry.y);
    ctx.save();
    ctx.translate(center.x, center.y);
    ctx.rotate((entry.rot * Math.PI) / 180);
    const w = entry.w * cam.scale;
    const d = entry.d * cam.scale;
    const pad = entry.hostId ? Math.min(70, Math.max(30, Math.min(entry.w, entry.d) * 0.06)) * cam.scale : 0;
    ctx.fillStyle = entry.color || cat?.color || "#888";
    ctx.strokeStyle = selected("item", entry.id) ? "#0060b0" : "rgba(0,0,0,0.45)";
    ctx.lineWidth = selected("item", entry.id) ? 2 : 1;
    ctx.fillRect(-w / 2 + pad, -d / 2 + pad, Math.max(1, w - pad * 2), Math.max(1, d - pad * 2));
    ctx.strokeRect(-w / 2 + pad, -d / 2 + pad, Math.max(1, w - pad * 2), Math.max(1, d - pad * 2));
    if (entry.groupId) {
      ctx.strokeStyle = "#7a4e12";
      ctx.setLineDash([3, 2]);
      ctx.strokeRect(-w / 2 - 3, -d / 2 - 3, w + 6, d + 6);
      ctx.setLineDash([]);
    }
    if (entry.locked) {
      ctx.fillStyle = "#1d4e89";
      ctx.fillRect(w / 2 - 14, -d / 2, 14, 14);
      ctx.fillStyle = "#fff";
      ctx.font = "10px sans-serif";
      ctx.textAlign = "center";
      ctx.fillText("鍵", w / 2 - 7, -d / 2 + 11);
    }
    ctx.fillStyle = "#1c2430";
    ctx.font = "11px sans-serif";
    ctx.textAlign = "center";
    if (w > 28) ctx.fillText(entry.name, 0, 4);
    ctx.restore();
  }

  function strokeRect(x, y, w, h) {
    ctx.strokeStyle = "#0060b0";
    ctx.lineWidth = 2;
    ctx.strokeRect(x, y, w, h);
  }

  function drawDraft(start, current) {
    const x = Math.min(start.x, current.x);
    const y = Math.min(start.y, current.y);
    const w = Math.abs(current.x - start.x);
    const h = Math.abs(current.y - start.y);
    const a = screen(x, y);
    const b = screen(x + w, y + h);
    ctx.strokeStyle = "#0060b0";
    ctx.setLineDash([6, 4]);
    ctx.strokeRect(a.x, a.y, b.x - a.x, b.y - a.y);
    ctx.setLineDash([]);
  }

  function drawMeasure(a, b) {
    const sa = screen(a.x, a.y);
    const sb = screen(b.x, b.y);
    ctx.strokeStyle = "#c2410c";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.moveTo(sa.x, sa.y);
    ctx.lineTo(sb.x, sb.y);
    ctx.stroke();
    const dist = Math.hypot(b.x - a.x, b.y - a.y);
    ctx.fillStyle = "#c2410c";
    ctx.font = "12px sans-serif";
    ctx.textAlign = "left";
    ctx.fillText(`${Math.round(dist)} mm`, (sa.x + sb.x) / 2 + 6, (sa.y + sb.y) / 2);
  }

  function selected(kind, id) {
    return ui.selection?.kind === kind && ui.selection.ids.includes(id);
  }

  function hitDoorLeaf(wx, wy) {
    const plan = store.get();
    let best = null;
    for (const entry of plan.items || []) {
      if (!entry.openingId) continue;
      const opening = (plan.openings || []).find((row) => row.id === entry.openingId);
      const room = opening && plan.rooms.find((row) => row.id === opening.roomId);
      if (!opening || !room) continue;
      const center = openingCenter(room, opening);
      const wall = center.wall;
      const cat = lookupItem(entry.catalogId, plan.customItems);
      const swing = cat?.swing || (entry.leaf === "window" ? "window" : "single");
      const lines = [];
      if (swing === "window" || swing === "slide") {
        const sign = swing === "slide" && entry.hinge === "end" ? 1 : swing === "slide" ? -1 : 0;
        const shift = sign * opening.w * 0.42;
        const ang = wall.tangentAt(center.along);
        const ox = Math.cos(ang) * shift + (swing === "slide" ? wall.nx * 80 : 0);
        const oy = Math.sin(ang) * shift + (swing === "slide" ? wall.ny * 80 : 0);
        const half = opening.w * (swing === "slide" ? 0.46 : 0.5);
        const hx = Math.cos(ang) * half;
        const hy = Math.sin(ang) * half;
        lines.push([center.x + ox - hx, center.y + oy - hy, center.x + ox + hx, center.y + oy + hy]);
      } else {
        const hinges = swing === "double" ? ["start", "end"] : [entry.hinge === "end" ? "end" : "start"];
        const radius = swing === "double" ? opening.w / 2 : opening.w;
        for (const hinge of hinges) {
          const pose = leafSwing(wall, hinge, swing);
          const hp = hingePoint(room, opening, hinge);
          lines.push([hp.x, hp.y, hp.x + Math.cos(pose.open) * radius, hp.y + Math.sin(pose.open) * radius]);
        }
      }
      for (const [ax, ay, bx, by] of lines) {
        const dist = pointSegmentDist(wx, wy, ax, ay, bx, by);
        if (dist <= 220 && (!best || dist < best.dist)) best = { opening, dist };
      }
    }
    return best?.opening || null;
  }

  function hitItem(wx, wy) {
    const plan = store.get();
    const items = [...plan.items].sort((a, b) => Number(!!a.hostId) - Number(!!b.hostId));
    for (let i = items.length - 1; i >= 0; i -= 1) {
      const entry = items[i];
      if (entry.openingId) continue;
      if (pointInRotatedRect(wx, wy, entry)) return entry;
    }
    return null;
  }

  function hitRoom(wx, wy) {
    const rooms = store.get().rooms;
    for (let i = rooms.length - 1; i >= 0; i -= 1) {
      const room = rooms[i];
      if (pointInRoom(room, wx, wy)) return room;
    }
    return null;
  }

  function handlePowerPointer(wpt) {
    if (ui.tool === "power") {
      const anchor = placeAnchor(store.get(), wpt.x, wpt.y);
      let selected = null;
      store.update((plan) => {
        if (ui.powerSymbol === "panel") {
          const panel = addPanel(plan, anchor);
          selected = { kind: "panel", ids: [panel.id] };
          return;
        }
        const symbol = symbolById(ui.powerSymbol);
        const outlet = addOutlet(plan, symbol, anchor);
        selected = { kind: "outlet", ids: [outlet.id] };
      });
      if (selected) ui.select(selected);
      if (ui.powerSymbol === "panel") ui.setTool("select");
      draw();
      return true;
    }
    const hit = hitPower(store.get(), wpt.x, wpt.y, screen, cam.scale, ctx);
    if (hit?.kind === "slot") {
      let breaker = null;
      store.update((plan) => {
        const panel = plan.panels.find((entry) => entry.id === hit.id);
        if (panel) breaker = addBreaker(plan, panel, { role: "spare" });
      });
      if (breaker) ui.select({ kind: "breaker", ids: [breaker.id] });
      pointer.down = false;
      draw();
      return true;
    }
    if (hit?.kind === "breaker") {
      ui.select({ kind: "breaker", ids: [hit.id] });
      pointer.down = false;
      draw();
      return true;
    }
    if (hit?.kind === "outlet" || hit?.kind === "panel") {
      ui.select({ kind: hit.kind, ids: [hit.id] });
      drag = { kind: "move-power", id: hit.id, powerKind: hit.kind, origin: wpt, start: { x: hit.x, y: hit.y }, pending: true };
      draw();
      return true;
    }
    const item = hitItem(wpt.x, wpt.y);
    if (item && !item.openingId) {
      ui.select({ kind: "item", ids: [item.id] });
      pointer.down = false;
      draw();
      return true;
    }
    drag = { kind: "pan", cx: cam.x, cy: cam.y, sx: pointer.sx, sy: pointer.sy, clearOnClick: true };
    return true;
  }

  canvas.addEventListener("contextmenu", (event) => event.preventDefault());
  canvas.addEventListener("pointerdown", (event) => {
    try {
      canvas.setPointerCapture(event.pointerId);
    } catch {
      /* Synthetic tests and some browsers reject capture before the pointer is active. */
    }
    const rect = canvas.getBoundingClientRect();
    pointer.down = true;
    pointer.button = event.button;
    pointer.sx = event.clientX - rect.left;
    pointer.sy = event.clientY - rect.top;
    const wpt = world(pointer.sx, pointer.sy);
    if (event.button === 1 || event.button === 2) {
      drag = { kind: "pan", cx: cam.x, cy: cam.y, sx: pointer.sx, sy: pointer.sy };
      return;
    }
    if (ui.tab === "power") {
      if (handlePowerPointer(wpt)) return;
    }
    if (ui.tool === "room") {
      const placed = placedRoomId && hitRoom(wpt.x, wpt.y);
      if (placed && placed.id === placedRoomId) {
        ui.setTool("select");
        ui.select({ kind: "room", ids: [placed.id] });
        drag = { kind: "move-rooms", ids: [placed.id], origin: wpt, starts: snapshotRooms([placed.id]), pending: true };
        draw();
        return;
      }
      drag = { kind: "new-room", start: snapPoint(wpt), current: snapPoint(wpt) };
      return;
    }
    if (ui.tool === "measure") {
      const point = { x: wpt.x, y: wpt.y };
      if (!measure?.a || measure.b) measure = { a: point };
      else measure = { a: measure.a, b: point };
      draw();
      return;
    }
    if (ui.tool === "opening") {
      placeOpening(wpt);
      return;
    }
    if (ui.tool === "select" && ui.selection?.kind === "underlay") {
      const underlay = store.get().underlay;
      const handle = underlay && hitUnderlayHandle(underlay, wpt.x, wpt.y);
      if (handle) {
        drag = {
          kind: "resize-underlay",
          handle,
          pending: true,
          start: { x: underlay.x, y: underlay.y, w: underlay.w, h: underlay.h },
        };
        draw();
        return;
      }
    }
    if (ui.tool === "select" && ui.selection?.kind === "room" && ui.selection.ids.length === 1) {
      const room = store.get().rooms.find((entry) => entry.id === ui.selection.ids[0]);
      const vertex = room && hitVertex(room, wpt.x, wpt.y);
      if (vertex != null) {
        ui.pickWall?.({ roomId: room.id, vertexIndex: vertex, edgeIndex: null });
        drag = { kind: "move-vertex", roomId: room.id, index: vertex, pending: true };
        draw();
        return;
      }
      const edge = room && hitEdge(room, wpt.x, wpt.y);
      if (edge != null) {
        ui.pickWall?.({ roomId: room.id, vertexIndex: null, edgeIndex: edge });
        drag = null;
        pointer.down = false;
        draw();
        return;
      }
    }
    if (ui.tool === "item" && ui.catalogId) {
      placeItem(wpt);
      return;
    }
    const opening = hitDoorLeaf(wpt.x, wpt.y) || hitOpening(store.get(), wpt.x, wpt.y);
    if (opening) {
      ui.select({ kind: "opening", ids: [opening.id] });
      drag = { kind: "move-opening", id: opening.id, pending: true };
      draw();
      return;
    }
    const item = hitItem(wpt.x, wpt.y);
    if (item) {
      const ids = event.shiftKey ? toggleIds("item", item.id, false) : memberIds(item);
      ui.select({ kind: "item", ids });
      const movable = item.locked ? [] : ids.filter((id) => !store.get().items.find((row) => row.id === id)?.locked);
      if (movable.length) drag = { kind: "move-items", ids: movable, origin: wpt, starts: snapshot(movable), pending: true };
      else pointer.down = false;
      draw();
      return;
    }
    const room = hitRoom(wpt.x, wpt.y);
    if (room) {
      const ids = event.shiftKey ? toggleIds("room", room.id, false) : [room.id];
      ui.select(ids.length ? { kind: "room", ids } : null);
      drag = { kind: "move-rooms", ids, origin: wpt, starts: snapshotRooms(ids), pending: true };
      draw();
      return;
    }
    const underlay = store.get().underlay;
    if (ui.tool === "select" && underlay && hitUnderlay(underlay, wpt.x, wpt.y)) {
      ui.select({ kind: "underlay", ids: ["underlay"] });
      drag = {
        kind: "move-underlay",
        origin: wpt,
        pending: true,
        start: { x: underlay.x, y: underlay.y, w: underlay.w, h: underlay.h },
      };
      draw();
      return;
    }
    if (event.shiftKey) {
      drag = {
        kind: "marquee",
        start: wpt,
        current: wpt,
        ssx: pointer.sx,
        ssy: pointer.sy,
        additive: true,
        base: ui.selection?.kind === "item" ? [...ui.selection.ids] : [],
      };
      return;
    }
    drag = { kind: "pan", cx: cam.x, cy: cam.y, sx: pointer.sx, sy: pointer.sy, clearOnClick: true };
  });

  canvas.addEventListener("pointermove", (event) => {
    const rect = canvas.getBoundingClientRect();
    pointer.sx = event.clientX - rect.left;
    pointer.sy = event.clientY - rect.top;
    const wpt = world(pointer.sx, pointer.sy);
    if (!pointer.down || !drag) return;
    if (drag.kind === "pan") {
      const moved = Math.hypot(pointer.sx - drag.sx, pointer.sy - drag.sy);
      if (drag.clearOnClick && moved < 4) return;
      cam.x = drag.cx - (pointer.sx - drag.sx) / cam.scale;
      cam.y = drag.cy - (pointer.sy - drag.sy) / cam.scale;
      draw();
      return;
    }
    if (drag.kind === "new-room" || drag.kind === "marquee") {
      drag.current = drag.kind === "new-room" ? snapPoint(wpt) : wpt;
      draw();
      return;
    }
    if (drag.kind === "move-items" || drag.kind === "move-rooms" || drag.kind === "move-opening" || drag.kind === "move-vertex" || drag.kind === "move-underlay" || drag.kind === "resize-underlay" || drag.kind === "move-power") {
      if (drag.pending) {
        store.checkpoint();
        drag.pending = false;
      }
      const enabled = store.get().settings.snap;
      moveSelection(drag, wpt, enabled);
    }
  });

  canvas.addEventListener("pointerup", (event) => {
    const rect = canvas.getBoundingClientRect();
    pointer.sx = event.clientX - rect.left;
    pointer.sy = event.clientY - rect.top;
    if (drag?.kind === "pan" && drag.clearOnClick) {
      const moved = Math.hypot(pointer.sx - drag.sx, pointer.sy - drag.sy);
      if (moved < 4) ui.select(null);
    }
    if (drag?.kind === "move-underlay" || drag?.kind === "resize-underlay") ui.select({ kind: "underlay", ids: ["underlay"] });
    if (drag?.kind === "new-room") finishRoom(drag.start, drag.current);
    if (drag?.kind === "marquee") finishMarquee(drag);
    if (drag?.kind === "move-items" && !drag.pending) {
      const ids = drag.ids;
      store.mutate((plan) => {
        const guests = plan.items.filter((entry) => entry.hostId && ids.includes(entry.hostId)).map((entry) => entry.id);
        seatItems(plan, [...ids, ...guests]);
      });
    }
    pointer.down = false;
    drag = null;
  });

  canvas.addEventListener("wheel", (event) => {
    event.preventDefault();
    const factor = event.deltaY < 0 ? 1.1 : 0.9;
    cam.scale = Math.min(0.4, Math.max(0.01, cam.scale * factor));
    draw();
  }, { passive: false });

  function moveSelection(state, wpt, enabled) {
    store.mutate((plan) => {
      if (state.kind === "move-items") {
        for (const id of state.ids) {
          const entry = plan.items.find((row) => row.id === id);
          const start = state.starts[id];
          if (!entry || !start) continue;
          const x = snapValue(start.x + (wpt.x - state.origin.x), snapSteps(), enabled);
          const y = snapValue(start.y + (wpt.y - state.origin.y), snapSteps(), enabled);
          if (entry.place === "wall") Object.assign(entry, placeOnWall(x, y, entry.w, entry.d));
          else {
            entry.x = x;
            entry.y = y;
          }
        }
        shiftGuests(plan, state.ids, state.starts);
      }
      if (state.kind === "move-rooms") {
        for (const id of state.ids) {
          const room = plan.rooms.find((row) => row.id === id);
          const start = state.starts[id];
          if (!room || !start?.points) continue;
          const dx = snapValue(start.x + (wpt.x - state.origin.x), snapSteps(), enabled) - start.x;
          const dy = snapValue(start.y + (wpt.y - state.origin.y), snapSteps(), enabled) - start.y;
          room.points.forEach((point, index) => {
            point.x = start.points[index].x + dx;
            point.y = start.points[index].y + dy;
          });
          syncBounds(room);
        }
        syncLeaves(plan);
      }
      if (state.kind === "move-vertex") {
        const room = plan.rooms.find((row) => row.id === state.roomId);
        if (room) {
          moveVertex(room, state.index, snapValue(wpt.x, snapSteps(), enabled), snapValue(wpt.y, snapSteps(), enabled));
          clampOpenings(plan, room);
        }
      }
      if (state.kind === "move-opening") {
        const opening = plan.openings.find((row) => row.id === state.id);
        if (!opening) return;
        moveOpening(plan, opening, snapValue(wpt.x, snapSteps(), enabled), snapValue(wpt.y, snapSteps(), enabled));
        syncLeaves(plan);
      }
      if (state.kind === "move-underlay" && plan.underlay) {
        const dx = snapValue(state.start.x + (wpt.x - state.origin.x), snapSteps(), enabled) - state.start.x;
        const dy = snapValue(state.start.y + (wpt.y - state.origin.y), snapSteps(), enabled) - state.start.y;
        plan.underlay.x = state.start.x + dx;
        plan.underlay.y = state.start.y + dy;
      }
      if (state.kind === "resize-underlay") resizeUnderlay(plan.underlay, state, wpt, enabled);
      if (state.kind === "move-power") {
        const x = snapValue(state.start.x + (wpt.x - state.origin.x), snapSteps(), enabled);
        const y = snapValue(state.start.y + (wpt.y - state.origin.y), snapSteps(), enabled);
        const anchor = placeAnchor(plan, x, y);
        const row = state.powerKind === "panel"
          ? plan.panels.find((entry) => entry.id === state.id)
          : plan.outlets.find((entry) => entry.id === state.id);
        if (row) {
          row.x = anchor.x;
          row.y = anchor.y;
          row.rotation = anchor.rotation;
          row.roomId = anchor.roomId;
        }
      }
    });
  }

  function snapshot(ids) {
    const plan = store.get();
    const starts = {};
    const chosen = new Set(ids);
    for (const id of ids) {
      const entry = plan.items.find((row) => row.id === id);
      if (entry) starts[id] = { x: entry.x, y: entry.y };
    }
    for (const entry of plan.items) {
      if (entry.hostId && chosen.has(entry.hostId) && !starts[entry.id]) starts[entry.id] = { x: entry.x, y: entry.y };
    }
    return starts;
  }

  function snapshotRooms(ids) {
    const plan = store.get();
    const starts = {};
    for (const id of ids) {
      const room = plan.rooms.find((row) => row.id === id);
      if (room) starts[id] = { x: room.x, y: room.y, points: room.points.map((point) => ({ x: point.x, y: point.y })) };
    }
    return starts;
  }

  function memberIds(item) {
    if (!item.groupId) return [item.id];
    return store.get().items.filter((entry) => entry.groupId === item.groupId).map((entry) => entry.id);
  }

  function toggleIds(kind, id, expandGroup) {
    const current = ui.selection?.kind === kind ? ui.selection.ids : [];
    const next = new Set(current);
    const extra = expandGroup ? memberIds({ id, groupId: null }) : [id];
    if (next.has(id)) extra.forEach((value) => next.delete(value));
    else extra.forEach((value) => next.add(value));
    return [...next];
  }

  function finishMarquee(state) {
    const moved = Math.hypot(pointer.sx - state.ssx, pointer.sy - state.ssy);
    if (moved < 4) {
      ui.select(state.additive && state.base.length ? { kind: "item", ids: state.base } : null);
      draw();
      return;
    }
    const x0 = Math.min(state.start.x, state.current.x);
    const y0 = Math.min(state.start.y, state.current.y);
    const x1 = Math.max(state.start.x, state.current.x);
    const y1 = Math.max(state.start.y, state.current.y);
    const hits = store.get().items.filter((entry) => entry.x >= x0 && entry.x <= x1 && entry.y >= y0 && entry.y <= y1);
    const ids = [...new Set([...state.base, ...hits.flatMap((entry) => memberIds(entry))])];
    ui.select(ids.length ? { kind: "item", ids } : null);
    draw();
  }

  function snapPoint(point) {
    const enabled = store.get().settings.snap;
    return { x: snapValue(point.x, snapSteps(), enabled), y: snapValue(point.y, snapSteps(), enabled) };
  }

  function finishRoom(start, current) {
    let w = Math.abs(current.x - start.x);
    let h = Math.abs(current.y - start.y);
    if (w < 800 || h < 800) {
      w = 6000;
      h = 4000;
    }
    const x = w === 6000 && Math.abs(current.x - start.x) < 800 ? start.x : Math.min(start.x, current.x);
    const y = h === 4000 && Math.abs(current.y - start.y) < 800 ? start.y : Math.min(start.y, current.y);
    const type = ui.roomType || "実験室";
    const color = ui.roomColor || "#d5e4f2";
    const id = uid();
    store.update((plan) => {
      plan.rooms.push({
        id,
        name: type,
        color,
        x,
        y,
        w,
        h,
        floorFinish: "床",
        floorColor: color,
        wallFinish: "壁",
        wallColor: "#8e98a3",
        dropCeiling: 0,
        raisedFloor: 0,
        points: rectanglePoints(x, y, w, h),
        edges: [null, null, null, null],
      });
    });
    placedRoomId = id;
    ui.select({ kind: "room", ids: [id] });
  }

  function placeOpening(point) {
    const plan = store.get();
    const wall = nearestWall(plan.rooms, point.x, point.y);
    const reach = Math.max(Number(plan.settings.wall) || 150, 200) * 4;
    if (!wall || wall.dist > reach) return;
    const opening = createOpening(wall.room, wall.edgeIndex, point, ui.openingPreset || "hole", plan.settings.ceiling);
    opening.id = uid();
    store.update((draft) => {
      draft.openings.push(opening);
    });
    ui.select({ kind: "opening", ids: [opening.id] });
  }

  function placeItem(point) {
    const plan = store.get();
    const cat = lookupItem(ui.catalogId, plan.customItems);
    if (!cat) return;
    if (cat.leaf) {
      placeLeaf(point, cat);
      return;
    }
    const enabled = plan.settings.snap;
    const id = uid();
    let placed = {
      x: snapValue(point.x, snapSteps(), enabled),
      y: snapValue(point.y, snapSteps(), enabled),
      rot: 0,
      roomId: null,
      wallSide: null,
    };
    if (cat.place === "wall") placed = placeOnWall(point.x, point.y, cat.w, cat.d);
    const ceiling = plan.settings.ceiling;
    store.update((draft) => {
      draft.items.push({
        id,
        catalogId: cat.id,
        name: cat.name,
        color: cat.color,
        place: cat.place,
        x: placed.x,
        y: placed.y,
        rot: placed.rot || 0,
        w: cat.w,
        d: cat.d,
        h: cat.place === "ceiling" ? Math.min(cat.h, ceiling) : cat.h,
        z: cat.place === "wall" ? cat.mountHeight || cat.h / 2 : 0,
        price: cat.price == null || cat.price === "" ? null : Number(cat.price),
        groupId: null,
        roomId: placed.roomId || null,
        wallSide: placed.wallSide || null,
        edgeIndex: placed.edgeIndex ?? null,
        opening: !!cat.opening,
        light: !!cat.light,
        lightOn: !!cat.light,
        lightLevel: 10,
        lightColor: "#fff4d6",
        residential: !!cat.residential,
        design: "",
        hostId: null,
      });
      seatItems(draft, [id]);
    });
    ui.select({ kind: "item", ids: [id] });
    ui.setTool("select");
  }

  function placeLeaf(point, cat) {
    const plan = store.get();
    const wall = nearestWall(plan.rooms, point.x, point.y);
    const reach = Math.max(Number(plan.settings.wall) || 150, 200) * 4;
    if (!wall || wall.dist > reach) return;
    let opening = nearestOpeningOnWall(plan, wall, point.x, point.y);
    let created = null;
    if (!opening) {
      created = doorOpening(wall.room, wall.edgeIndex, point, cat, plan.settings.ceiling);
      created.id = uid();
      opening = created;
    }
    const openingId = opening.id;
    store.update((draft) => {
      if (created) draft.openings.push(created);
      const target = draft.openings.find((row) => row.id === openingId);
      attachLeaf(draft, target, cat, uid());
    });
    ui.select({ kind: "opening", ids: [openingId] });
    ui.setTool("select");
  }

  function placeOnWall(x, y, _itemW, itemD) {
    const wall = nearestWall(store.get().rooms, x, y);
    if (!wall) return { x, y, rot: 0, roomId: null, edgeIndex: null, wallSide: null };
    const edge = edgeGeometry(wall.room, wall.edgeIndex);
    const inset = store.get().settings.wall + itemD / 2;
    const normal = edge.inwardAt(wall.along);
    return {
      roomId: wall.room.id,
      edgeIndex: wall.edgeIndex,
      wallSide: null,
      x: wall.px + normal.x * inset,
      y: wall.py + normal.y * inset,
      rot: Math.round((edge.tangentAt(wall.along) * 180) / Math.PI),
    };
  }

  function underlayCorners(underlay) {
    return [
      { id: "nw", x: underlay.x, y: underlay.y },
      { id: "ne", x: underlay.x + underlay.w, y: underlay.y },
      { id: "se", x: underlay.x + underlay.w, y: underlay.y + underlay.h },
      { id: "sw", x: underlay.x, y: underlay.y + underlay.h },
    ];
  }

  function hitUnderlay(underlay, x, y) {
    return x >= underlay.x && x <= underlay.x + underlay.w && y >= underlay.y && y <= underlay.y + underlay.h;
  }

  function hitUnderlayHandle(underlay, x, y) {
    const reach = Math.max(140, 10 / cam.scale);
    let best = null;
    for (const corner of underlayCorners(underlay)) {
      const dist = Math.hypot(corner.x - x, corner.y - y);
      if (dist <= reach && (!best || dist < best.dist)) best = { id: corner.id, dist };
    }
    return best?.id || null;
  }

  function resizeUnderlay(underlay, state, wpt, enabled) {
    if (!underlay) return;
    const start = state.start;
    const aspect = start.w / Math.max(1, start.h);
    const anchor = {
      nw: { x: start.x + start.w, y: start.y + start.h },
      ne: { x: start.x, y: start.y + start.h },
      se: { x: start.x, y: start.y },
      sw: { x: start.x + start.w, y: start.y },
    }[state.handle];
    const signX = state.handle === "nw" || state.handle === "sw" ? -1 : 1;
    const signY = state.handle === "nw" || state.handle === "ne" ? -1 : 1;
    const dx = wpt.x - anchor.x;
    const dy = wpt.y - anchor.y;
    if (dx * signX <= 0 || dy * signY <= 0) return;
    let width = Math.abs(dx);
    let height = Math.abs(dy);
    if (width / height > aspect) height = width / aspect;
    else width = height * aspect;
    width = Math.max(100, snapValue(width, snapSteps(), enabled));
    height = width / aspect;
    if (height < 100) {
      height = 100;
      width = height * aspect;
    }
    underlay.x = signX < 0 ? anchor.x - width : anchor.x;
    underlay.y = signY < 0 ? anchor.y - height : anchor.y;
    underlay.w = width;
    underlay.h = height;
  }

  function hitVertex(room, x, y) {
    const reach = Math.max(140, 10 / cam.scale);
    let best = null;
    room.points.forEach((point, index) => {
      const dist = Math.hypot(point.x - x, point.y - y);
      if (dist <= reach && (!best || dist < best.dist)) best = { index, dist };
    });
    return best ? best.index : null;
  }

  function hitEdge(room, x, y) {
    const hit = nearestEdge(room, x, y);
    const reach = Math.max(Number(store.get().settings.wall) || 150, 180);
    return hit && hit.dist <= reach ? hit.edgeIndex : null;
  }

  function zoomBy(factor) {
    cam.scale = Math.min(0.4, Math.max(0.01, cam.scale * factor));
    draw();
  }

  function fit() {
    const plan = store.get();
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 40 || rect.height < 40) return;
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    const include = (x, y) => {
      if (!Number.isFinite(x) || !Number.isFinite(y)) return;
      minX = Math.min(minX, x);
      minY = Math.min(minY, y);
      maxX = Math.max(maxX, x);
      maxY = Math.max(maxY, y);
    };
    const wall = Number(plan.settings.wall) || 150;
    for (const room of plan.rooms) {
      include(room.x - wall, room.y - wall);
      include(room.x + room.w + wall, room.y + room.h + wall);
    }
    if (plan.underlay) {
      include(plan.underlay.x, plan.underlay.y);
      include(plan.underlay.x + plan.underlay.w, plan.underlay.y + plan.underlay.h);
    }
    for (const item of plan.items) {
      if (item.openingId) continue;
      const reach = Math.hypot(item.w || 0, item.d || 0) / 2;
      include(item.x - reach, item.y - reach);
      include(item.x + reach, item.y + reach);
    }
    for (const point of swingPoints(plan)) include(point.x, point.y);
    if (ui.tab === "power") {
      for (const panel of plan.panels || []) {
        include(panel.x, panel.y);
        include(panel.x + 4300, panel.y + 340 * Math.max(1, panel.slots || 1));
      }
      for (const outlet of plan.outlets || []) include(outlet.x, outlet.y);
    }
    if (!Number.isFinite(minX)) {
      cam.x = 4000;
      cam.y = 3000;
      cam.scale = 0.08;
      draw();
      return;
    }
    const padX = 1400;
    const padTop = 1200;
    const padBottom = 2400;
    const spanX = Math.max(1000, maxX - minX + padX * 2);
    const spanY = Math.max(1000, maxY - minY + padTop + padBottom);
    cam.x = (minX + maxX) / 2;
    cam.y = ((minY - padTop) + (maxY + padBottom)) / 2;
    cam.scale = Math.min(0.3, Math.max(0.02, Math.min(rect.width / spanX, rect.height / spanY)));
    draw();
  }

  function swingPoints(plan) {
    const points = [];
    for (const opening of plan.openings || []) {
      const room = plan.rooms.find((entry) => entry.id === opening.roomId);
      const leaf = plan.items.find((entry) => entry.openingId === opening.id);
      if (!room || !leaf) continue;
      const cat = lookupItem(leaf.catalogId, plan.customItems);
      const swing = cat?.swing || (leaf.leaf === "window" ? "window" : "single");
      const center = openingCenter(room, opening);
      if (swing === "window") continue;
      if (swing === "slide") {
        const sign = leaf.hinge === "end" ? 1 : -1;
        const ang = center.wall.tangentAt(center.along);
        const shift = sign * opening.w * 0.42;
        const mx = center.x + Math.cos(ang) * shift + center.wall.nx * 80;
        const my = center.y + Math.sin(ang) * shift + center.wall.ny * 80;
        const hx = Math.cos(ang) * opening.w * 0.46;
        const hy = Math.sin(ang) * opening.w * 0.46;
        points.push({ x: mx - hx, y: my - hy }, { x: mx + hx, y: my + hy });
        continue;
      }
      const hinges = swing === "double" ? ["start", "end"] : [leaf.hinge === "end" ? "end" : "start"];
      const radius = swing === "double" ? opening.w / 2 : opening.w;
      for (const hinge of hinges) {
        const hp = hingePoint(room, opening, hinge);
        const pose = leafSwing(center.wall, hinge, swing);
        for (let i = 0; i <= 4; i += 1) {
          const t = pose.closed + pose.delta * (i / 4);
          points.push({ x: hp.x + Math.cos(t) * radius, y: hp.y + Math.sin(t) * radius });
        }
      }
    }
    return points;
  }

  window.addEventListener("resize", () => resize());
  notifyUnderlay = () => draw();
  resize();
  store.subscribe(() => draw());
  ui.subscribe(() => draw());

  return { draw, resize, zoomBy, fit, camera: () => ({ ...cam }) };
}

function pointSegmentDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1) return Math.hypot(px - ax, py - ay);
  const t = Math.max(0, Math.min(1, ((px - ax) * dx + (py - ay) * dy) / len2));
  return Math.hypot(px - (ax + dx * t), py - (ay + dy * t));
}

function underlayImage(underlay) {
  if (!underlay?.href) return null;
  let record = images.get(underlay.href);
  if (!record) {
    const img = new Image();
    record = { img, ready: false };
    img.onload = () => {
      record.ready = true;
      notifyUnderlay();
    };
    img.src = underlay.href;
    images.set(underlay.href, record);
  }
  return record.ready ? record.img : null;
}

function pointInRotatedRect(x, y, entry) {
  const rad = (-entry.rot * Math.PI) / 180;
  const dx = x - entry.x;
  const dy = y - entry.y;
  const lx = dx * Math.cos(rad) - dy * Math.sin(rad);
  const ly = dx * Math.sin(rad) + dy * Math.cos(rad);
  return Math.abs(lx) <= entry.w / 2 && Math.abs(ly) <= entry.d / 2;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
