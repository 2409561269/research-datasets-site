"use strict";

const PAGE_SIZE = 100;
const $ = (id) => document.getElementById(id);
const collator = new Intl.Collator("zh-CN", { numeric: true });
let datasets = [];
let currentPage = 1;
let loading = false;
let loaded = false;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function formatSize(bytes) {
  if (bytes === null) return "未知";
  if (bytes < 1024) return `${bytes} B`;
  const units = ["KiB", "MiB", "GiB", "TiB", "PiB"];
  let value = bytes / 1024;
  let unit = 0;
  while (value >= 1024 && unit < units.length - 1) { value /= 1024; unit += 1; }
  return `${Number(value.toFixed(2))} ${units[unit]}`;
}

function validName(name) {
  return typeof name === "string" && name.length > 0 && name !== "." && name !== ".." && !/[\\/\u0000-\u001f]/.test(name);
}

function readManifest(data) {
  if (!data || data.schemaVersion !== 1 || !Array.isArray(data.datasets)) throw new Error("Unsupported manifest");
  const ids = new Set();
  return data.datasets.map((dataset) => {
    if (!dataset || !validName(dataset.id) || ids.has(dataset.id) || !validName(dataset.name) || !Array.isArray(dataset.files)) throw new Error("Invalid dataset");
    ids.add(dataset.id);
    const directories = new Map([["", { folders: new Map(), files: [] }]]);
    const fileIds = new Set();
    const paths = new Set();
    for (const file of dataset.files) {
      if (!file || typeof file.id !== "string" || !file.id || fileIds.has(file.id) || !validName(file.name) || typeof file.folder !== "string" || typeof file.url !== "string") throw new Error("Invalid file");
      if (file.sizeBytes !== null && (!Number.isSafeInteger(file.sizeBytes) || file.sizeBytes < 0)) throw new Error("Invalid file size");
      const parts = file.folder ? file.folder.split("/") : [];
      if (!parts.every(validName)) throw new Error("Invalid folder path");
      const path = [...parts, file.name].join("/");
      if (paths.has(path)) throw new Error("Duplicate file path");
      paths.add(path);
      fileIds.add(file.id);
      const url = new URL(file.url);
      if (url.protocol !== "https:" || url.username || url.password) throw new Error("Download URL must be public HTTPS");
      if ([...url.searchParams.keys()].some((key) => /signature|token|q-sign|x-cos-security|x-amz-/i.test(key))) throw new Error("Temporary signed URLs are not supported");
      let parent = "";
      for (const part of parts) {
        const child = parent ? `${parent}/${part}` : part;
        directories.get(parent).folders.set(part, child);
        if (!directories.has(child)) directories.set(child, { folders: new Map(), files: [] });
        parent = child;
      }
      directories.get(parent).files.push(file);
    }
    for (const [path, directory] of directories) {
      if (path && paths.has(path)) throw new Error("Conflicting file and folder path");
      directory.files.sort((a, b) => collator.compare(a.name, b.name));
    }
    return { id: dataset.id, name: dataset.name, directories };
  }).sort((a, b) => collator.compare(a.name, b.name));
}

function route(dataset, path = "") {
  return dataset ? `#/${[dataset.id, ...(path ? path.split("/") : [])].map(encodeURIComponent).join("/")}` : "#/";
}

function currentDirectory() {
  if (!location.hash || location.hash === "#/" || location.hash === "#") return { dataset: null, path: "" };
  try {
    if (!location.hash.startsWith("#/")) return null;
    const parts = location.hash.slice(2).split("/").map(decodeURIComponent);
    if (!parts.every(validName)) return null;
    const dataset = datasets.find((item) => item.id === parts[0]);
    const path = parts.slice(1).join("/");
    return dataset && dataset.directories.has(path) ? { dataset, path } : null;
  } catch { return null; }
}

function folderLink(name, href, parent = false) {
  const link = element("a", parent ? "parent-link" : "folder-link");
  link.href = href;
  if (!parent) {
    // Fixed icon markup; all names from the manifest are rendered as text.
    link.innerHTML = '<svg class="folder-icon" aria-hidden="true" viewBox="0 0 24 20"><path d="M2 3h7l3 3h10v12H2Z" stroke-linejoin="round"/></svg>';
  }
  link.append(element("span", "", name));
  return link;
}

