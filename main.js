import { bookToPlan, planToBook } from "./book.js?v=20261026d";
import { insertPoint, removePoint, roomArea, scaleRoom, setEdgeArc } from "./geometry.js?v=20261022d";
import { ROOM_TYPES, categoryTree, lookupItem } from "./catalog.js";
import { readTables, writeWorkbook } from "./excelio.js?v=20261026d";
import { attachLeaf, clampOpenings, hingeForHand, noteRemovedVertex, resizeOpening, splitEdgeOpenings } from "./openings.js?v=20261022f";
import { bindPower, powerPanel } from "./power.js?v=20261027m";
import { createStore, uid } from "./store.js?v=20261026d";
import { seatItems } from "./surface.js?v=20261022l";
import { createView2d } from "./view2d.js?v=20261027n";

const store = createStore();
const ui = createController();
const sidebar = document.querySelector("#sidebar");
const view2d = createView2d(document.querySelector("#view2d"), store, ui);
const FOLD_KEY = "neosupo-star-beta5-folds";

function readFolds() {
  try {
    return JSON.parse(localStorage.getItem(FOLD_KEY)) || {};
  } catch {
    return {};
  }
}

function resizeViews() {
  requestAnimationFrame(() => {
    view2d.resize();
    view3d?.resize();
  });
}

function setFold(kind, folded) {
  const saved = readFolds();
  saved[kind] = folded;
  localStorage.setItem(FOLD_KEY, JSON.stringify(saved));
  if (kind === "menu") {
    document.querySelector(".workspace").classList.toggle("menu-folded", folded);
    const button = document.querySelector("#fold-menu");
    button.setAttribute("aria-expanded", String(!folded));
    button.textContent = folded ? "パネル" : "パネルを閉じる";
  } else {
    document.querySelector("#float-tools").classList.toggle("folded", folded);
    const button = document.querySelector("#fold-tools");
    button.setAttribute("aria-expanded", String(!folded));
    button.textContent = folded ? "操作" : "閉じる";
  }
  resizeViews();
}

const storedFolds = readFolds();
if (storedFolds.menu) setFold("menu", true);
if (storedFolds.tools) setFold("tools", true);
document.querySelector("#fold-menu").addEventListener("click", () => {
  setFold("menu", !document.querySelector(".workspace").classList.contains("menu-folded"));
});
document.querySelector("#fold-tools").addEventListener("click", () => {
  setFold("tools", !document.querySelector("#float-tools").classList.contains("folded"));
});
let view3d = null;
let tab = "layout";
let mode = "2d";

document.querySelectorAll(".tabs button").forEach((button) => {
  button.addEventListener("click", () => {
    tab = button.dataset.tab;
    ui.setTab(tab);
    document.querySelectorAll(".tabs button").forEach((el) => el.classList.toggle("active", el === button));
    if (tab === "items" || tab === "layout" || tab === "power") ui.setTool("select");
    renderSidebar();
  });
});

document.querySelector("#mode-2d").addEventListener("click", () => setMode("2d"));
document.querySelector("#mode-3d").addEventListener("click", () => setMode("3d"));
document.querySelector("#fit").addEventListener("click", () => {
  if (mode === "3d") view3d?.fit();
  else view2d.fit();
});
document.querySelector("#zoom-in").addEventListener("click", () => {
  if (mode === "3d") view3d?.zoomBy(1.2);
  else view2d.zoomBy(1.2);
});
document.querySelector("#zoom-out").addEventListener("click", () => {
  if (mode === "3d") view3d?.zoomBy(0.8);
  else view2d.zoomBy(0.8);
});
document.querySelector("#undo").addEventListener("click", () => store.undo());
document.querySelector("#redo").addEventListener("click", () => store.redo());
document.querySelector("#snap").addEventListener("change", (event) => {
  store.update((plan) => {
    plan.settings.snap = event.target.checked;
  });
});
document.querySelector("#sky").addEventListener("click", () => {
  view3d?.setMode("sky");
  markViewMode("sky");
});
document.querySelector("#walk").addEventListener("click", () => {
  view3d?.setMode("walk");
  markViewMode("walk");
});
document.querySelector("#doors").addEventListener("click", () => {
  if (!view3d) return;
  markDoors(view3d.toggleDoors());
});
document.querySelector("#new-plan").addEventListener("click", () => document.querySelector("#dialog-new").showModal());
document.querySelector("#new-cancel").addEventListener("click", () => document.querySelector("#dialog-new").close());
document.querySelector("#form-new").addEventListener("submit", (event) => {
  const data = new FormData(event.currentTarget);
  store.newPlan({
    ceiling: data.get("ceiling"),
    floorHeight: data.get("floorHeight"),
    wall: data.get("wall"),
  });
  view2d.fit();
});
document.querySelector("#plan-list").addEventListener("click", () => {
  renderPlanList();
  document.querySelector("#dialog-list").showModal();
});
document.querySelector("#detail").addEventListener("click", () => {
  renderDetail();
  document.querySelector("#dialog-detail").showModal();
});
document.querySelector("#help").addEventListener("click", () => document.querySelector("#dialog-help").showModal());
document.querySelector("#print").addEventListener("click", () => {
  renderDetail();
  window.print();
});
document.querySelector("#plan-name").addEventListener("change", (event) => store.rename(event.target.value));
document.querySelector("#export-excel").addEventListener("click", exportExcel);
document.querySelector("#import-excel").addEventListener("click", () => document.querySelector("#excel-file").click());
document.querySelector("#excel-file").addEventListener("change", async (event) => {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (file) await importExcel(file);
});
window.addEventListener("keydown", (event) => {
  const typing = event.target.matches("input, textarea, select");
  const command = event.ctrlKey || event.metaKey;
  if (command && event.key.toLowerCase() === "z") {
    event.preventDefault();
    store.undo();
  } else if (command && event.key.toLowerCase() === "y") {
    event.preventDefault();
    store.redo();
  } else if (!typing && command && (event.key.toLowerCase() === "d" || event.key.toLowerCase() === "c")) {
    event.preventDefault();
    duplicateSelection();
  } else if (!typing && command && event.key.toLowerCase() === "g") {
    event.preventDefault();
    groupSelection();
  } else if (!typing && (event.key === "Delete" || event.key === "Backspace")) {
    event.preventDefault();
    deleteSelection();
  }
});

