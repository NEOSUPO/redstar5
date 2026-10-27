import * as THREE from "three";
import { OrbitControls } from "three/addons/controls/OrbitControls.js";
import { lookupItem } from "./catalog.js";
import { centroid, edgeGeometry, outlinePoints, pointInRoom } from "./geometry.js?v=20261022d";
import { cutsForWall, hingePoint, leafSwing, openingCenter } from "./openings.js?v=20261022f";
import { snapValue } from "./store.js?v=20261022l";
import { counterTop, seatItems, shiftGuests } from "./surface.js?v=20261022l";

const BRIGHTNESS = [0.45, 0.85, 1.25];

export function createView3d(canvas, store, ui) {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: true });
  const map = document.querySelector("#walk-map");
  const mapCtx = map?.getContext("2d");
  renderer.setClearColor(0xe4eeea);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(50, 1, 10, 200000);
  camera.position.set(8000, 6000, 8000);
  const controls = new OrbitControls(camera, canvas);
  controls.target.set(4000, 0, 3000);
  controls.maxPolarAngle = Math.PI * 0.49;
  const sun = new THREE.DirectionalLight(0xffffff, 1.1);
  sun.position.set(4000, 8000, 2000);
  scene.add(sun);
  const ambient = new THREE.AmbientLight(0xffffff, 0.65);
  scene.add(ambient);
  scene.add(new THREE.GridHelper(40000, 40, 0xb7bdc4, 0xc5ccd3));
  const root = new THREE.Group();
  scene.add(root);
  let mode = "sky";
  let walk = null;
  let look = null;
  const held = new Set();
  let turnModifier = false;
  let underlayKey = "";
  let underlayTexture = null;
  let selection = null;
  let spin = null;
  let spinGroup = null;
  let doorAmount = 1;
  let doorTarget = 1;
  const doorLeaves = [];
  let slide = null;
  let blank = null;
  const raycaster = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const spinPlane = new THREE.Plane();
  const spinHit = new THREE.Vector3();

  function resize() {
    const rect = canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    renderer.setPixelRatio(dpr);
    renderer.setSize(Math.max(1, rect.width), Math.max(1, rect.height), false);
    camera.aspect = rect.width / Math.max(1, rect.height);
    camera.updateProjectionMatrix();
  }

  function rebuild() {
    spinGroup = null;
    doorLeaves.length = 0;
    while (root.children.length) root.remove(root.children[0]);
    const plan = store.get();
    const level = BRIGHTNESS[plan.settings.brightness] ?? BRIGHTNESS[1];
    sun.intensity = 1.1 * level;
    ambient.intensity = 0.55 * level;
    const ceiling = plan.settings.ceiling;
    ensureUnderlay(plan);
    if (plan.underlay && underlayTexture) {
      const plane = new THREE.Mesh(
        new THREE.PlaneGeometry(plan.underlay.w, plan.underlay.h),
        new THREE.MeshBasicMaterial({ map: underlayTexture, transparent: true, opacity: 0.85 }),
      );
      plane.rotation.x = -Math.PI / 2;
      plane.position.set(plan.underlay.x + plan.underlay.w / 2, 1, plan.underlay.y + plan.underlay.h / 2);
      root.add(plane);
    }
    for (const room of plan.rooms) addRoom(room, plan, ceiling);
    for (const entry of plan.items) addItem(entry, plan, ceiling, level);
    const sole = selection?.kind === "item" && selection.ids.length === 1
      ? plan.items.find((row) => row.id === selection.ids[0])
      : null;
    if (sole && !sole.locked && !sole.openingId && sole.place !== "wall") addSpin(sole, plan, ceiling);
  }

  function addRoom(room, plan, ceiling) {
    const lift = Number(room.raisedFloor) || 0;
    const floorH = 40 + lift;
    const floor = new THREE.Mesh(
      floorGeometry(room, 0, floorH),
      new THREE.MeshLambertMaterial({ color: room.floorColor || room.color }),
    );
    floor.rotation.x = -Math.PI / 2;
    root.add(floor);
    addWalls(room, plan, ceiling);
    const drop = Number(room.dropCeiling) || 0;
    if (drop > 40) {
      const slab = new THREE.Mesh(
        floorGeometry(room, plan.settings.wall, 20),
        new THREE.MeshLambertMaterial({ color: room.wallColor || "#e7edf2", transparent: true, opacity: 0.28, depthWrite: false, side: THREE.DoubleSide }),
      );
      slab.rotation.x = -Math.PI / 2;
      slab.position.y = ceiling - drop - 20;
      root.add(slab);
    }
  }

  function floorGeometry(room, inset, depth) {
    const center = centroid(room);
    const outline = outlinePoints(room, 50).map((point) => {
      if (!inset) return point;
      const vx = center.x - point.x;
      const vy = center.y - point.y;
      const len = Math.hypot(vx, vy) || 1;
      return { x: point.x + (vx / len) * inset, y: point.y + (vy / len) * inset };
    });
    const shape = new THREE.Shape();
    outline.forEach((point, index) => {
      if (index === 0) shape.moveTo(point.x, -point.y);
      else shape.lineTo(point.x, -point.y);
    });
    const geom = new THREE.ExtrudeGeometry(shape, { depth: Math.max(1, depth || 1), bevelEnabled: false });
    return geom;
  }

  function addItem(entry, plan, ceiling, level) {
    if (entry.openingId) {
      addLeaf(entry, plan);
      return;
    }
    const cat = lookupItem(entry.catalogId, plan.customItems);
    const host = entry.hostId ? plan.items.find((row) => row.id === entry.hostId) : null;
    const room = roomFor(host || entry, plan);
    const lift = Number(room?.raisedFloor) || 0;
    const drop = Number(room?.dropCeiling) || 0;
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(entry.w, entry.h, entry.d),
      new THREE.MeshLambertMaterial({ color: entry.color || cat?.color || "#999999" }),
    );
    const top = counterTop(plan.items, entry);
    let y = lift + top + entry.h / 2;
    if (entry.place === "ceiling") y = ceiling - drop - entry.h / 2;
    if (entry.place === "wall") y = lift + (entry.z || entry.h / 2);
    mesh.position.set(entry.x, y, entry.y);
    mesh.rotation.y = (-entry.rot * Math.PI) / 180;
    tag(mesh, { pick: "item", id: entry.id }, chosen("item", entry.id));
    root.add(mesh);
    if (entry.light && entry.lightOn) {
      const bulb = new THREE.PointLight(entry.lightColor || "#fff4d6", (Number(entry.lightLevel) || 1) / 10 * 4 * level, 4500);
      bulb.position.set(entry.x, y, entry.y);
      root.add(bulb);
    }
  }

  function addLeaf(entry, plan) {
    const opening = (plan.openings || []).find((row) => row.id === entry.openingId);
    const room = opening && plan.rooms.find((row) => row.id === opening.roomId);
    if (!opening || !room) return;
    const center = openingCenter(room, opening);
    const wall = center.wall;
    const lift = Number(room.raisedFloor) || 0;
    const y = lift + opening.sill + opening.h / 2;
    const cat = lookupItem(entry.catalogId, plan.customItems);
    const swing = cat?.swing || (entry.leaf === "window" ? "window" : "single");
    const leafH = opening.h * 0.96;
    const tangent = wall.tangentAt(center.along);
    if (swing === "window") {
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(opening.w, opening.h * 0.92, 28),
        new THREE.MeshLambertMaterial({ color: entry.color || "#9ec9e0", transparent: true, opacity: 0.45, depthWrite: false }),
      );
      mesh.position.set(center.x, y, center.y);
      mesh.rotation.y = -tangent;
      tag(mesh, { pick: "opening", id: opening.id }, chosen("opening", opening.id));
      root.add(mesh);
      return;
    }
    if (swing === "slide") {
      const sign = entry.hinge === "end" ? 1 : -1;
      const shift = sign * opening.w * 0.42;
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(opening.w * 0.92, leafH, 36),
        new THREE.MeshLambertMaterial({ color: entry.color || "#d7c4a8" }),
      );
      const openX = center.x + Math.cos(tangent) * shift + wall.nx * 40;
      const openZ = center.y + Math.sin(tangent) * shift + wall.ny * 40;
      mesh.position.set(
        center.x + (openX - center.x) * doorAmount,
        y,
        center.y + (openZ - center.y) * doorAmount,
      );
      mesh.rotation.y = -tangent;
      tag(mesh, { pick: "opening", id: opening.id }, chosen("opening", opening.id));
      root.add(mesh);
      doorLeaves.push({ kind: "slide", mesh, x0: center.x, z0: center.y, x1: openX, z1: openZ, y });
      return;
    }
    const hinges = swing === "double" ? ["start", "end"] : [entry.hinge === "end" ? "end" : "start"];
    const leafW = (swing === "double" ? opening.w / 2 : opening.w) * 0.96;
    for (const hinge of hinges) {
      const pose = leafSwing(wall, hinge, swing);
      const hp = hingePoint(room, opening, hinge);
      const group = new THREE.Group();
      group.position.set(hp.x, y, hp.y);
      group.rotation.y = -(pose.closed + pose.delta * doorAmount);
      const mesh = new THREE.Mesh(
        new THREE.BoxGeometry(leafW, leafH, 36),
        new THREE.MeshLambertMaterial({ color: entry.color || "#c9a27a" }),
      );
      mesh.position.x = leafW / 2;
      tag(mesh, { pick: "opening", id: opening.id }, chosen("opening", opening.id));
      group.add(mesh);
      root.add(group);
      doorLeaves.push({ kind: "swing", group, closed: pose.closed, delta: pose.delta });
    }
  }

  function addSpin(entry, plan, ceiling) {
    const radius = Math.max(entry.w, entry.d) * 0.5 + 220;
    const y = itemBaseY(entry, plan, ceiling) + 30;
    const group = new THREE.Group();
    group.userData.itemId = entry.id;
    const ring = new THREE.Mesh(
      new THREE.TorusGeometry(radius, 70, 8, 56),
      new THREE.MeshBasicMaterial({ color: 0x1d6fd4, depthTest: false, transparent: true, opacity: 0.92 }),
    );
    ring.rotation.x = Math.PI / 2;
    ring.position.set(entry.x, y, entry.y);
    ring.renderOrder = 3;
    tag(ring, { pick: "spin", id: entry.id }, false);
    group.add(ring);
    const nub = new THREE.Mesh(
      new THREE.SphereGeometry(110, 12, 8),
      new THREE.MeshBasicMaterial({ color: 0x1d6fd4, depthTest: false }),
    );
    const ang = (entry.rot * Math.PI) / 180;
    nub.position.set(entry.x + Math.cos(ang) * radius, y, entry.y + Math.sin(ang) * radius);
    nub.renderOrder = 4;
    tag(nub, { pick: "spin", id: entry.id }, false);
    group.add(nub);
    root.add(group);
    spinGroup = group;
    syncSpinRoom();
  }

  function syncSpinRoom() {
    if (!spinGroup) return;
    if (mode !== "walk" || !walk) {
      spinGroup.visible = true;
      return;
    }
    const plan = store.get();
    const entry = (plan.items || []).find((row) => row.id === spinGroup.userData.itemId);
    spinGroup.visible = !!entry && sameRoomAsViewer(entry, plan, walk.x, walk.z);
  }

  function sameRoomAsViewer(entry, plan, x, z) {
    const itemRoom = roomFor(entry, plan);
    let here = null;
    for (let i = (plan.rooms || []).length - 1; i >= 0; i -= 1) {
      if (pointInRoom(plan.rooms[i], x, z)) {
        here = plan.rooms[i];
        break;
      }
    }
    if (!itemRoom || !here) return false;
    return itemRoom.id === here.id;
  }

  function itemBaseY(entry, plan, ceiling) {
    const host = entry.hostId ? plan.items.find((row) => row.id === entry.hostId) : null;
    const room = roomFor(host || entry, plan);
    const lift = Number(room?.raisedFloor) || 0;
    const drop = Number(room?.dropCeiling) || 0;
    if (entry.place === "ceiling") return ceiling - drop - entry.h;
    if (entry.place === "wall") return lift + (Number(entry.z) || 0);
    return lift + counterTop(plan.items, entry);
  }

  function chosen(kind, id) {
    return selection?.kind === kind && selection.ids.includes(id);
  }

  function tag(mesh, data, on) {
    mesh.userData = data;
    if (on && mesh.material?.emissive) {
      mesh.material.emissive.set("#0060b0");
      mesh.material.emissiveIntensity = 0.35;
    }
  }

  function eventNdc(event) {
    const rect = canvas.getBoundingClientRect();
    ndc.x = ((event.clientX - rect.left) / Math.max(1, rect.width)) * 2 - 1;
    ndc.y = -((event.clientY - rect.top) / Math.max(1, rect.height)) * 2 + 1;
  }

  function rayHit(event) {
    eventNdc(event);
    raycaster.setFromCamera(ndc, camera);
    const hits = raycaster.intersectObjects(root.children, true);
    for (const hit of hits) {
      let obj = hit.object;
      let visible = true;
      let cursor = obj;
      while (cursor && cursor !== root) {
        if (!cursor.visible) visible = false;
        cursor = cursor.parent;
      }
      if (!visible) continue;
      while (obj && obj !== root) {
        if (obj.userData?.pick) return obj.userData;
        obj = obj.parent;
      }
    }
    return null;
  }

  function pointerOnPlane(event, y) {
    eventNdc(event);
    raycaster.setFromCamera(ndc, camera);
    spinPlane.set(new THREE.Vector3(0, 1, 0), -y);
    return raycaster.ray.intersectPlane(spinPlane, spinHit) ? spinHit.clone() : null;
  }

  function endGesture(event) {
    const doneSpin = spin;
    const doneSlide = slide;
    const click = blank;
    spin = null;
    slide = null;
    blank = null;
    look = null;
    if (doneSlide && !doneSlide.pending) {
      store.mutate((draft) => {
        const guests = draft.items.filter((item) => item.hostId === doneSlide.id).map((item) => item.id);
        seatItems(draft, [doneSlide.id, ...guests]);
      });
    }
    const done = doneSlide || doneSpin;
    if (done && !done.pending) {
      ui?.select({ kind: "item", ids: [done.id] });
      return;
    }
    if (!click || event?.type !== "pointerup") return;
    const dx = event.clientX - click.x;
    const dy = event.clientY - click.y;
    if (dx * dx + dy * dy <= 36) ui?.select(null);
  }

  function slideStarts(plan, id) {
    const starts = {};
    for (const entry of plan.items) {
      if (entry.id === id || entry.hostId === id) starts[entry.id] = { x: entry.x, y: entry.y };
    }
    return starts;
  }

  function addWalls(room, plan, ceiling) {
    const thickness = plan.settings.wall;
    const lift = Number(room.raisedFloor) || 0;
    const height = Math.max(100, ceiling - lift);
    const material = new THREE.MeshLambertMaterial({ color: room.wallColor || "#d7dde4", side: THREE.DoubleSide });
    const joins = room.points.map((_, index) => cornerJoin(room, index, thickness));
    for (let index = 0; index < room.points.length; index += 1) {
      const wall = edgeGeometry(room, index);
      const cuts = cutsForWall(plan, room, index)
        .map((cut) => ({
          a: clamp(cut.a, 0, wall.length),
          b: clamp(cut.b, 0, wall.length),
          bottom: clamp(lift + cut.sill, lift, ceiling),
          top: clamp(lift + cut.sill + cut.h, lift, ceiling),
        }))
        .filter((cut) => cut.b - cut.a > 20 && cut.top - cut.bottom > 20);
      const boxes = wallPieces(0, wall.length, lift, height, mergeCuts(cuts));
      const openEnds = {
        start: wallEndOpen(plan, room, index - 1, true, thickness, ceiling),
        end: wallEndOpen(plan, room, index + 1, false, thickness, ceiling),
      };
      for (const box of boxes) placeWallBox(wall, box, thickness, material, joins[index], joins[(index + 1) % room.points.length], openEnds);
    }
    for (let index = 0; index < joins.length; index += 1) {
      const join = joins[index];
      if (join.miter || cornerCutOpen(plan, room, index, thickness)) continue;
      if (Math.abs(polygonArea([join.vertex, join.innerB, join.innerA])) < 8) continue;
      addWallPrism(join.vertex, join.innerB, join.innerA, join.vertex, lift, lift + height, material, { start: true, end: true });
    }
  }

  function placeWallBox(wall, box, thickness, material, startJoin, endJoin, openEnds) {
    const len = box.len;
    const steps = wall.arc ? Math.max(1, Math.ceil(len / 220)) : 1;
    const span = box.mid - len / 2;
    const y0 = box.y - box.h / 2;
    const y1 = box.y + box.h / 2;
    for (let i = 0; i < steps; i += 1) {
      const a = span + (len * i) / steps;
      const b = span + (len * (i + 1)) / steps;
      if (wall.arc) {
        const mid = (a + b) / 2;
        const point = wall.pointAt(mid);
        const normal = wall.inwardAt(mid);
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(Math.max(8, b - a), box.h, thickness), material);
        mesh.position.set(point.x + normal.x * thickness / 2, box.y, point.y + normal.y * thickness / 2);
        mesh.rotation.y = -wall.tangentAt(mid);
        root.add(mesh);
        continue;
      }
      const normal = wall.inwardAt(wall.length / 2);
      const endOf = (along, atStart) => {
        const point = wall.pointAt(along);
        return {
          outer: point,
          inner: { x: point.x + normal.x * thickness, y: point.y + normal.y * thickness },
          cap: atStart,
        };
      };
      const left = endOf(a, a <= 1);
      const right = endOf(b, false);
      const startJoined = left.cap && startJoin && !openEnds?.start;
      const endJoined = b >= wall.length - 1 && endJoin && !openEnds?.end;
      const o0 = startJoined ? startJoin.vertex : left.outer;
      const i0 = startJoined ? joinInner(startJoin, "start") : left.inner;
      const o1 = endJoined ? endJoin.vertex : right.outer;
      const i1 = endJoined ? joinInner(endJoin, "end") : right.inner;
      if (polygonArea([o0, i0, i1, o1]) < 8) continue;
      addWallPrism(o0, i0, i1, o1, y0, y1, material, {
        start: !startJoined,
        end: !endJoined,
      });
    }
  }

  function cornerJoin(room, vertexIndex, thickness) {
    const prev = edgeGeometry(room, vertexIndex - 1);
    const next = edgeGeometry(room, vertexIndex);
    const vertex = next.a;
    const nA = prev.inwardAt(prev.length);
    const nB = next.inwardAt(0);
    const tA = angleVector(prev.tangentAt(prev.length));
    const tB = angleVector(next.tangentAt(0));
    const innerA = { x: vertex.x + nA.x * thickness, y: vertex.y + nA.y * thickness };
    const innerB = { x: vertex.x + nB.x * thickness, y: vertex.y + nB.y * thickness };
    const hit = lineIntersect(innerA, tA, innerB, tB);
    const offset = hit ? { x: hit.x - vertex.x, y: hit.y - vertex.y } : null;
    const inward = offset && dot(offset, nA) > thickness * 0.2 && dot(offset, nB) > thickness * 0.2;
    const near = offset && Math.hypot(offset.x, offset.y) <= thickness * 4;
    if (hit && inward && near) return { vertex, inner: hit, innerA, innerB, miter: true };
    return { vertex, innerA, innerB, miter: false };
  }

  function joinInner(join, side) {
    if (join.miter) return join.inner;
    return side === "start" ? join.innerB : join.innerA;
  }

  function wallEndOpen(plan, room, edgeIndex, atEnd, thickness, ceiling) {
    const count = room.points.length;
    const index = ((edgeIndex % count) + count) % count;
    const edge = edgeGeometry(room, index);
    const limit = ceiling - 80;
    return cutsForWall(plan, room, index).some((cut) => {
      const reaches = atEnd ? cut.b > edge.length - thickness - 20 : cut.a < thickness + 20;
      const sill = Number(cut.sill) || 0;
      return reaches && sill < 80 && sill + (Number(cut.h) || 0) >= limit;
    });
  }

  function cornerCutOpen(plan, room, vertexIndex, thickness) {
    const prev = edgeGeometry(room, vertexIndex - 1);
    const next = edgeGeometry(room, vertexIndex);
    const prevCuts = cutsForWall(plan, room, (vertexIndex - 1 + room.points.length) % room.points.length);
    const nextCuts = cutsForWall(plan, room, vertexIndex % room.points.length);
    const open = (cut) => (Number(cut.sill) || 0) < 80;
    return prevCuts.some((cut) => open(cut) && cut.b > prev.length - thickness - 20) || nextCuts.some((cut) => open(cut) && cut.a < thickness + 20);
  }

  function addWallPrism(o0, i0, i1, o1, y0, y1, material, caps) {
    const positions = [];
    const p = (point, y) => [point.x, y, point.y];
    const top = [p(o0, y1), p(i0, y1), p(i1, y1), p(o1, y1)];
    const low = [p(o0, y0), p(i0, y0), p(i1, y0), p(o1, y0)];
    const push = (a, b, c) => {
      const abx = b[0] - a[0];
      const aby = b[1] - a[1];
      const abz = b[2] - a[2];
      const acx = c[0] - a[0];
      const acy = c[1] - a[1];
      const acz = c[2] - a[2];
      const cx = aby * acz - abz * acy;
      const cy = abz * acx - abx * acz;
      const cz = abx * acy - aby * acx;
      if (cx * cx + cy * cy + cz * cz < 1) return;
      positions.push(...a, ...b, ...c);
    };
    push(top[0], top[1], top[2]);
    push(top[0], top[2], top[3]);
    const sides = [[0, 3], [2, 1]];
    if (caps?.end) sides.push([3, 2]);
    if (caps?.start) sides.push([1, 0]);
    for (const [from, to] of sides) {
      if (Math.hypot(low[from][0] - low[to][0], low[from][2] - low[to][2]) < 0.5) continue;
      push(low[from], low[to], top[to]);
      push(low[from], top[to], top[from]);
    }
    if (positions.length < 9) return;
    const geometry = new THREE.BufferGeometry();
    geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
    geometry.computeVertexNormals();
    root.add(new THREE.Mesh(geometry, material));
  }

  function mergeCuts(cuts) {
    const sorted = [...cuts].sort((p, q) => p.a - q.a);
    const merged = [];
    for (const cut of sorted) {
      const last = merged[merged.length - 1];
      if (last && cut.a <= last.b) {
        last.b = Math.max(last.b, cut.b);
        last.bottom = Math.min(last.bottom, cut.bottom);
        last.top = Math.max(last.top, cut.top);
      } else merged.push({ ...cut });
    }
    return merged;
  }

  function wallPieces(start, end, base, height, cuts) {
    const boxes = [];
    const full = (a, b) => boxes.push({ mid: (a + b) / 2, len: b - a, y: base + height / 2, h: height });
    const band = (a, b, low, high) => boxes.push({ mid: (a + b) / 2, len: b - a, y: (low + high) / 2, h: high - low });
    let cursor = start;
    for (const cut of cuts) {
      if (cut.a > cursor + 10) full(cursor, cut.a);
      if (cut.bottom - base > 10) band(cut.a, cut.b, base, cut.bottom);
      if (base + height - cut.top > 10) band(cut.a, cut.b, cut.top, base + height);
      cursor = Math.max(cursor, cut.b);
    }
    if (end > cursor + 10) full(cursor, end);
    return boxes;
  }

  function ensureUnderlay(plan) {
    const href = plan.underlay?.href;
    if (!href || href === underlayKey) return;
    underlayKey = href;
    const image = new Image();
    image.onload = () => {
      underlayTexture = new THREE.Texture(image);
      underlayTexture.needsUpdate = true;
      underlayTexture.colorSpace = THREE.SRGBColorSpace;
      rebuild();
    };
    image.src = href;
  }

  function eyeY(x, z) {
    const plan = store.get();
    let lift = 0;
    for (const room of plan.rooms || []) {
      if (pointInRoom(room, x, z)) lift = Math.max(lift, Number(room.raisedFloor) || 0);
    }
    return 1600 + lift;
  }

  function applyWalk() {
    if (!walk) return;
    const eye = eyeY(walk.x, walk.z);
    const dist = 3000;
    const cp = Math.cos(walk.pitch);
    camera.position.set(walk.x, eye, walk.z);
    controls.target.set(
      walk.x + Math.sin(walk.yaw) * cp * dist,
      eye + Math.sin(walk.pitch) * dist,
      walk.z + Math.cos(walk.yaw) * cp * dist,
    );
    camera.lookAt(controls.target);
    syncSpinRoom();
  }

  function walkFromCamera() {
    const faceX = controls.target.x - camera.position.x;
    const faceZ = controls.target.z - camera.position.z;
    const horiz = Math.hypot(faceX, faceZ) || 1;
    return {
      x: camera.position.x,
      z: camera.position.z,
      yaw: Math.atan2(faceX, faceZ),
      pitch: clamp(Math.atan2(controls.target.y - camera.position.y, horiz), -1.05, 0.7),
    };
  }

  function frame(now) {
    const dt = Math.min(0.05, (now - (frame.last || now)) / 1000);
    if (mode === "walk" && walk && held.size) {
      const turnLeft = held.has("q") || (turnModifier && held.has("arrowleft"));
      const turnRight = held.has("e") || (turnModifier && held.has("arrowright"));
      let forward = 0;
      let side = 0;
      if (held.has("w") || held.has("arrowup")) forward += 1;
      if (held.has("s") || held.has("arrowdown")) forward -= 1;
      if (!turnRight && (held.has("d") || held.has("arrowright"))) side += 1;
      if (!turnLeft && (held.has("a") || held.has("arrowleft"))) side -= 1;
      const len = Math.hypot(forward, side);
      if (len) {
        const speed = (held.has("shift") ? 4200 : 1800) * dt;
        walk.x += (Math.sin(walk.yaw) * forward - Math.cos(walk.yaw) * side) / len * speed;
        walk.z += (Math.cos(walk.yaw) * forward + Math.sin(walk.yaw) * side) / len * speed;
      }
      if (turnLeft) walk.yaw += 1.5 * dt;
      if (turnRight) walk.yaw -= 1.5 * dt;
      if (len || turnLeft || turnRight) applyWalk();
    }
    if (doorLeaves.length && Math.abs(doorAmount - doorTarget) > 0.001) {
      const step = 1.8 * dt;
      doorAmount = doorAmount < doorTarget ? Math.min(doorTarget, doorAmount + step) : Math.max(doorTarget, doorAmount - step);
      poseDoors();
    }
    frame.last = now;
    renderer.render(scene, camera);
    syncWalkMap();
    requestAnimationFrame(frame);
  }

  function poseDoors() {
    for (const leaf of doorLeaves) {
      if (leaf.kind === "swing") {
        leaf.group.rotation.y = -(leaf.closed + leaf.delta * doorAmount);
        continue;
      }
      leaf.mesh.position.set(
        leaf.x0 + (leaf.x1 - leaf.x0) * doorAmount,
        leaf.y,
        leaf.z0 + (leaf.z1 - leaf.z0) * doorAmount,
      );
    }
  }

  function toggleDoors() {
    doorTarget = doorTarget < 0.5 ? 1 : 0;
    return doorTarget === 1;
  }

  function syncWalkMap() {
    if (!map) return;
    const show = mode === "walk" && walk && !canvas.hidden;
    map.hidden = !show;
    if (show) drawWalkMap();
  }

  function mapProjection() {
    const width = map.clientWidth || 200;
    const height = map.clientHeight || 150;
    const plan = store.get();
    const rooms = plan.rooms || [];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const room of rooms) {
      minX = Math.min(minX, room.x);
      minY = Math.min(minY, room.y);
      maxX = Math.max(maxX, room.x + room.w);
      maxY = Math.max(maxY, room.y + room.h);
    }
    if (!Number.isFinite(minX)) {
      minX = walk.x - 4000;
      minY = walk.z - 3000;
      maxX = walk.x + 4000;
      maxY = walk.z + 3000;
    }
    const margin = 14;
    const spanX = Math.max(maxX - minX, 1);
    const spanY = Math.max(maxY - minY, 1);
    const scale = Math.min((width - margin * 2) / spanX, (height - margin * 2) / spanY);
    const originX = (width - spanX * scale) / 2;
    const originY = (height - spanY * scale) / 2;
    return {
      width,
      height,
      plan,
      rooms,
      minX,
      minY,
      scale,
      originX,
      originY,
      sx: (x) => originX + (x - minX) * scale,
      sy: (y) => originY + (y - minY) * scale,
    };
  }

  function drawWalkMap() {
    const dpr = window.devicePixelRatio || 1;
    const frame = mapProjection();
    const { width, height, plan, rooms, scale, sx, sy } = frame;
    const bitmapW = Math.max(1, Math.floor(width * dpr));
    const bitmapH = Math.max(1, Math.floor(height * dpr));
    if (map.width !== bitmapW || map.height !== bitmapH) {
      map.width = bitmapW;
      map.height = bitmapH;
    }
    mapCtx.setTransform(dpr, 0, 0, dpr, 0, 0);
    mapCtx.clearRect(0, 0, width, height);
    mapCtx.fillStyle = "#e6ebf1";
    mapCtx.fillRect(0, 0, width, height);
    for (const room of rooms) {
      const outline = outlinePoints(room, 180);
      if (outline.length < 3) continue;
      mapCtx.beginPath();
      outline.forEach((point, index) => {
        const x = sx(point.x);
        const y = sy(point.y);
        if (index === 0) mapCtx.moveTo(x, y);
        else mapCtx.lineTo(x, y);
      });
      mapCtx.closePath();
      mapCtx.fillStyle = room.floorColor || room.color || "#f7f4ee";
      mapCtx.fill();
      mapCtx.lineJoin = "round";
      mapCtx.lineWidth = Math.max(1.5, (Number(plan.settings?.wall) || 150) * scale);
      mapCtx.strokeStyle = room.wallColor || "#8e98a3";
      mapCtx.stroke();
    }
    for (const entry of plan.items || []) {
      const itemW = Number(entry.w) || 0;
      const itemD = Number(entry.d) || 0;
      if (itemW < 40 || itemD < 40) continue;
      const cat = lookupItem(entry.catalogId, plan.customItems);
      mapCtx.save();
      mapCtx.translate(sx(entry.x), sy(entry.y));
      mapCtx.rotate(((Number(entry.rot) || 0) * Math.PI) / 180);
      mapCtx.fillStyle = entry.color || cat?.color || "#8d97a3";
      mapCtx.fillRect((-itemW * scale) / 2, (-itemD * scale) / 2, itemW * scale, itemD * scale);
      mapCtx.restore();
    }
    for (const room of rooms) {
      if (room.w * scale < 42 || room.h * scale < 18 || !room.name) continue;
      const center = centroid(room);
      mapCtx.save();
      mapCtx.beginPath();
      mapCtx.rect(sx(room.x) + 2, sy(room.y) + 2, Math.max(0, room.w * scale - 4), Math.max(0, room.h * scale - 4));
      mapCtx.clip();
      mapCtx.fillStyle = "#243040";
      mapCtx.font = "10px sans-serif";
      mapCtx.textAlign = "center";
      mapCtx.textBaseline = "middle";
      mapCtx.fillText(room.name, sx(center.x), sy(center.y));
      mapCtx.restore();
    }
    const px = sx(walk.x);
    const py = sy(walk.z);
    const aim = 16;
    mapCtx.beginPath();
    mapCtx.moveTo(px, py);
    mapCtx.lineTo(px + Math.sin(walk.yaw) * aim, py + Math.cos(walk.yaw) * aim);
    mapCtx.strokeStyle = "#d40000";
    mapCtx.lineWidth = 2;
    mapCtx.stroke();
    drawStar(mapCtx, px, py);
  }

  map?.addEventListener("pointerdown", (event) => {
    if (mode !== "walk" || !walk || canvas.hidden) return;
    event.preventDefault();
    event.stopPropagation();
    const rect = map.getBoundingClientRect();
    const frame = mapProjection();
    walk.x = frame.minX + (event.clientX - rect.left - frame.originX) / frame.scale;
    walk.z = frame.minY + (event.clientY - rect.top - frame.originY) / frame.scale;
    applyWalk();
    syncWalkMap();
  });

  function setMode(next) {
    const enteringWalk = next === "walk" && mode !== "walk";
    mode = next;
    if (mode === "walk") {
      controls.enabled = false;
      if (enteringWalk) {
        const faceX = controls.target.x - camera.position.x;
        const faceZ = controls.target.z - camera.position.z;
        const yaw = Math.atan2(faceX, faceZ);
        const back = 1800;
        walk = {
          x: controls.target.x - Math.sin(yaw) * back,
          z: controls.target.z - Math.cos(yaw) * back,
          yaw,
          pitch: -0.08,
        };
      } else if (!walk) walk = walkFromCamera();
      applyWalk();
      syncWalkMap();
      return;
    }
    const stand = walk;
    walk = null;
    look = null;
    controls.enabled = true;
    controls.maxPolarAngle = Math.PI * 0.49;
    if (stand) {
      controls.target.set(stand.x, 0, stand.z);
      camera.position.set(stand.x + 3200, 4200, stand.z + 3200);
      controls.update();
    }
    syncWalkMap();
    syncSpinRoom();
  }

  function fit() {
    const plan = store.get();
    const boxes = plan.rooms.length ? plan.rooms : [{ x: 0, y: 0, w: 6000, h: 4000 }];
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const room of boxes) {
      minX = Math.min(minX, room.x);
      minY = Math.min(minY, room.y);
      maxX = Math.max(maxX, room.x + room.w);
      maxY = Math.max(maxY, room.y + room.h);
    }
    const cx = (minX + maxX) / 2;
    const cz = (minY + maxY) / 2;
    const span = Math.max(maxX - minX, maxY - minY, 2000);
    if (mode === "walk") {
      const x = minX + Math.min(1200, span * 0.2);
      const z = minY + Math.min(1200, span * 0.2);
      walk = {
        x,
        z,
        yaw: Math.atan2(cx - x, cz - z),
        pitch: -0.08,
      };
      applyWalk();
      return;
    }
    controls.target.set(cx, 0, cz);
    camera.position.set(cx + span * 0.85, span * 0.95, cz + span * 0.85);
    controls.update();
  }

  function capture() {
    renderer.render(scene, camera);
    return renderer.domElement.toDataURL("image/png");
  }

  function zoomBy(factor) {
    const next = Number(factor) || 1;
    if (mode === "walk") {
      camera.fov = clamp(camera.fov / next, 18, 80);
      camera.updateProjectionMatrix();
      return;
    }
    const offset = camera.position.clone().sub(controls.target);
    const length = offset.length();
    if (length < 1) return;
    offset.setLength(clamp(length / next, 400, 80000));
    camera.position.copy(controls.target).add(offset);
    controls.update();
  }

  canvas.addEventListener("wheel", (event) => {
    if (mode !== "walk" || !walk) return;
    event.preventDefault();
    zoomBy(event.deltaY > 0 ? 0.9 : 1.12);
  }, { passive: false });
  function moveKey(event) {
    if (event.code === "Numpad8") return "arrowup";
    if (event.code === "Numpad2") return "arrowdown";
    if (event.code === "Numpad4") return "arrowleft";
    if (event.code === "Numpad6") return "arrowright";
    const key = event.key.toLowerCase();
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", "w", "a", "s", "d", "q", "e"].includes(key)) return key;
    return "";
  }

  window.addEventListener("keydown", (event) => {
    if (mode !== "walk") return;
    if (document.querySelector("dialog[open]")) return;
    if (event.target instanceof Element && event.target.closest("input, textarea, select")) return;
    if (event.key === "Control") {
      turnModifier = true;
      return;
    }
    if (event.altKey || event.metaKey) return;
    if (event.ctrlKey && event.key.toLowerCase() === "w") {
      event.preventDefault();
      return;
    }
    if (event.key.toLowerCase() === "shift") {
      held.add("shift");
      return;
    }
    const key = moveKey(event);
    const withControl = key === "arrowleft" || key === "arrowright" || key === "arrowup" || key === "arrowdown" || key === "q" || key === "e";
    if (event.ctrlKey && !withControl) return;
    if (!key) return;
    if (event.ctrlKey) turnModifier = true;
    held.add(key);
    if (event.shiftKey) held.add("shift");
    event.preventDefault();
  });
  window.addEventListener("keyup", (event) => {
    if (event.key === "Control") turnModifier = false;
    const key = moveKey(event);
    if (key) held.delete(key);
    held.delete(event.key.toLowerCase());
    if (!event.shiftKey) held.delete("shift");
  });
  window.addEventListener("blur", () => {
    held.clear();
    turnModifier = false;
  });
  window.addEventListener("resize", resize);
  store.subscribe(rebuild);
  resize();
  rebuild();
  fit();
  frame(performance.now());

  function getPose() {
    return {
      mode,
      px: camera.position.x,
      py: camera.position.y,
      pz: camera.position.z,
      tx: controls.target.x,
      ty: controls.target.y,
      tz: controls.target.z,
    };
  }

  function setPose(pose) {
    if (!pose) return;
    camera.position.set(pose.px, pose.py, pose.pz);
    controls.target.set(pose.tx, pose.ty, pose.tz);
    mode = pose.mode === "walk" ? "walk" : "sky";
    if (mode === "walk") {
      controls.enabled = false;
      walk = walkFromCamera();
      applyWalk();
    } else {
      walk = null;
      look = null;
      controls.enabled = true;
      controls.maxPolarAngle = Math.PI * 0.49;
      controls.update();
      syncSpinRoom();
    }
  }

  function setSelection(next) {
    selection = next?.ids?.length ? { kind: next.kind, ids: [...next.ids] } : null;
    rebuild();
  }

  canvas.addEventListener("pointerdown", (event) => {
    if (event.button !== 0) return;
    const hit = rayHit(event);
    if (!hit) {
      blank = selection ? { x: event.clientX, y: event.clientY } : null;
      if (mode === "walk" && walk) {
        look = { x: event.clientX, y: event.clientY, yaw: walk.yaw, pitch: walk.pitch };
        event.stopImmediatePropagation();
        try { canvas.setPointerCapture(event.pointerId); } catch { /* capture is optional */ }
      }
      return;
    }
    blank = null;
    if (hit.pick === "spin") {
      const entry = store.get().items.find((row) => row.id === hit.id);
      if (!entry || entry.locked) return;
      const point = pointerOnPlane(event, itemBaseY(entry, store.get(), store.get().settings.ceiling) + 30);
      if (!point) return;
      event.stopImmediatePropagation();
      event.preventDefault();
      spin = {
        id: entry.id,
        startRot: Number(entry.rot) || 0,
        startAngle: Math.atan2(point.z - entry.y, point.x - entry.x),
        pending: true,
      };
      try { canvas.setPointerCapture(event.pointerId); } catch { /* capture is optional */ }
      return;
    }
    if (hit.pick === "item") {
      const entry = store.get().items.find((row) => row.id === hit.id);
      const already = selection?.kind === "item" && selection.ids.length === 1 && selection.ids[0] === hit.id;
      if (already && entry && !entry.locked && !entry.openingId && entry.place !== "wall") {
        const point = pointerOnPlane(event, itemBaseY(entry, store.get(), store.get().settings.ceiling) + 30);
        if (point) {
          event.stopImmediatePropagation();
          event.preventDefault();
          slide = {
            id: entry.id,
            startX: entry.x,
            startY: entry.y,
            originX: point.x,
            originZ: point.z,
            starts: slideStarts(store.get(), entry.id),
            pending: true,
          };
          try { canvas.setPointerCapture(event.pointerId); } catch { /* capture is optional */ }
          return;
        }
      }
    }
    event.stopImmediatePropagation();
    if (ui?.tool !== "select") ui?.setTool("select");
    if (hit.pick === "opening") ui?.select({ kind: "opening", ids: [hit.id] });
    else ui?.select({ kind: "item", ids: [hit.id] });
  }, true);

  canvas.addEventListener("pointermove", (event) => {
    if (look && walk) {
      walk.yaw = look.yaw - (event.clientX - look.x) * 0.005;
      walk.pitch = clamp(look.pitch - (event.clientY - look.y) * 0.004, -1.05, 0.7);
      applyWalk();
      return;
    }
    if (slide) {
      const plan = store.get();
      const entry = plan.items.find((row) => row.id === slide.id);
      if (!entry || entry.locked) {
        endGesture();
        return;
      }
      const point = pointerOnPlane(event, itemBaseY(entry, plan, plan.settings.ceiling) + 30);
      if (!point) return;
      const steps = [plan.settings.module / plan.settings.division, (Number(plan.settings.wall) || 150) / 2];
      const enabled = plan.settings.snap !== false;
      const x = snapValue(slide.startX + (point.x - slide.originX), steps, enabled);
      const y = snapValue(slide.startY + (point.z - slide.originZ), steps, enabled);
      if (Math.round(entry.x) === Math.round(x) && Math.round(entry.y) === Math.round(y)) return;
      if (slide.pending) {
        store.checkpoint();
        slide.pending = false;
      }
      store.mutate((draft) => {
        const row = draft.items.find((item) => item.id === slide.id);
        if (!row || row.locked) return;
        row.x = x;
        row.y = y;
        shiftGuests(draft, [row.id], slide.starts);
      });
      return;
    }
    if (!spin) return;
    const plan = store.get();
    const entry = plan.items.find((row) => row.id === spin.id);
    if (!entry || entry.locked) {
      endGesture();
      return;
    }
    const point = pointerOnPlane(event, itemBaseY(entry, plan, plan.settings.ceiling) + 30);
    if (!point) return;
    let delta = Math.atan2(point.z - entry.y, point.x - entry.x) - spin.startAngle;
    while (delta > Math.PI) delta -= Math.PI * 2;
    while (delta < -Math.PI) delta += Math.PI * 2;
    const step = Number(plan.settings.rotationStep) || 15;
    let rot = spin.startRot + (delta * 180) / Math.PI;
    rot = Math.round(rot / step) * step;
    rot = ((rot % 360) + 360) % 360;
    if (Math.round(Number(entry.rot) || 0) === rot) return;
    if (spin.pending) {
      store.checkpoint();
      spin.pending = false;
    }
    store.mutate((draft) => {
      const row = draft.items.find((item) => item.id === spin.id);
      if (!row || row.locked) return;
      row.rot = rot;
      const guests = draft.items.filter((item) => item.hostId === row.id).map((item) => item.id);
      seatItems(draft, [row.id, ...guests]);
    });
  });

  canvas.addEventListener("pointerup", endGesture);
  canvas.addEventListener("pointercancel", endGesture);

  return { setMode, resize, fit, zoomBy, getPose, setPose, capture, setSelection, toggleDoors };
}

