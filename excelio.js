import { POWER_HEADERS } from "./power.js?v=20261026d";
import {
  DRAWING_HEADERS,
  EQUIPMENT_HEADERS,
  LAYOUT_HEADERS,
  LIST_COLUMNS,
  SHEET,
} from "./schema.js";

export async function writeWorkbook(book) {
  const ExcelJS = lib();
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "NEOSUPO★STAR β5";
  writePairs(workbook, SHEET.PROJECT, book.projectPairs);
  writeObjects(workbook, SHEET.EQUIPMENT, EQUIPMENT_HEADERS, book.equipment);
  writeObjects(workbook, SHEET.LAYOUT, LAYOUT_HEADERS, book.layout);
  writeRows(workbook, SHEET.DRAWINGS, DRAWING_HEADERS, book.drawings);
  writePairs(workbook, SHEET.SETTINGS, book.settingsPairs);
  writeGrid(workbook, SHEET.CANVAS, book.grid);
  writeObjects(workbook, SHEET.POWER, POWER_HEADERS, book.power);
  writeList(workbook, book.equipment);
  const buffer = await workbook.xlsx.writeBuffer();
  return injectShapes(buffer, [
    { name: SHEET.CANVAS, grid: book.grid },
  ]);
}

export async function readTables(buffer) {
  const ExcelJS = lib();
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  const equipment = readObjects(workbook.getWorksheet(SHEET.EQUIPMENT));
  return {
    projectPairs: readPairs(workbook.getWorksheet(SHEET.PROJECT)),
    settingsPairs: readPairs(workbook.getWorksheet(SHEET.SETTINGS)),
    equipment: equipment.length ? equipment : readList(workbook.getWorksheet(SHEET.LIST)),
    layout: readObjects(workbook.getWorksheet(SHEET.LAYOUT)),
    drawings: readObjects(workbook.getWorksheet(SHEET.DRAWINGS)),
    power: readObjects(workbook.getWorksheet(SHEET.POWER)),
  };
}

function writePairs(workbook, name, pairs) {
  const sheet = workbook.addWorksheet(name);
  sheet.addRow(["key", "value"]);
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  sheet.getColumn(1).width = 28;
  sheet.getColumn(2).width = 48;
  for (const pair of pairs || []) sheet.addRow(pair);
}

function writeObjects(workbook, name, headers, rows) {
  writeRows(workbook, name, headers, (rows || []).map((row) => headers.map((header) => row[header] ?? "")));
}

function writeRows(workbook, name, headers, rows) {
  const sheet = workbook.addWorksheet(name);
  sheet.addRow(headers);
  sheet.getRow(1).font = { bold: true };
  sheet.views = [{ state: "frozen", ySplit: 1 }];
  headers.forEach((header, index) => {
    sheet.getColumn(index + 1).width = Math.min(28, Math.max(12, String(header).length + 2));
  });
  for (const row of rows || []) sheet.addRow(row);
}

const GRID_ROW_PT = 15.5;
const GRID_COL_WIDTH = 2.81640625;

function writeGrid(workbook, name, grid) {
  const sheet = workbook.addWorksheet(name);
  sheet.views = [{ workbookViewId: 0, zoomScale: 100, zoomScaleNormal: 100, showGridLines: true }];
  sheet.properties.defaultRowHeight = GRID_ROW_PT;
  sheet.properties.dyDescent = 0.25;
  const cm = Math.round((grid?.cellMm || 100) / 10);
  sheet.getCell(1, 2).value = `1セル＝${cm}cm×${cm}cm`;
  sheet.getRow(1).height = GRID_ROW_PT;
  sheet.getColumn(1).width = 3;
  const cols = grid?.cols || 0;
  const rows = grid?.rows || 0;
  for (let c = 0; c < cols; c += 1) sheet.getColumn(c + 2).width = GRID_COL_WIDTH;
  for (let r = 0; r < rows; r += 1) sheet.getRow(r + 2).height = GRID_ROW_PT;
  for (const cell of grid?.cells || []) {
    const target = sheet.getCell(cell.r + 2, cell.c + 2);
    if (cell.text) {
      target.value = cell.text;
      target.alignment = {
        vertical: "middle",
        horizontal: "center",
        wrapText: false,
        shrinkToFit: true,
        textRotation: cell.rotation || 0,
      };
      target.font = { size: 9, name: "游ゴシック" };
    }
    target.fill = { type: "pattern", pattern: "solid", fgColor: { argb: cell.argb } };
  }
  for (const cell of grid?.cells || []) {
    if (cell.mergeC == null || cell.mergeR == null) continue;
    sheet.mergeCells(cell.r + 2, cell.c + 2, cell.mergeR + 2, cell.mergeC + 2);
  }
  for (let r = 0; r < rows; r += 1) sheet.getRow(r + 2).height = GRID_ROW_PT;
}