sidebar.addEventListener("click", (event) => {
  const roomBtn = event.target.closest("[data-room]");
  if (roomBtn) {
    const type = ROOM_TYPES.find((room) => room.name === roomBtn.dataset.room);
    if (type) ui.setRoom(type.name, type.color);
  }
  const openingBtn = event.target.closest("[data-opening]");
  if (openingBtn) ui.setOpening(openingBtn.dataset.opening);
  const catBtn = event.target.closest("[data-cat]");
  if (catBtn) ui.setCatalog(catBtn.dataset.cat);
});
ui.subscribe(() => {
  renderSidebar();
  view3d?.setSelection(ui.selection);
});
store.subscribe(syncChrome);
renderSidebar();
syncChrome(store.get());
requestAnimationFrame(() => view2d.fit());

async function setMode(next) {
  mode = next;
  document.querySelector("#view2d").hidden = next !== "2d";
  document.querySelector("#view3d").hidden = next !== "3d";
  document.querySelector("#mode-2d").classList.toggle("active", next === "2d");
  document.querySelector("#mode-3d").classList.toggle("active", next === "3d");
  document.querySelector("#view-toggle").hidden = next !== "3d";
  if (next === "3d" && !view3d) {
    const mod = await import("./view3d.js?v=20261027q");
    view3d = mod.createView3d(document.querySelector("#view3d"), store, ui);
    view3d.setSelection(ui.selection);
  }
  if (next === "2d") requestAnimationFrame(() => view2d.resize());
  else requestAnimationFrame(() => view3d?.resize());
}

function markViewMode(next) {
  const walking = next === "walk";
  document.querySelector("#sky").classList.toggle("active", !walking);
  document.querySelector("#walk").classList.toggle("active", walking);
  const help = document.querySelector("#view-help");
  if (!help) return;
  help.textContent = walking
    ? "カーソルで移動（Ctrl押しながら左右で視点移動）Shiftで早く移動"
    : "ドラッグで見下ろします。右ドラッグで図面を移動し、ホイールと拡大・縮小で寄り引きします。";
}

function markDoors(open) {
  const button = document.querySelector("#doors");
  if (!button) return;
  button.textContent = open ? "ドアを閉じる" : "ドアを開く";
  button.setAttribute("aria-pressed", open ? "true" : "false");
}

function syncChrome(plan) {
  const name = document.querySelector("#plan-name");
  if (document.activeElement !== name) name.value = plan.name;
  document.querySelector("#snap").checked = plan.settings.snap;
}

function renderSidebar() {
  if (tab === "layout") sidebar.innerHTML = layoutPanel();
  else if (tab === "items") sidebar.innerHTML = itemPanel();
  else if (tab === "power") sidebar.innerHTML = powerPanel(store.get(), ui);
  else if (tab === "present") sidebar.innerHTML = presentPanel();
  bindSidebar();
}

function bindSidebar() {
  bindPower(sidebar, store, ui, renderSidebar);
  sidebar.querySelector("#module")?.addEventListener("change", (event) => {
    const value = event.target.value;
    store.update((plan) => {
      plan.settings.module = value === "custom" ? Number(sidebar.querySelector("#custom-module").value) || 1000 : Number(value);
    });
  });
  sidebar.querySelector("#custom-module")?.addEventListener("change", (event) => {
    store.update((plan) => {
      plan.settings.module = clamp(Number(event.target.value) || 1000, 100, 2000);
    });
  });
  sidebar.querySelector("#division")?.addEventListener("change", (event) => {
    store.update((plan) => {
      plan.settings.division = Number(event.target.value);
    });
  });
  sidebar.querySelector("#measure")?.addEventListener("click", () => ui.setTool("measure"));
  sidebar.querySelector("#select-tool")?.addEventListener("click", () => ui.setTool("select"));
  sidebar.querySelector("#underlay-file")?.addEventListener("change", async (event) => {
    const file = event.target.files?.[0];
    if (!file) return;
    try {
      const shrunk = await shrinkImage(file);
      store.update((plan) => {
        plan.underlay = {
          name: file.name,
          href: shrunk.href,
          x: 0,
          y: 0,
          w: 8000,
          h: Math.max(100, Math.round(8000 / shrunk.aspect)),
        };
      });
      ui.setTool("select");
      ui.select({ kind: "underlay", ids: ["underlay"] });
    } catch {
      /* ignore unreadable images */
    }
  });
  sidebar.querySelectorAll("[data-underlay]").forEach((input) => {
    input.addEventListener("change", () => {
      const key = input.dataset.underlay;
      store.update((plan) => {
        if (!plan.underlay) return;
        plan.underlay[key] = Number(input.value);
      });
    });
  });
  sidebar.querySelector("#underlay-clear")?.addEventListener("click", () => {
    store.update((plan) => {
      plan.underlay = null;
    });
    if (ui.selection?.kind === "underlay") ui.select(null);
    else renderSidebar();
  });
  sidebar.querySelector("#add-custom")?.addEventListener("click", addCustomItem);
  sidebar.querySelector("#brightness")?.addEventListener("change", (event) => {
    store.update((plan) => {
      plan.settings.brightness = Number(event.target.value);
    });
  });
  sidebar.querySelector("#shot")?.addEventListener("click", exportImage);
  sidebar.querySelector("#add-view")?.addEventListener("click", saveView);
  sidebar.querySelectorAll("[data-view]").forEach((button) => {
    button.addEventListener("click", () => restoreView(button.dataset.view));
  });
  sidebar.querySelectorAll("[data-view-del]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.viewDel;
      store.update((plan) => {
        plan.views = plan.views.filter((view) => view.id !== id);
      });
      renderSidebar();
    });
  });
  bindProps();
}

