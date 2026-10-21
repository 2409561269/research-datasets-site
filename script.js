"use strict";

const PAGE_SIZE = 50;
const $ = (id) => document.getElementById(id);
const controls = [$("search"), $("dataset-filter"), $("folder-filter"), $("type-filter")];
let datasets = [];
let files = [];
let currentPage = 1;
let loading = false;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatSize(bytes) {
  if (bytes === null || bytes === undefined) return "大小未知";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB", "PiB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${Number(value.toFixed(2))} ${units[unit]}`;
}

function validateManifest(data) {
  if (!data || data.schemaVersion !== 1 || !Array.isArray(data.datasets)) throw new Error("Unsupported manifest");
  const datasetIds = new Set();
  const entries = [];
  for (const dataset of data.datasets) {
    if (!dataset || typeof dataset.id !== "string" || !dataset.id || datasetIds.has(dataset.id) || typeof dataset.name !== "string" || !dataset.name || !Array.isArray(dataset.files)) throw new Error("Invalid dataset");
    datasetIds.add(dataset.id);
    const ids = new Set();
    for (const file of dataset.files) {
      if (!file || typeof file.id !== "string" || !file.id || ids.has(file.id) || typeof file.name !== "string" || !file.name || typeof file.type !== "string" || !file.type || typeof file.folder !== "string" || typeof file.url !== "string") throw new Error("Invalid file entry");
      ids.add(file.id);
      if (file.sizeBytes !== null && (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0)) throw new Error("Invalid file size");
      if (file.description !== undefined && typeof file.description !== "string") throw new Error("Invalid description");
      const url = new URL(file.url);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("Download URL must be public HTTPS");
      if ([...url.searchParams.keys()].some((key) => /signature|token|q-sign|x-cos-security|x-amz-/i.test(key))) throw new Error("Temporary signed URLs are not supported");
      entries.push({ ...file, datasetId: dataset.id, datasetName: dataset.name, type: file.type.toUpperCase() });
    }
  }
  return entries;
}

function setOptions(select, options, placeholder, selected = "") {
  select.replaceChildren(new Option(placeholder, ""));
  for (const [value, label] of options) select.add(new Option(label, value));
  select.value = options.some(([value]) => value === selected) ? selected : "";
}

function refreshFolders() {
  const datasetId = $("dataset-filter").value;
  const folders = [...new Set(files.filter((file) => !datasetId || file.datasetId === datasetId).map((file) => file.folder))].sort();
  setOptions($("folder-filter"), folders.map((folder) => [`folder:${folder}`, folder || "根目录"]), "全部文件夹", $("folder-filter").value);
}

function makeRow(file) {
  const row = element("tr");
  const nameCell = element("td");
  const title = element("div", "file-title");
  const icon = element("span", "file-icon", file.type);
  icon.setAttribute("aria-hidden", "true");
  const meta = element("div", "file-meta");
  meta.append(element("span", "file-name", file.name));
  meta.append(element("span", "file-path", `${file.datasetName} / ${file.folder || "根目录"}`));
  if (file.description) meta.append(element("p", "file-description", file.description));
  title.append(icon, meta);
  nameCell.append(title);
  const typeCell = element("td");
  typeCell.append(element("span", "type-badge", file.type));
  const sizeCell = element("td", "file-size", formatSize(file.sizeBytes));
  if (file.sizeBytes !== null) sizeCell.title = `${file.sizeBytes.toLocaleString("zh-CN")} 字节`;
  const actionCell = element("td");
  const link = element("a", "download-button");
  link.href = file.url;
  link.download = file.name;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.referrerPolicy = "no-referrer";
  link.setAttribute("aria-label", `下载 ${file.name}`);
  // This SVG is fixed application markup. Manifest content is rendered with textContent.
  link.innerHTML = '<svg aria-hidden="true" viewBox="0 0 20 20"><path d="M10 2v10m-4-4 4 4 4-4M3 13v4h14v-4"/></svg>';
  link.append(document.createTextNode("下载"));
  actionCell.append(link);
  row.append(nameCell, typeCell, sizeCell, actionCell);
  return row;
}

function render() {
  const query = $("search").value.trim().toLocaleLowerCase();
  const datasetId = $("dataset-filter").value;
  const folder = $("folder-filter").value;
  const type = $("type-filter").value;
  const matches = files.filter((file) => (!datasetId || file.datasetId === datasetId) && (!folder || `folder:${file.folder}` === folder) && (!type || file.type === type) && (!query || `${file.name} ${file.folder} ${file.datasetName} ${file.description || ""}`.toLocaleLowerCase().includes(query)));
  const pageCount = Math.max(1, Math.ceil(matches.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, pageCount);
  const fragment = document.createDocumentFragment();
  for (const file of matches.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)) fragment.append(makeRow(file));
  $("file-list").replaceChildren(fragment);
  $("results-count").textContent = `显示 ${matches.length.toLocaleString("zh-CN")} 个文件 / 共 ${files.length.toLocaleString("zh-CN")} 个`;
  $("table-wrap").hidden = matches.length === 0;
  $("empty-state").hidden = matches.length !== 0;
  $("clear-filters").hidden = !query && !datasetId && !folder && !type;
  $("pagination").hidden = pageCount <= 1;
  $("page-info").textContent = `第 ${currentPage} / ${pageCount} 页`;
  $("previous-page").disabled = currentPage <= 1;
  $("next-page").disabled = currentPage >= pageCount;
}

async function loadManifest() {
  if (loading) return;
  loading = true;
  controls.forEach((control) => { control.disabled = true; });
  $("load-error").hidden = true;
  $("table-wrap").hidden = true;
  $("empty-state").hidden = true;
  $("pagination").hidden = true;
  $("results-count").textContent = "正在加载文件清单…";
  try {
    const response = await fetch("./datasets.json", { cache: "no-cache", signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`);
    const data = await response.json();
    files = validateManifest(data);
    datasets = data.datasets;
    setOptions($("dataset-filter"), datasets.map((dataset) => [dataset.id, dataset.name]), "全部数据集");
    refreshFolders();
    setOptions($("type-filter"), [...new Set(files.map((file) => file.type))].sort().map((type) => [type, type]), "全部类型");
    $("dataset-count").textContent = datasets.length.toLocaleString("zh-CN");
    $("file-count").textContent = files.length.toLocaleString("zh-CN");
    const known = files.filter((file) => file.sizeBytes !== null);
    $("total-size").textContent = known.length ? formatSize(known.reduce((sum, file) => sum + file.sizeBytes, 0)) : "未知";
    $("size-caption").textContent = known.length === files.length ? "文件总大小" : "已知文件大小（部分）";
    controls.forEach((control) => { control.disabled = false; });
    currentPage = 1;
    render();
  } catch (error) {
    $("load-error").hidden = false;
    $("results-count").textContent = "文件清单加载失败";
    console.error("Dataset manifest could not be loaded:", error.message);
  } finally {
    loading = false;
  }
}

$("search").addEventListener("input", () => { currentPage = 1; render(); });
$("dataset-filter").addEventListener("change", () => { refreshFolders(); currentPage = 1; render(); });
for (const id of ["folder-filter", "type-filter"]) $(id).addEventListener("change", () => { currentPage = 1; render(); });
$("clear-filters").addEventListener("click", () => { controls.forEach((control) => { control.value = ""; }); refreshFolders(); currentPage = 1; render(); $("search").focus(); });
$("previous-page").addEventListener("click", () => { currentPage -= 1; render(); });
$("next-page").addEventListener("click", () => { currentPage += 1; render(); });
$("retry").addEventListener("click", loadManifest);
loadManifest();