function writeList(workbook, equipment) {
  const sheet = workbook.addWorksheet(SHEET.LIST);
  sheet.getCell(1, 1).value = "機器リスト";
  const headers = {
    1: "id",
    2: "機器名称",
    3: "メーカー",
    4: "型式",
    5: "数量",
    6: "W_mm",
    7: "D_mm",
    8: "H_mm",
    9: "重量_kg",
    10: "電気",
    20: "給水",
    22: "排水",
    26: "給気",
    28: "排気",
    30: "特ガス",
    32: "備考",
  };
  for (const [col, label] of Object.entries(headers)) {
    const cell = sheet.getCell(5, Number(col));
    cell.value = label;
    cell.font = { bold: true };
  }
  (equipment || []).filter((row) => Number(row["数量"]) > 0).forEach((row, index) => {
    const r = 6 + index;
    const put = (col, value) => {
      sheet.getCell(r, col).value = value ?? "";
    };
    put(LIST_COLUMNS.id, row.id);
    put(LIST_COLUMNS.name, row["機器名称"]);
    put(LIST_COLUMNS.maker, row["メーカー"]);
    put(LIST_COLUMNS.model, row["型式"]);
    put(LIST_COLUMNS.qty, row["数量"]);
    put(LIST_COLUMNS.w, row.W_mm);
    put(LIST_COLUMNS.d, row.D_mm);
    put(LIST_COLUMNS.h, row.H_mm);
    put(LIST_COLUMNS.weight, row["重量_kg"]);
    put(LIST_COLUMNS.power, row["電気"]);
    put(LIST_COLUMNS.water, row["給水"]);
    put(LIST_COLUMNS.drain, row["排水"]);
    put(LIST_COLUMNS.supplyAir, row["給気"]);
    put(LIST_COLUMNS.exhaust, row["排気"]);
    put(LIST_COLUMNS.gas, row["特ガス"]);
    put(LIST_COLUMNS.note, row["備考"]);
  });
}

function readPairs(sheet) {
  const pairs = [];
  if (!sheet) return pairs;
  sheet.eachRow((row, index) => {
    if (index === 1) return;
    const key = cellText(row.getCell(1).value);
    if (!key || key === "key") return;
    pairs.push([String(key), cellText(row.getCell(2).value)]);
  });
  return pairs;
}

function readObjects(sheet) {
  if (!sheet) return [];
  let headers = [];
  const rows = [];
  sheet.eachRow((row, index) => {
    if (index === 1) {
      headers = (row.values || []).slice(1).map((value) => String(cellText(value) || ""));
      return;
    }
    const obj = {};
    let any = false;
    headers.forEach((header, i) => {
      if (!header) return;
      const value = cellText(row.getCell(i + 1).value);
      obj[header] = value;
      if (value !== "" && value != null) any = true;
    });
    if (any) rows.push(obj);
  });
  return rows;
}