function layoutPanel() {
  const plan = store.get();
  const rooms = ROOM_TYPES.map((room) => {
    const active = ui.tool === "room" && ui.roomType === room.name ? "active" : "";
    return `<button type="button" data-room="${room.name}" class="${active}">${room.name}</button>`;
  }).join("");
  const custom = ![910, 1000, 1218].includes(plan.settings.module);
  const underlay = plan.underlay;
  return `
    <div class="side-block">
      <h2>部屋</h2>
      <button type="button" id="select-tool" class="${ui.tool === "select" ? "active" : ""}">選択 / 移動</button>
      ${rooms}
    </div>
    <div class="side-block">
      <h2>開口</h2>
      <p class="note">壁をクリックして穴を作ります。同じ線上で重なる隣室の壁も一緒に開きます。複製はできません。</p>
      <button type="button" data-opening="full" class="${ui.tool === "opening" && ui.openingPreset === "full" ? "active" : ""}">壁抜き</button>
      <button type="button" data-opening="hole" class="${ui.tool === "opening" && ui.openingPreset === "hole" ? "active" : ""}">開口部</button>
      <button type="button" data-opening="waist" class="${ui.tool === "opening" && ui.openingPreset === "waist" ? "active" : ""}">腰壁</button>
      <button type="button" id="measure" class="${ui.tool === "measure" ? "active" : ""}">計測</button>
    </div>
    <div class="side-block">
      <h2>グリッド</h2>
      <label>モジュール
        <select id="module">
          <option value="910" ${plan.settings.module === 910 ? "selected" : ""}>尺 910mm</option>
          <option value="1000" ${plan.settings.module === 1000 ? "selected" : ""}>メーター 1000mm</option>
          <option value="1218" ${plan.settings.module === 1218 ? "selected" : ""}>インチ 1218mm</option>
          <option value="custom" ${custom ? "selected" : ""}>任意間隔</option>
        </select>
      </label>
      <label>任意間隔 mm<input id="custom-module" type="number" min="100" max="2000" value="${plan.settings.module}" /></label>
      <label>分割
        <select id="division">
          ${[1, 2, 3, 4, 5, 6, 7, 8, 9, 10].map((n) => `<option value="${n}" ${plan.settings.division === n ? "selected" : ""}>1/${n}</option>`).join("")}
        </select>
      </label>
      <p class="note">スナップは壁厚の半分（${(Number(plan.settings.wall) || 150) / 2}mm）です。マス目の線にも止まります。</p>
    </div>
    <div class="side-block">
      <h2>下絵</h2>
      <label>画像<input id="underlay-file" type="file" accept="image/*" /></label>
      ${underlay ? `
        <p class="note">${escapeHtml(underlay.name || "下絵")}。図面でクリックして選び、角をドラッグすると縦横比を保って大きさが変わります。</p>
        <label>X mm<input data-underlay="x" type="number" value="${Math.round(underlay.x)}" /></label>
        <label>Y mm<input data-underlay="y" type="number" value="${Math.round(underlay.y)}" /></label>
        <label>幅 mm<input data-underlay="w" type="number" min="100" value="${Math.round(underlay.w)}" /></label>
        <label>高さ mm<input data-underlay="h" type="number" min="100" value="${Math.round(underlay.h)}" /></label>
        <button type="button" id="underlay-clear">下絵を外す</button>
      ` : `<p class="note">画像を選ぶと、図面の上で大きさを合わせられます。</p>`}
    </div>
    ${propsPanel()}
  `;
}

function itemPanel() {
  const plan = store.get();
  return `
    <div class="side-block">
      <h2>アイテム</h2>
      <button type="button" id="select-tool" class="${ui.tool === "select" ? "active" : ""}">選択 / 移動</button>
      <div class="tree">${renderTree(categoryTree(plan.customItems))}</div>
    </div>
    <div class="side-block">
      <h2>器具を追加</h2>
      <label>名前<input id="custom-name" type="text" /></label>
      <label>幅 mm<input id="custom-w" type="number" value="900" /></label>
      <label>奥行 mm<input id="custom-d" type="number" value="600" /></label>
      <label>高さ mm<input id="custom-h" type="number" value="800" /></label>
      <label>配置
        <select id="custom-place">
          <option value="floor">床</option>
          <option value="wall">壁</option>
          <option value="ceiling">天井</option>
          <option value="free">自由</option>
        </select>
      </label>
      <label>色<input id="custom-color" type="color" value="#d9d3c5" /></label>
      <label>単価<input id="custom-price" type="number" min="0" placeholder="未設定" /></label>
      <label class="check"><input id="custom-light" type="checkbox" /> 照明</label>
      <label class="check"><input id="custom-home" type="checkbox" /> 住宅設備</label>
      <button type="button" id="add-custom">カタログに追加</button>
    </div>
    ${propsPanel()}
  `;
}

function renderTree(nodes) {
  return nodes.map((node) => {
    const leaves = node.items.map((entry) => {
      const active = ui.catalogId === entry.id ? "active" : "";
      return `<button type="button" data-cat="${entry.id}" class="${active}">${escapeHtml(entry.name)}</button>`;
    }).join("");
    const children = node.children.length ? renderTree(node.children) : "";
    return `<details open><summary>${escapeHtml(node.name)}</summary>${leaves}${children}</details>`;
  }).join("");
}

function presentPanel() {
  const plan = store.get();
  const views = plan.views.map((view) => `
    <div class="plan-row">
      <button type="button" data-view="${view.id}">${escapeHtml(view.name)}</button>
      <button type="button" data-view-del="${view.id}">削除</button>
    </div>
  `).join("");
  const level = Number(plan.settings.brightness);
  return `
    <div class="side-block">
      <h2>視点リスト</h2>
      <p class="note">3D のカメラ位置を保存します。明るさはプラン全体で 3 段階です。</p>
      <label>明るさ
        <select id="brightness">
          <option value="0" ${level === 0 ? "selected" : ""}>暗い</option>
          <option value="1" ${level === 1 ? "selected" : ""}>標準</option>
          <option value="2" ${level === 2 ? "selected" : ""}>明るい</option>
        </select>
      </label>
      <button type="button" id="add-view">視点を追加</button>
      <button type="button" id="shot">画像を書き出す</button>
      ${plan.settings.exported ? `<p class="note">書き出し済み。編集はそのまま続けられます。</p>` : ""}
      ${views || `<p class="note">まだ視点がありません。</p>`}
    </div>
  `;
}

function propsPanel() {
  const sel = selectionState();
  if (!sel) return `<div class="props"><p class="note">選択するとサイズ、仕上げ、単価を変更できます。</p></div>`;
  if (sel.objs.length > 1) {
    const group = sel.kind === "item" ? `
      <button type="button" id="group-sel">グループ</button>
      <button type="button" id="ungroup-sel">グループ解除</button>
      <button type="button" id="rotate">回転</button>
      <button type="button" id="lock-sel">ロック</button>
      <button type="button" id="unlock-sel">ロック解除</button>
    ` : "";
    return `<div class="props"><h2>${sel.objs.length} 件を選択</h2>${group}<button type="button" id="dup">複製</button><button type="button" id="delete-sel">削除</button></div>`;
  }
  if (sel.kind === "room") return roomProps(sel.objs[0]);
  if (sel.kind === "opening") return openingProps(sel.objs[0]);
  if (sel.kind === "underlay") return `<div class="props"><h2>下絵</h2><p class="note">角をドラッグすると大きさが変わります。中をドラッグすると位置が動きます。</p><button type="button" id="delete-sel">削除</button></div>`;
  return itemProps(sel.objs[0]);
}