function renderBreadcrumbs(dataset, path) {
  const nav = $("breadcrumbs");
  nav.replaceChildren();
  nav.hidden = !dataset;
  if (!dataset) return;
  const home = element("a", "", "目录首页");
  home.href = route(null);
  nav.append(home);
  const parts = path ? path.split("/") : [];
  for (const [index, name] of [dataset.name, ...parts].entries()) {
    const separator = element("span", "separator", "/");
    separator.setAttribute("aria-hidden", "true");
    nav.append(separator);
    const crumb = element(index === parts.length ? "span" : "a", "", name);
    if (index === parts.length) crumb.setAttribute("aria-current", "page");
    else crumb.href = route(dataset, parts.slice(0, index).join("/"));
    nav.append(crumb);
  }
}

function folderRow(name, href, parent = false) {
  const row = element("tr", parent ? "parent-row" : "folder-row");
  const nameCell = element("td");
  nameCell.append(folderLink(name, href, parent));
  row.append(nameCell, element("td", "size", "—"), element("td", "action"));
  return row;
}

function fileRow(file) {
  const row = element("tr", "file-row");
  const size = element("td", "size", formatSize(file.sizeBytes));
  if (file.sizeBytes !== null) size.title = `${file.sizeBytes.toLocaleString("zh-CN")} 字节`;
  const action = element("td", "action");
  const link = element("a", "download-link", "下载");
  link.href = file.url;
  link.download = file.name;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.referrerPolicy = "no-referrer";
  link.setAttribute("aria-label", `下载 ${file.name}`);
  action.append(link);
  row.append(element("td", "file-name", file.name), size, action);
  return row;
}

function render() {
  const current = currentDirectory();
  const { dataset, path } = current || { dataset: null, path: "" };
  renderBreadcrumbs(dataset, path);
  const entries = [];
  if (dataset) {
    const directory = dataset.directories.get(path);
    for (const [name, child] of [...directory.folders].sort((a, b) => collator.compare(a[0], b[0]))) entries.push({ name, href: route(dataset, child) });
    for (const file of directory.files) entries.push({ file });
  } else {
    for (const item of datasets) entries.push({ name: item.name, href: route(item) });
  }
  const pageCount = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, pageCount);
  const fragment = document.createDocumentFragment();
  if (dataset) {
    const parent = path ? route(dataset, path.split("/").slice(0, -1).join("/")) : route(null);
    fragment.append(folderRow(".. 返回上级", parent, true));
  }
  for (const entry of entries.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)) fragment.append(entry.file ? fileRow(entry.file) : folderRow(entry.name, entry.href));
  $("file-list").replaceChildren(fragment);
  $("table-wrap").hidden = false;
  $("status").textContent = !current ? "该目录不存在，请从目录首页重新进入。" : entries.length ? "" : "此目录为空。";
  $("pagination").hidden = pageCount <= 1;
  $("page-info").textContent = `第 ${currentPage} / ${pageCount} 页`;
  $("previous-page").disabled = currentPage <= 1;
  $("next-page").disabled = currentPage >= pageCount;
}

async function loadManifest() {
  if (loading) return;
  loading = true;
  $("retry").disabled = true;
  $("load-error").hidden = true;
  $("status").textContent = "正在加载目录…";
  try {
    const response = await fetch("./datasets.json", { cache: "no-cache", signal: AbortSignal.timeout(20000) });
    if (!response.ok) throw new Error(`Manifest HTTP ${response.status}`);
    datasets = readManifest(await response.json());
    loaded = true;
    render();
  } catch (error) {
    $("load-error").hidden = false;
    $("status").textContent = "";
    console.error("Dataset directory could not be loaded:", error.message);
  } finally {
    loading = false;
    $("retry").disabled = false;
  }
}

window.addEventListener("hashchange", () => { currentPage = 1; if (loaded) render(); });
$("previous-page").addEventListener("click", () => { currentPage -= 1; render(); });
$("next-page").addEventListener("click", () => { currentPage += 1; render(); });
$("retry").addEventListener("click", loadManifest);
loadManifest();