function readList(sheet) {
  if (!sheet) return [];
  const rows = [];
  sheet.eachRow((row, index) => {
    if (index < 6) return;
    const name = cellText(row.getCell(LIST_COLUMNS.name).value);
    const id = cellText(row.getCell(LIST_COLUMNS.id).value);
    if ((!name && !id) || name === "機器名称") return;
    rows.push({
      id: String(id || ""),
      区分: "中型",
      "床置or卓上": "床置",
      機器名称: String(name || ""),
      メーカー: String(cellText(row.getCell(LIST_COLUMNS.maker).value) || ""),
      型式: String(cellText(row.getCell(LIST_COLUMNS.model).value) || ""),
      数量: cellText(row.getCell(LIST_COLUMNS.qty).value) || 1,
      W_mm: cellText(row.getCell(LIST_COLUMNS.w).value),
      D_mm: cellText(row.getCell(LIST_COLUMNS.d).value),
      H_mm: cellText(row.getCell(LIST_COLUMNS.h).value),
      重量_kg: cellText(row.getCell(LIST_COLUMNS.weight).value),
      電気: String(cellText(row.getCell(LIST_COLUMNS.power).value) || ""),
      給水: String(cellText(row.getCell(LIST_COLUMNS.water).value) || ""),
      排水: String(cellText(row.getCell(LIST_COLUMNS.drain).value) || ""),
      給気: String(cellText(row.getCell(LIST_COLUMNS.supplyAir).value) || ""),
      排気: String(cellText(row.getCell(LIST_COLUMNS.exhaust).value) || ""),
      特ガス: String(cellText(row.getCell(LIST_COLUMNS.gas).value) || ""),
      備考: String(cellText(row.getCell(LIST_COLUMNS.note).value) || ""),
      iso_drive_id: "",
      family: "機器",
    });
  });
  return rows;
}

function cellText(value) {
  if (value == null) return "";
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (typeof value === "object") {
    if (Array.isArray(value.richText)) return value.richText.map((part) => part.text).join("");
    if (value.text != null) return String(value.text);
    if (Object.prototype.hasOwnProperty.call(value, "result")) return cellText(value.result);
    return "";
  }
  return value;
}

function lib() {
  const ExcelJS = globalThis.ExcelJS;
  if (!ExcelJS?.Workbook) throw new Error("ExcelJS が読み込まれていません");
  return ExcelJS;
}

const CELL_EMU = Math.round(15.5 * 12700);

async function injectShapes(buffer, sheets) {
  const wanted = sheets.filter((sheet) => sheet.grid?.shapes?.length);
  if (!wanted.length) return buffer;
  const JSZip = await loadZip();
  const zip = await JSZip.loadAsync(buffer);
  const workbookXml = await zip.file("xl/workbook.xml").async("string");
  const relsXml = await zip.file("xl/_rels/workbook.xml.rels").async("string");
  const map = sheetMap(workbookXml, relsXml);
  const overrides = [];
  let drawingIndex = 1;
  for (const spec of wanted) {
    const found = map.find((sheet) => sheet.name === spec.name);
    if (!found?.target) continue;
    const sheetPath = found.target.startsWith("xl/") ? found.target : `xl/${found.target}`;
    const drawingFile = `drawing${drawingIndex}.xml`;
    const relPath = sheetPath.replace(/([^/]+)$/, "_rels/$1.rels");
    let sheetXml = await zip.file(sheetPath).async("string");
    let rels = zip.file(relPath)
      ? await zip.file(relPath).async("string")
      : `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>`;
    const rid = "rIdShape1";
    if (!rels.includes("/drawing")) {
      rels = rels.replace("</Relationships>", `<Relationship Id="${rid}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/drawing" Target="../drawings/${drawingFile}"/></Relationships>`);
      zip.file(relPath, rels);
    }
    if (!sheetXml.includes("<drawing ")) {
      sheetXml = sheetXml.replace("</worksheet>", `<drawing r:id="${rid}"/></worksheet>`);
      zip.file(sheetPath, sheetXml);
    }
    zip.file(`xl/drawings/${drawingFile}`, drawingXml(spec.grid));
    overrides.push(`/xl/drawings/${drawingFile}`);
    drawingIndex += 1;
  }
  if (overrides.length) {
    let types = await zip.file("[Content_Types].xml").async("string");
    for (const part of overrides) {
      if (!types.includes(part)) {
        types = types.replace("</Types>", `<Override PartName="${part}" ContentType="application/vnd.openxmlformats-officedocument.drawing+xml"/></Types>`);
      }
    }
    zip.file("[Content_Types].xml", types);
  }
  return zip.generateAsync({ type: "arraybuffer" });
}

function sheetMap(workbookXml, relsXml) {
  const rels = {};
  for (const tag of relsXml.match(/<Relationship\b[^>]*\/>/g) || []) {
    rels[/Id="([^"]+)"/.exec(tag)?.[1]] = /Target="([^"]+)"/.exec(tag)?.[1];
  }
  return [...(workbookXml.match(/<sheet\b[^>]*\/>/g) || [])].map((tag) => {
    const id = /r:id="([^"]+)"/.exec(tag)?.[1];
    return { name: decodeXml(/name="([^"]+)"/.exec(tag)?.[1] || ""), target: rels[id] };
  });
}