function shownDoorId(opening, leaf) {
  if (!leaf) return "";
  if (leaf.catalogId === "door" || leaf.catalogId === "door-right") {
    return hingeForHand(opening.wallSide, "right") === leaf.hinge ? "door-right" : "door";
  }
  return leaf.catalogId || "";
}

function openingProps(opening) {
  const plan = store.get();
  const leaf = plan.items.find((entry) => entry.openingId === opening.id);
  const cat = leaf ? lookupItem(leaf.catalogId, plan.customItems) : null;
  const swing = cat?.swing || (leaf?.leaf === "window" ? "window" : "");
  const names = { full: "壁抜き", hole: "開口部", waist: "腰壁" };
  const selectedId = shownDoorId(opening, leaf);
  const options = [
    ["", "建具なし"],
    ["door", "左開き"],
    ["door-right", "右開き"],
    ["door-double", "両開き"],
    ["door-push", "押し戸"],
    ["door-slide", "引き戸"],
    ["window", "窓"],
  ].map(([id, name]) => `<option value="${id}" ${selectedId === id ? "selected" : ""}>${name}</option>`).join("");
  const hinge = leaf?.leaf === "door" && swing !== "double" && swing !== "window"
    ? `<button type="button" id="leaf-hinge">${swing === "slide" ? "引き方向を反対にする" : "吊元を反対にする"}</button>`
    : "";
  const color = leaf
    ? `<label>色<input id="leaf-color" type="color" value="${leaf.color || "#c9a27a"}" /></label>`
    : "";
  return `<div class="props">
    <h2>${names[opening.preset] || "開口"}</h2>
    <label>幅 mm<input data-field="w" type="number" min="200" value="${Math.round(opening.w)}" /></label>
    <label>高さ mm<input data-field="h" type="number" min="200" value="${Math.round(opening.h)}" /></label>
    <label>床からの高さ mm<input data-field="sill" type="number" min="0" value="${Math.round(opening.sill)}" /></label>
    <label>建具<select id="leaf-type">${options}</select></label>
    ${color}
    ${hinge}
    <p class="note">ドアを選ぶと床まで開きます。左開き・右開きは部屋の内側から見た吊元です。押し戸は外側へ開きます。開口は複製できません。</p>
    <button type="button" id="delete-sel">削除</button>
  </div>`;
}

function roomProps(room) {
  const pick = ui.wallPick?.roomId === room.id ? ui.wallPick : null;
  const edge = pick?.edgeIndex != null ? room.edges?.[pick.edgeIndex] : null;
  return `<div class="props">
    <h2>${escapeHtml(room.name)}</h2>
    <p class="note">床面積 ${(roomArea(room) / 1e6).toFixed(2)} ㎡。頂点をドラッグすると斜めになります。辺を選んで頂点や円弧を足します。Excelの部屋はマスなので、斜めと円弧は段差になります。</p>
    <label>幅 mm<input data-field="w" type="number" value="${Math.round(room.w)}" /></label>
    <label>奥行 mm<input data-field="h" type="number" value="${Math.round(room.h)}" /></label>
    <label>床材<input data-field="floorFinish" data-kind="text" type="text" value="${escapeHtml(room.floorFinish || "床")}" /></label>
    <label>床の色<input data-field="floorColor" data-kind="color" type="color" value="${room.floorColor || room.color}" /></label>
    <label>壁材<input data-field="wallFinish" data-kind="text" type="text" value="${escapeHtml(room.wallFinish || "壁")}" /></label>
    <label>壁の色<input data-field="wallColor" data-kind="color" type="color" value="${room.wallColor || "#8e98a3"}" /></label>
    <label>下がり天井 mm<input data-field="dropCeiling" type="number" min="0" value="${Math.round(room.dropCeiling || 0)}" /></label>
    <label>上げ床 mm<input data-field="raisedFloor" type="number" min="0" value="${Math.round(room.raisedFloor || 0)}" /></label>
    <button type="button" id="add-vertex">頂点を追加</button>
    <button type="button" id="remove-vertex">頂点を削除</button>
    <label>円弧の半径 mm<input id="arc-radius" type="number" min="100" value="${edge?.radius ? Math.round(edge.radius) : 2000}" /></label>
    <button type="button" id="arc-edge">この辺を円弧にする</button>
    <button type="button" id="arc-flip">円弧の向きを反対</button>
    <button type="button" id="straight-edge">この辺を直線に戻す</button>
    <button type="button" id="dup">複製</button>
    <button type="button" id="delete-sel">削除</button>
  </div>`;
}

function selectedRoom() {
  const sel = ui.selection;
  if (sel?.kind !== "room" || sel.ids.length !== 1) return null;
  return store.get().rooms.find((room) => room.id === sel.ids[0]) || null;
}

function addVertex() {
  const room = selectedRoom();
  const edgeIndex = ui.wallPick?.roomId === room?.id ? ui.wallPick.edgeIndex : null;
  if (!room || edgeIndex == null) return;
  store.update((plan) => {
    const target = plan.rooms.find((entry) => entry.id === room.id);
    if (!target) return;
    const info = insertPoint(target, edgeIndex);
    splitEdgeOpenings(plan, target, info.edgeIndex, info.splitAt);
    clampOpenings(plan, target);
  });
  ui.pickWall({ roomId: room.id, vertexIndex: null, edgeIndex });
}

function removeVertex() {
  const room = selectedRoom();
  const index = ui.wallPick?.roomId === room?.id ? ui.wallPick.vertexIndex : null;
  if (!room || index == null) return;
  store.update((plan) => {
    const target = plan.rooms.find((entry) => entry.id === room.id);
    if (!target || target.points.length <= 3) return;
    noteRemovedVertex(plan, target.id, index, target.points.length);
    removePoint(target, index);
    clampOpenings(plan, target);
  });
  ui.pickWall(null);
}

function curveEdge(mode) {
  const room = selectedRoom();
  const edgeIndex = ui.wallPick?.roomId === room?.id ? ui.wallPick.edgeIndex : null;
  if (!room || edgeIndex == null) return;
  store.update((plan) => {
    const target = plan.rooms.find((entry) => entry.id === room.id);
    if (!target) return;
    if (mode < 0) setEdgeArc(target, edgeIndex, 0, 1);
    else if (mode === 0) {
      const arc = target.edges?.[edgeIndex];
      if (arc?.radius) setEdgeArc(target, edgeIndex, arc.radius, -arc.bow);
    } else {
      const radius = Number(document.querySelector("#arc-radius")?.value) || 2000;
      const bow = target.edges?.[edgeIndex]?.bow ?? 1;
      setEdgeArc(target, edgeIndex, radius, bow);
    }
    clampOpenings(plan, target);
  });
  ui.pickWall({ roomId: room.id, vertexIndex: null, edgeIndex });
}