function roomFor(entry, plan) {
  if (entry.roomId) {
    const named = plan.rooms.find((room) => room.id === entry.roomId);
    if (named) return named;
  }
  for (let i = plan.rooms.length - 1; i >= 0; i -= 1) {
    const room = plan.rooms[i];
    if (pointInRoom(room, entry.x, entry.y)) return room;
  }
  return null;
}

function drawStar(ctx, x, y) {
  const outer = 7;
  const inner = 3;
  ctx.beginPath();
  for (let i = 0; i < 10; i += 1) {
    const angle = -Math.PI / 2 + (i * Math.PI) / 5;
    const radius = i % 2 === 0 ? outer : inner;
    const px = x + Math.cos(angle) * radius;
    const py = y + Math.sin(angle) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
  ctx.fillStyle = "#e10600";
  ctx.strokeStyle = "#ffffff";
  ctx.lineWidth = 1.5;
  ctx.fill();
  ctx.stroke();
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function angleVector(angle) {
  return { x: Math.cos(angle), y: Math.sin(angle) };
}

function dot(a, b) {
  return a.x * b.x + a.y * b.y;
}

function lineIntersect(p, d, q, e) {
  const det = d.x * e.y - d.y * e.x;
  if (Math.abs(det) < 1e-6) return null;
  const s = ((q.x - p.x) * e.y - (q.y - p.y) * e.x) / det;
  return { x: p.x + d.x * s, y: p.y + d.y * s };
}

function polygonArea(points) {
  let sum = 0;
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % points.length];
    sum += a.x * b.y - b.x * a.y;
  }
  return Math.abs(sum) / 2;
}