function drawingXml(grid) {
  const body = grid.shapes.map((shape, index) => shapeXml(grid, shape, index + 2)).join("");
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<xdr:wsDr xmlns:xdr="http://schemas.openxmlformats.org/drawingml/2006/spreadsheetDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main">${body}</xdr:wsDr>`;
}

function shapeXml(grid, shape, id) {
  if (shape.kind === "path") return pathXml(grid, shape, id);
  const rot = ((Number(shape.rot) || 0) % 360 + 360) % 360;
  if (rot) return rotatedRectXml(grid, shape, id, rot);
  const x0 = shape.x - shape.w / 2;
  const y0 = shape.y - shape.d / 2;
  const from = anchorOf(grid, x0, y0);
  const to = anchorOf(grid, x0 + shape.w, y0 + shape.d);
  const cx = Math.max(1, Math.round((shape.w / grid.cellMm) * CELL_EMU));
  const cy = Math.max(1, Math.round((shape.d / grid.cellMm) * CELL_EMU));
  const fill = hexColor(shape.fill);
  const text = shapeText(shape, 0);
  return `<xdr:twoCellAnchor editAs="oneCell"><xdr:from>${anchorInner(from)}</xdr:from><xdr:to>${anchorInner(to)}</xdr:to><xdr:sp><xdr:nvSpPr><xdr:cNvPr id="${id}" name="shape${id}"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill><a:ln w="6350"><a:solidFill><a:srgbClr val="666666"/></a:solidFill></a:ln></xdr:spPr>${text}</xdr:sp><xdr:clientData/></xdr:twoCellAnchor>`;
}

function rotatedRectXml(grid, shape, id, rot) {
  const corners = rotatedCorners(shape);
  const minX = Math.min(...corners.map((point) => point.x));
  const minY = Math.min(...corners.map((point) => point.y));
  const maxX = Math.max(...corners.map((point) => point.x));
  const maxY = Math.max(...corners.map((point) => point.y));
  const w = Math.max(grid.cellMm * 0.2, maxX - minX);
  const d = Math.max(grid.cellMm * 0.2, maxY - minY);
  const from = anchorOf(grid, minX, minY);
  const to = anchorOf(grid, minX + w, minY + d);
  const cx = Math.max(1, Math.round((w / grid.cellMm) * CELL_EMU));
  const cy = Math.max(1, Math.round((d / grid.cellMm) * CELL_EMU));
  const path = corners.map((point, index) => {
    const x = Math.round(((point.x - minX) / w) * cx);
    const y = Math.round(((point.y - minY) / d) * cy);
    const tag = index === 0 ? "moveTo" : "lnTo";
    return `<a:${tag}><a:pt x="${x}" y="${y}"/></a:${tag}>`;
  }).join("") + "<a:close/>";
  const fill = hexColor(shape.fill);
  return `<xdr:twoCellAnchor editAs="oneCell"><xdr:from>${anchorInner(from)}</xdr:from><xdr:to>${anchorInner(to)}</xdr:to><xdr:sp><xdr:nvSpPr><xdr:cNvPr id="${id}" name="shape${id}"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="l" t="t" r="r" b="b"/><a:pathLst><a:path w="${cx}" h="${cy}">${path}</a:path></a:pathLst></a:custGeom><a:solidFill><a:srgbClr val="${fill}"/></a:solidFill><a:ln w="6350"><a:solidFill><a:srgbClr val="666666"/></a:solidFill></a:ln></xdr:spPr>${shapeText(shape, rot)}</xdr:sp><xdr:clientData/></xdr:twoCellAnchor>`;
}

function rotatedCorners(shape) {
  const theta = ((Number(shape.rot) || 0) * Math.PI) / 180;
  const cos = Math.cos(theta);
  const sin = Math.sin(theta);
  const hw = shape.w / 2;
  const hd = shape.d / 2;
  return [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([lx, ly]) => ({
    x: shape.x + lx * cos - ly * sin,
    y: shape.y + lx * sin + ly * cos,
  }));
}

function shapeText(shape, rot) {
  const textRot = Math.round((Number(rot) || 0) * 60000);
  if (!shape.text) return `<xdr:txBody><a:bodyPr rot="${textRot}"/><a:lstStyle/><a:p><a:endParaRPr lang="ja-JP"/></a:p></xdr:txBody>`;
  return `<xdr:txBody><a:bodyPr wrap="square" lIns="0" tIns="0" rIns="0" bIns="0" anchor="ctr" rot="${textRot}"/><a:lstStyle/><a:p><a:pPr algn="ctr"/><a:r><a:rPr lang="ja-JP" sz="800" dirty="0"/><a:t>${escapeXml(shape.text)}</a:t></a:r></a:p></xdr:txBody>`;
}

function pathXml(grid, shape, id) {
  const points = shape.points || [];
  const minX = Math.min(...points.map((point) => point.x));
  const minY = Math.min(...points.map((point) => point.y));
  const maxX = Math.max(...points.map((point) => point.x));
  const maxY = Math.max(...points.map((point) => point.y));
  const w = Math.max(grid.cellMm * 0.2, maxX - minX);
  const d = Math.max(grid.cellMm * 0.2, maxY - minY);
  const from = anchorOf(grid, minX, minY);
  const to = anchorOf(grid, minX + w, minY + d);
  const cx = Math.max(1, Math.round((w / grid.cellMm) * CELL_EMU));
  const cy = Math.max(1, Math.round((d / grid.cellMm) * CELL_EMU));
  let path = "";
  for (const point of points) {
    const x = Math.round(((point.x - minX) / w) * cx);
    const y = Math.round(((point.y - minY) / d) * cy);
    path += point.jump || !path ? `<a:moveTo><a:pt x="${x}" y="${y}"/></a:moveTo>` : `<a:lnTo><a:pt x="${x}" y="${y}"/></a:lnTo>`;
  }
  const stroke = hexColor(shape.stroke || "#8a5a32");
  return `<xdr:twoCellAnchor editAs="oneCell"><xdr:from>${anchorInner(from)}</xdr:from><xdr:to>${anchorInner(to)}</xdr:to><xdr:sp><xdr:nvSpPr><xdr:cNvPr id="${id}" name="path${id}"/><xdr:cNvSpPr/></xdr:nvSpPr><xdr:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:custGeom><a:avLst/><a:gdLst/><a:ahLst/><a:cxnLst/><a:rect l="l" t="t" r="r" b="b"/><a:pathLst><a:path w="${cx}" h="${cy}">${path}</a:path></a:pathLst></a:custGeom><a:noFill/><a:ln w="12700"><a:solidFill><a:srgbClr val="${stroke}"/></a:solidFill></a:ln></xdr:spPr><xdr:txBody><a:bodyPr/><a:lstStyle/><a:p><a:endParaRPr lang="ja-JP"/></a:p></xdr:txBody></xdr:sp><xdr:clientData/></xdr:twoCellAnchor>`;
}

function anchorOf(grid, x, y) {
  const col = 1 + (x - grid.originX) / grid.cellMm;
  const row = 1 + (y - grid.originY) / grid.cellMm;
  const c = Math.max(0, Math.floor(col));
  const r = Math.max(0, Math.floor(row));
  return {
    col: c,
    row: r,
    colOff: Math.max(0, Math.round((col - Math.floor(col)) * CELL_EMU)),
    rowOff: Math.max(0, Math.round((row - Math.floor(row)) * CELL_EMU)),
  };
}

function anchorInner(pos) {
  return `<xdr:col>${pos.col}</xdr:col><xdr:colOff>${pos.colOff}</xdr:colOff><xdr:row>${pos.row}</xdr:row><xdr:rowOff>${pos.rowOff}</xdr:rowOff>`;
}

function hexColor(value) {
  const text = String(value || "#cccccc").replace("#", "");
  return text.length === 3 ? text.split("").map((ch) => ch + ch).join("") : text.slice(0, 6).toUpperCase();
}

function escapeXml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[ch]);
}

function decodeXml(value) {
  return String(value).replace(/&amp;/g, "&").replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'");
}

async function loadZip() {
  if (globalThis.JSZip) return globalThis.JSZip;
  const { createRequire } = await import("node:module");
  return createRequire(import.meta.url)("jszip");
}