function hostLine(entry) {
  if (!entry.hostId) return "";
  const host = store.get().items.find((row) => row.id === entry.hostId);
  if (!host) return "";
  return `<p class="note">載っている台: ${escapeHtml(host.name)}</p><button type="button" id="drop-floor">床に下ろす</button>`;
}

function settleAround(plan, id) {
  const guests = plan.items.filter((entry) => entry.hostId === id).map((entry) => entry.id);
  seatItems(plan, [id, ...guests]);
}

function itemProps(entry) {
  const locked = !!entry.locked;
  const read = locked ? "readonly" : "";
  const wall = entry.place === "wall";
  const light = entry.light ? `
    <label class="check"><input id="light-on" type="checkbox" ${entry.lightOn ? "checked" : ""} /> 点灯</label>
    <label>明るさ 1-10<input id="light-level" type="range" min="1" max="10" value="${entry.lightLevel || 10}" /></label>
    <label>光の色<input data-field="lightColor" data-kind="color" type="color" value="${entry.lightColor || "#fff4d6"}" /></label>
  ` : "";
  const home = entry.residential ? `<label>デザイン<input data-field="design" data-kind="text" type="text" value="${escapeHtml(entry.design || "")}" /></label>` : "";
  return `<div class="props">
    <h2>${escapeHtml(entry.name)}</h2>
    <label class="check"><input id="item-lock" type="checkbox" ${locked ? "checked" : ""} /> ロック</label>
    <p class="note">${locked ? "ロック中です。解除すると移動、回転、削除、寸法の変更ができます。" : "幅・奥行・高さはここで変えます。3Dで選んだ器具をドラッグすると図面の横方向に動き、足元の円で回ります。"}</p>
    <label>幅 mm<input data-field="w" type="number" min="50" value="${Math.round(entry.w)}" ${read} /></label>
    <label>奥行 mm<input data-field="d" type="number" min="50" value="${Math.round(entry.d)}" ${read} /></label>
    <label>高さ mm<input data-field="h" type="number" min="50" value="${Math.round(entry.h)}" ${read} /></label>
    ${wall ? `<label>取付高さ mm<input data-field="z" type="number" value="${Math.round(entry.z || 0)}" ${read} /></label>` : `<label>角度<input data-field="rot" type="number" step="${store.get().settings.rotationStep}" value="${entry.rot}" ${read} /></label>`}
    ${hostLine(entry)}
    <label>色<input data-field="color" data-kind="color" type="color" value="${entry.color || "#cccccc"}" /></label>
    <label>単価<input data-field="price" data-kind="price" type="number" min="0" placeholder="未設定" value="${entry.price ?? ""}" /></label>
    <details>
      <summary>設備</summary>
      <label>メーカー<input data-field="maker" data-kind="text" type="text" value="${escapeHtml(entry.maker || "")}" /></label>
      <label>型式<input data-field="model" data-kind="text" type="text" value="${escapeHtml(entry.model || "")}" /></label>
      <label>重量 kg<input data-field="weightKg" type="number" min="0" value="${entry.weightKg ?? ""}" /></label>
      <label>電気<input data-field="power" data-kind="text" type="text" value="${escapeHtml(entry.power || "")}" /></label>
      <label>給水<input data-field="water" data-kind="text" type="text" value="${escapeHtml(entry.water || "")}" /></label>
      <label>排水<input data-field="drain" data-kind="text" type="text" value="${escapeHtml(entry.drain || "")}" /></label>
      <label>給気<input data-field="supplyAir" data-kind="text" type="text" value="${escapeHtml(entry.supplyAir || "")}" /></label>
      <label>排気<input data-field="exhaust" data-kind="text" type="text" value="${escapeHtml(entry.exhaust || "")}" /></label>
      <label>特ガス<input data-field="gas" data-kind="text" type="text" value="${escapeHtml(entry.gas || "")}" /></label>
      <label>備考<input data-field="note" data-kind="text" type="text" value="${escapeHtml(entry.note || "")}" /></label>
    </details>
    ${home}
    ${light}
    ${wall || locked ? "" : `<button type="button" id="rotate">回転</button>`}
    <button type="button" id="dup">複製</button>
    <button type="button" id="delete-sel">削除</button>
  </div>`;
}

function bindProps() {
  sidebar.querySelectorAll("[data-field]").forEach((input) => {
    input.addEventListener("change", () => {
      const sel = ui.selection;
      if (!sel || sel.ids.length !== 1) return;
      if (sel.kind === "opening") {
        store.update((plan) => {
          const opening = plan.openings.find((row) => row.id === sel.ids[0]);
          if (!opening) return;
          resizeOpening(plan, opening, { [input.dataset.field]: input.value });
        });
        return;
      }
      store.update((plan) => {
        const list = sel.kind === "room" ? plan.rooms : plan.items;
        const obj = list.find((row) => row.id === sel.ids[0]);
        if (!obj) return;
        const field = input.dataset.field;
        if (sel.kind === "item" && obj.locked && ["w", "d", "h", "rot", "z"].includes(field)) return;
        if (sel.kind === "item" && ["w", "d", "h"].includes(field)) {
          const max = field === "h" ? 12000 : 20000;
          obj[field] = clamp(Number(input.value) || 50, 50, max);
        } else writeField(obj, input);
        if (sel.kind === "room" && (input.dataset.field === "w" || input.dataset.field === "h")) {
          scaleRoom(obj, obj.w, obj.h);
          clampOpenings(plan, obj);
        }
        if (sel.kind === "item") settleAround(plan, obj.id);
      });
    });
  });
  sidebar.querySelector("#leaf-type")?.addEventListener("change", (event) => {
    const sel = ui.selection;
    if (sel?.kind !== "opening" || sel.ids.length !== 1) return;
    const catalogId = event.target.value;
    store.update((plan) => {
      const opening = plan.openings.find((row) => row.id === sel.ids[0]);
      if (!opening) return;
      if (!catalogId) {
        plan.items = plan.items.filter((entry) => entry.openingId !== opening.id);
        return;
      }
      const cat = lookupItem(catalogId, plan.customItems);
      if (!cat) return;
      attachLeaf(plan, opening, cat, uid());
    });
    renderSidebar();
  });
  sidebar.querySelector("#leaf-hinge")?.addEventListener("click", () => {
    const sel = ui.selection;
    if (sel?.kind !== "opening") return;
    store.update((plan) => {
      const opening = plan.openings.find((row) => row.id === sel.ids[0]);
      const leaf = plan.items.find((entry) => entry.openingId === sel.ids[0]);
      if (!leaf || !opening) return;
      leaf.hinge = leaf.hinge === "end" ? "start" : "end";
      if (leaf.catalogId === "door" || leaf.catalogId === "door-right") {
        const right = hingeForHand(opening.wallSide, "right") === leaf.hinge;
        leaf.catalogId = right ? "door-right" : "door";
        leaf.name = right ? "右開き" : "左開き";
      }
    });
    renderSidebar();
  });
  sidebar.querySelector("#leaf-color")?.addEventListener("change", (event) => {
    const sel = ui.selection;
    if (sel?.kind !== "opening") return;
    store.update((plan) => {
      const leaf = plan.items.find((entry) => entry.openingId === sel.ids[0]);
      if (leaf) leaf.color = event.target.value;
    });
  });
  sidebar.querySelector("#light-on")?.addEventListener("change", (event) => {
    updateSelectedItem((entry) => {
      entry.lightOn = event.target.checked;
    });
  });
  sidebar.querySelector("#light-level")?.addEventListener("change", (event) => {
    updateSelectedItem((entry) => {
      entry.lightLevel = Number(event.target.value);
    });
  });
  sidebar.querySelector("#delete-sel")?.addEventListener("click", deleteSelection);
  sidebar.querySelector("#dup")?.addEventListener("click", duplicateSelection);
  sidebar.querySelector("#rotate")?.addEventListener("click", rotateSelection);
  sidebar.querySelector("#add-vertex")?.addEventListener("click", addVertex);
  sidebar.querySelector("#remove-vertex")?.addEventListener("click", removeVertex);
  sidebar.querySelector("#arc-edge")?.addEventListener("click", () => curveEdge(1));
  sidebar.querySelector("#arc-flip")?.addEventListener("click", () => curveEdge(0));
  sidebar.querySelector("#straight-edge")?.addEventListener("click", () => curveEdge(-1));
  sidebar.querySelector("#item-lock")?.addEventListener("change", (event) => {
    updateSelectedItem((entry) => {
      entry.locked = event.target.checked;
    });
    ui.select(ui.selection);
  });
  sidebar.querySelector("#lock-sel")?.addEventListener("click", () => setLocked(true));
  sidebar.querySelector("#unlock-sel")?.addEventListener("click", () => setLocked(false));
  sidebar.querySelector("#drop-floor")?.addEventListener("click", () => {
    updateSelectedItem((entry) => {
      if (entry.locked) return;
      entry.hostId = null;
      entry.z = 0;
    });
    renderSidebar();
  });
  sidebar.querySelector("#group-sel")?.addEventListener("click", groupSelection);
  sidebar.querySelector("#ungroup-sel")?.addEventListener("click", ungroupSelection);
}

function writeField(obj, input) {
  const field = input.dataset.field;
  if (input.dataset.kind === "text" || input.dataset.kind === "color") obj[field] = input.value;
  else if (input.dataset.kind === "price") obj.price = input.value === "" ? null : Number(input.value);
  else if (input.value === "") obj[field] = "";
  else obj[field] = Number(input.value);
}

function updateSelectedItem(mutator) {
  const sel = ui.selection;
  if (sel?.kind !== "item" || sel.ids.length !== 1) return;
  store.update((plan) => {
    const entry = plan.items.find((row) => row.id === sel.ids[0]);
    if (entry) mutator(entry);
  });
}

function addCustomItem() {
  const name = sidebar.querySelector("#custom-name").value.trim();
  if (!name) return;
  const light = sidebar.querySelector("#custom-light").checked;
  const priceRaw = sidebar.querySelector("#custom-price").value;
  const id = `c${uid()}`;
  const entry = {
    id,
    name,
    category: ["追加器具"],
    w: clamp(Number(sidebar.querySelector("#custom-w").value) || 900, 10, 20000),
    d: clamp(Number(sidebar.querySelector("#custom-d").value) || 600, 10, 20000),
    h: clamp(Number(sidebar.querySelector("#custom-h").value) || 800, 10, 8000),
    place: light ? "ceiling" : sidebar.querySelector("#custom-place").value,
    color: sidebar.querySelector("#custom-color").value,
    price: priceRaw === "" ? null : Number(priceRaw),
    scalable: true,
    light,
    residential: sidebar.querySelector("#custom-home").checked,
    opening: false,
    mountHeight: 1200,
  };
  store.update((plan) => {
    plan.customItems.push(entry);
  });
  ui.setCatalog(id);
}

function selectionState() {
  const sel = ui.selection;
  if (!sel) return null;
  const plan = store.get();
  if (sel.kind === "underlay") return plan.underlay ? { kind: "underlay", objs: [plan.underlay] } : null;
  const list = sel.kind === "room" ? plan.rooms : sel.kind === "opening" ? plan.openings : plan.items;
  const objs = sel.ids.map((id) => list.find((row) => row.id === id)).filter(Boolean);
  return objs.length ? { kind: sel.kind, objs } : null;
}

function deleteSelection() {
  const sel = ui.selection;
  if (!sel) return;
  store.update((plan) => {
    if (sel.kind === "room") {
      const openingIds = plan.openings.filter((opening) => sel.ids.includes(opening.roomId)).map((opening) => opening.id);
      plan.rooms = plan.rooms.filter((room) => !sel.ids.includes(room.id));
      plan.openings = plan.openings.filter((opening) => !sel.ids.includes(opening.roomId));
      plan.items = plan.items.filter((entry) => !openingIds.includes(entry.openingId));
    }
    if (sel.kind === "opening") {
      plan.openings = plan.openings.filter((opening) => !sel.ids.includes(opening.id));
      plan.items = plan.items.filter((entry) => !sel.ids.includes(entry.openingId));
    }
    if (sel.kind === "underlay") plan.underlay = null;
    if (sel.kind === "item") {
      const remove = new Set(sel.ids.filter((id) => !plan.items.find((entry) => entry.id === id)?.locked));
      for (const entry of plan.items) {
        if (entry.hostId && remove.has(entry.hostId) && !remove.has(entry.id)) {
          entry.hostId = null;
          entry.z = 0;
        }
      }
      plan.items = plan.items.filter((entry) => !remove.has(entry.id));
      for (const breaker of plan.breakers || []) {
        if (remove.has(breaker.itemId)) breaker.itemId = null;
      }
    }
    if (sel.kind === "panel") {
      const ids = new Set(sel.ids);
      const breakerIds = new Set((plan.breakers || []).filter((row) => ids.has(row.panelId)).map((row) => row.id));
      plan.panels = plan.panels.filter((row) => !ids.has(row.id));
      plan.breakers = plan.breakers.filter((row) => !ids.has(row.panelId));
      for (const outlet of plan.outlets || []) {
        if (breakerIds.has(outlet.breakerId)) outlet.breakerId = null;
      }
    }
    if (sel.kind === "breaker") {
      const ids = new Set(sel.ids);
      plan.breakers = plan.breakers.filter((row) => !ids.has(row.id));
      for (const outlet of plan.outlets || []) {
        if (ids.has(outlet.breakerId)) outlet.breakerId = null;
      }
    }
    if (sel.kind === "outlet") {
      const ids = new Set(sel.ids);
      plan.outlets = plan.outlets.filter((row) => !ids.has(row.id));
    }
  });
  if (sel.kind === "item") {
    const kept = sel.ids.filter((id) => store.get().items.some((entry) => entry.id === id && entry.locked));
    ui.select(kept.length ? { kind: "item", ids: kept } : null);
    return;
  }
  ui.select(null);
}

function duplicateSelection() {
  const sel = ui.selection;
  if (!sel || sel.kind === "underlay" || sel.kind === "panel" || sel.kind === "breaker") return;
  if (sel.kind === "outlet") {
    const created = [];
    store.update((plan) => {
      for (const id of sel.ids) {
        const source = plan.outlets.find((row) => row.id === id);
        if (!source) continue;
        const copy = { ...source, id: uid(), x: source.x + 400, y: source.y + 400 };
        plan.outlets.push(copy);
        created.push(copy.id);
      }
    });
    if (created.length) ui.select({ kind: "outlet", ids: created });
    return;
  }
  if (sel.kind === "opening" || (sel.kind === "item" && sel.ids.some((id) => store.get().items.find((entry) => entry.id === id)?.openingId))) {
    return;
  }
  const created = [];
  const groups = new Map();
  store.update((plan) => {
    const list = sel.kind === "room" ? plan.rooms : plan.items;
    for (const id of sel.ids) {
      const obj = list.find((row) => row.id === id);
      if (!obj) continue;
      const copy = { ...structuredClone(obj), id: uid(), x: obj.x + 500, y: obj.y + 500, locked: false };
      if (obj.groupId) {
        if (!groups.has(obj.groupId)) groups.set(obj.groupId, uid());
        copy.groupId = groups.get(obj.groupId);
      }
      list.push(copy);
      created.push(copy.id);
    }
    if (sel.kind === "item") seatItems(plan, created);
  });
  if (created.length) ui.select({ kind: sel.kind, ids: created });
}

function rotateSelection() {
  const sel = ui.selection;
  if (sel?.kind !== "item") return;
  const targets = store.get().items.filter((entry) => sel.ids.includes(entry.id) && entry.place !== "wall" && !entry.openingId && !entry.locked);
  if (!targets.length) return;
  store.update((plan) => {
    for (const entry of plan.items) {
      if (targets.some((row) => row.id === entry.id)) entry.rot = (entry.rot + plan.settings.rotationStep) % 360;
    }
    const guests = plan.items.filter((entry) => targets.some((row) => row.id === entry.hostId)).map((entry) => entry.id);
    seatItems(plan, [...targets.map((row) => row.id), ...guests]);
  });
}

function setLocked(value) {
  const sel = ui.selection;
  if (sel?.kind !== "item") return;
  store.update((plan) => {
    for (const entry of plan.items) {
      if (sel.ids.includes(entry.id)) entry.locked = value;
    }
  });
  ui.select(sel);
}

function groupSelection() {
  const sel = ui.selection;
  if (sel?.kind !== "item" || sel.ids.length < 2) return;
  const groupId = uid();
  store.update((plan) => {
    for (const entry of plan.items) {
      if (sel.ids.includes(entry.id)) entry.groupId = groupId;
    }
  });
}

function ungroupSelection() {
  const sel = ui.selection;
  if (sel?.kind !== "item") return;
  store.update((plan) => {
    for (const entry of plan.items) {
      if (sel.ids.includes(entry.id)) entry.groupId = null;
    }
  });
}

function visiblePlans() {
  const all = store.list().slice().sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
  const shown = all.slice(0, 10);
  const active = store.get();
  if (active && !shown.some((plan) => plan.id === active.id)) {
    const current = all.find((plan) => plan.id === active.id);
    if (current) {
      shown.pop();
      shown.unshift(current);
    }
  }
  return { shown, kept: Math.max(0, all.length - shown.length) };
}

function renderPlanList() {
  const { shown, kept } = visiblePlans();
  const more = document.querySelector("#plan-more");
  if (more) more.hidden = kept === 0;
  const host = document.querySelector("#plan-rows");
  host.innerHTML = shown.map((plan) => `
    <div class="plan-row">
      <button type="button" data-open="${plan.id}">${escapeHtml(plan.name)}</button>
      <button type="button" data-copy="${plan.id}">複製</button>
      <button type="button" data-del="${plan.id}">削除</button>
    </div>
  `).join("");
  host.querySelectorAll("[data-open]").forEach((button) => {
    button.addEventListener("click", () => {
      store.open(button.dataset.open);
      document.querySelector("#dialog-list").close();
      renderSidebar();
      view2d.fit();
    });
  });
  host.querySelectorAll("[data-copy]").forEach((button) => {
    button.addEventListener("click", () => {
      store.open(button.dataset.copy);
      store.duplicate();
      renderPlanList();
      view2d.fit();
    });
  });
  host.querySelectorAll("[data-del]").forEach((button) => {
    button.addEventListener("click", () => {
      store.remove(button.dataset.del);
      renderPlanList();
      renderSidebar();
    });
  });
}

function renderDetail() {
  const html = detailHtml(store.get());
  document.querySelector("#detail-body").innerHTML = html;
  document.querySelector("#print-sheet").innerHTML = html;
}

function detailHtml(plan) {
  const lines = quoteLines(plan);
  const rows = lines.map((line) => {
    const amount = line.price == null ? "未設定" : `¥${(line.price * line.count).toLocaleString()}`;
    const unit = line.price == null ? "未設定" : `¥${line.price.toLocaleString()}`;
    const weight = line.weight == null ? "未設定" : formatKg(line.weight);
    return `<tr><td>${escapeHtml(line.name)}</td><td>${line.count}</td><td>${line.w}×${line.d}×${line.h}</td><td>${weight}</td><td>${unit}</td><td>${amount}</td></tr>`;
  }).join("");
  return `
    <p>${escapeHtml(plan.name)} / 天井高 ${plan.settings.ceiling}mm / 壁厚 ${plan.settings.wall}mm</p>
    <p>${totalLabel(plan)} / ${weightLabel(plan)}</p>
    <table>
      <thead><tr><th>名称</th><th>数量</th><th>幅×奥行×高さ mm</th><th>重量 kg</th><th>単価</th><th>金額</th></tr></thead>
      <tbody>${rows || `<tr><td colspan="6">器具はまだありません。</td></tr>`}</tbody>
    </table>
  `;
}

function quoteLines(plan) {
  const groups = new Map();
  for (const entry of plan.items) {
    const price = priceOf(entry);
    const weight = weightOf(entry);
    const name = entry.design ? `${entry.name}（${entry.design}）` : entry.name;
    const key = [name, entry.w, entry.d, entry.h, price, weight].join("|");
    const found = groups.get(key) || { name, count: 0, w: entry.w, d: entry.d, h: entry.h, price, weight };
    found.count += 1;
    groups.set(key, found);
  }
  return [...groups.values()];
}

function priceOf(entry) {
  if (entry.price == null || entry.price === "" || Number.isNaN(Number(entry.price))) return null;
  return Number(entry.price);
}

function weightOf(entry) {
  if (entry.weightKg == null || entry.weightKg === "" || Number.isNaN(Number(entry.weightKg))) return null;
  return Number(entry.weightKg);
}

function formatKg(value) {
  const rounded = Math.round(value * 10) / 10;
  return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}

function totalLabel(plan) {
  const lines = quoteLines(plan);
  const priced = lines.filter((line) => line.price != null);
  if (!priced.length) return "合計 未設定";
  const sum = priced.reduce((acc, line) => acc + line.price * line.count, 0);
  const missing = priced.length !== lines.length;
  return `合計 ¥${sum.toLocaleString()}${missing ? "（未設定あり）" : ""}`;
}

function weightLabel(plan) {
  const lines = quoteLines(plan);
  const weighed = lines.filter((line) => line.weight != null);
  if (!weighed.length) return "重量合計 未設定";
  const sum = weighed.reduce((acc, line) => acc + line.weight * line.count, 0);
  const missing = weighed.length !== lines.length;
  return `重量合計 ${formatKg(sum)} kg${missing ? "（未設定あり）" : ""}`;
}

async function saveView() {
  if (mode !== "3d") await setMode("3d");
  const pose = view3d?.getPose();
  if (!pose) return;
  const id = uid();
  const index = store.get().views.length + 1;
  store.update((plan) => {
    plan.views.push({ id, name: `視点 ${index}`, pose });
  });
  renderSidebar();
}

async function restoreView(id) {
  const view = store.get().views.find((entry) => entry.id === id);
  if (!view) return;
  await setMode("3d");
  view3d?.setPose(view.pose);
  markViewMode(view.pose?.mode || "sky");
}

async function exportImage() {
  await setMode("3d");
  await new Promise((resolve) => {
    requestAnimationFrame(() => requestAnimationFrame(resolve));
  });
  const url = view3d?.capture();
  if (!url) return;
  downloadUrl(url, `${store.get().name || "plan"}.png`);
  store.update((plan) => {
    plan.settings.exported = true;
  });
  renderSidebar();
}

async function exportExcel() {
  const plan = store.get();
  const buffer = await writeWorkbook(planToBook(plan));
  const blob = new Blob([buffer], { type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" });
  const url = URL.createObjectURL(blob);
  downloadUrl(url, `${safeName(plan.name)}.xlsx`);
  URL.revokeObjectURL(url);
}

async function importExcel(file) {
  try {
    const tables = await readTables(await file.arrayBuffer());
    store.importPlans(bookToPlan(tables));
    renderSidebar();
    view2d.fit();
  } catch (error) {
    console.error(error);
  }
}

function safeName(name) {
  return String(name || "plan").replace(/[\\/:*?"<>|]/g, " ").trim().slice(0, 40) || "plan";
}

function downloadUrl(url, filename) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
}

function shrinkImage(file) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const max = 1400;
      const scale = Math.min(1, max / Math.max(image.width, image.height));
      const board = document.createElement("canvas");
      board.width = Math.max(1, Math.round(image.width * scale));
      board.height = Math.max(1, Math.round(image.height * scale));
      board.getContext("2d").drawImage(image, 0, 0, board.width, board.height);
      URL.revokeObjectURL(url);
      resolve({ href: board.toDataURL("image/jpeg", 0.72), aspect: board.width / board.height });
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error("image"));
    };
    image.src = url;
  });
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[ch]));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function createController() {
  const listeners = new Set();
  const state = { tab: "layout", tool: "select", catalogId: null, roomType: "実験室", roomColor: "#d5e4f2", selection: null, wallPick: null, powerSymbol: null, powerPrompt: null };
  function emit() {
    listeners.forEach((fn) => fn());
  }
  return {
    get tool() { return state.tool; },
    get tab() { return state.tab; },
    get powerSymbol() { return state.powerSymbol; },
    get powerPrompt() { return state.powerPrompt; },
    get catalogId() { return state.catalogId; },
    get roomType() { return state.roomType; },
    get roomColor() { return state.roomColor; },
    get selection() { return state.selection; },
    get wallPick() { return state.wallPick; },
    pickWall(pick) {
      state.wallPick = pick;
      emit();
    },
    setTab(tab) {
      state.tab = tab;
      state.powerPrompt = null;
      emit();
    },
    setPowerSymbol(id) {
      state.powerSymbol = id;
      state.tool = "power";
      state.powerPrompt = null;
      emit();
    },
    setPowerPrompt(id) {
      state.powerPrompt = id;
      emit();
    },
    setTool(tool) {
      state.tool = tool;
      if (tool !== "item") state.catalogId = null;
      emit();
    },
    setCatalog(id) {
      state.catalogId = id;
      state.tool = "item";
      emit();
    },
    setRoom(name, color) {
      state.roomType = name;
      state.roomColor = color;
      state.tool = "room";
      emit();
    },
    get openingPreset() { return state.openingPreset; },
    setOpening(preset) {
      state.openingPreset = preset;
      state.tool = "opening";
      state.catalogId = null;
      emit();
    },
    select(selection) {
      if (!selection?.ids?.length) state.selection = null;
      else state.selection = { kind: selection.kind, ids: [...selection.ids] };
      state.wallPick = null;
      emit();
    },
    subscribe(fn) {
      listeners.add(fn);
      return () => listeners.delete(fn);
    },
  };
}
