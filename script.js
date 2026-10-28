"use strict";

const PAGE_SIZE = 100;
const $ = (id) => document.getElementById(id);
const collator = new Intl.Collator("zh-CN", { numeric: true });
let datasets = [];
let currentPage = 1;
let loading = false;
let loaded = false;
let staticManifest = null;
let rdLoading = false;
let taskObjectURLs = [];

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

function validateDownloadURL(value) {
  if (typeof value !== "string") throw new Error("Invalid download URL");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password) throw new Error("Download URL must be public HTTPS");
  if ([...url.searchParams.keys()].some((key) => /signature|token|q-sign|x-cos-security|x-amz-/i.test(key))) throw new Error("Temporary signed URLs are not supported");
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
      validateDownloadURL(file.url);
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
    const archive = dataset.archive || null;
    if (archive) {
      if (!validName(archive.name) || !archive.name.endsWith(".zip") || !Number.isSafeInteger(archive.sizeBytes) || archive.sizeBytes <= 0 || archive.fileCount !== dataset.files.length || (archive.sha256 != null && !/^[a-f0-9]{64}$/.test(archive.sha256))) throw new Error("Invalid dataset archive");
      validateDownloadURL(archive.url);
    }
    if (dataset.notice !== undefined && typeof dataset.notice !== "string") throw new Error("Invalid dataset notice");
    if (dataset.rdCatalogUrl !== undefined) validateDownloadURL(dataset.rdCatalogUrl);
    if (archive?.label !== undefined && typeof archive.label !== "string") throw new Error("Invalid archive label");
    return { id: dataset.id, name: dataset.name, directories, archive, notice: dataset.notice || "", rdCatalogUrl: dataset.rdCatalogUrl || "", downloadRoot: dataset.downloadRoot || "", rd: null, rdError: false };
  }).sort((a, b) => collator.compare(a.name, b.name));
}

function ensureDirectory(dataset, path) {
  const parts = path ? path.split("/") : [];
  if (!parts.every(validName)) throw new Error("Invalid remote directory");
  let parent = "";
  for (const part of parts) {
    const child = parent ? `${parent}/${part}` : part;
    dataset.directories.get(parent).folders.set(part, child);
    if (!dataset.directories.has(child)) dataset.directories.set(child, { folders: new Map(), files: [] });
    parent = child;
  }
  return dataset.directories.get(parent);
}

function mergeRDCatalog(dataset, data) {
  if (!data || data.schemaVersion !== 1 || data.datasetId !== dataset.id || !Array.isArray(data.files) || !Array.isArray(data.sequences) || !data.totals) throw new Error("Invalid RD catalog");
  const totals = data.totals;
  if (![totals.plannedPackages, totals.publishedPackages].every((n) => Number.isSafeInteger(n) && n >= 0) || totals.publishedPackages !== data.files.length || totals.publishedPackages > totals.plannedPackages) throw new Error("Invalid RD counts");
  const origin = new URL(dataset.rdCatalogUrl).origin;
  const sequences = new Map();
  for (const sequence of data.sequences) {
    if (!/^seq_\d{8}_\d+$/.test(sequence.id) || sequences.has(sequence.id) || typeof sequence.path !== "string" || !sequence.path.split("/").every(validName) || sequence.downloadPath !== `${sequence.path}/L1_rd_map`) throw new Error("Invalid RD sequence");
    if (![sequence.totalPackages, sequence.publishedPackages].every((n) => Number.isSafeInteger(n) && n >= 0) || sequence.publishedPackages > sequence.totalPackages) throw new Error("Invalid RD sequence counts");
    sequences.set(sequence.id, sequence);
  }
  if ([...sequences.values()].reduce((sum, sequence) => sum + sequence.totalPackages, 0) !== totals.plannedPackages) throw new Error("Invalid planned package total");
  for (const file of data.files) {
    const sequence = sequences.get(file.sequence);
    const url = new URL(file.url);
    if (!sequence || file.folder !== sequence.downloadPath || file.kind !== "rd-package" || url.origin !== origin || !url.pathname.startsWith("/datasets/RadarUAV-FullChain/_rd_packages/") || url.search) throw new Error("Invalid RD package URL or directory");
  }
  const normalized = readManifest({ schemaVersion: 1, datasets: [{ id: dataset.id, name: dataset.name, files: data.files }] })[0];
  for (const sequence of sequences.values()) {
    if (data.files.filter((file) => file.sequence === sequence.id).length !== sequence.publishedPackages) throw new Error("Invalid published sequence count");
    ensureDirectory(dataset, sequence.downloadPath);
  }
  for (const [path, directory] of normalized.directories) {
    const target = ensureDirectory(dataset, path);
    for (const file of directory.files) {
      if (target.files.some((existing) => existing.name === file.name)) throw new Error("Duplicate RD package path");
      target.files.push(file);
    }
    target.files.sort((a, b) => collator.compare(a.name, b.name));
  }
  dataset.rd = data;
}

async function loadRDCatalogs(models) {
  await Promise.all(models.map(async (dataset) => {
    if (!dataset.rdCatalogUrl) return;
    try {
      const response = await fetch(dataset.rdCatalogUrl, { credentials: "omit", cache: "no-cache", signal: AbortSignal.timeout(20000) });
      if (!response.ok) throw new Error(`RD catalog HTTP ${response.status}`);
      mergeRDCatalog(dataset, await response.json());
    } catch (error) {
      const previous = datasets.find((item) => item.id === dataset.id && item.rd);
      if (previous) Object.assign(dataset, previous);
      dataset.rdError = true;
      console.warn("RD download catalog could not be updated:", error.message);
    }
  }));
}

async function refreshRDCatalogs() {
  if (!loaded || loading || rdLoading || document.hidden || !staticManifest) return;
  rdLoading = true;
  try {
    const models = readManifest(staticManifest);
    await loadRDCatalogs(models);
    datasets = models;
    render();
  } finally { rdLoading = false; }
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

function downloadLink(file, className, text, label) {
  const link = element("a", className, text);
  link.href = file.url;
  link.download = file.name;
  link.target = "_blank";
  link.rel = "noopener noreferrer";
  link.referrerPolicy = "no-referrer";
  link.setAttribute("aria-label", label);
  return link;
}

function folderRow(name, href, parent = false, archive = null, folderAction = null) {
  const row = element("tr", parent ? "parent-row" : "folder-row");
  const nameCell = element("td");
  nameCell.append(folderLink(name, href, parent));
  const size = element("td", "size", archive ? formatSize(archive.sizeBytes) : folderAction?.sizeBytes ? formatSize(folderAction.sizeBytes) : "—");
  const action = element("td", "action");
  if (archive) {
    size.title = `ZIP 压缩包大小：${archive.sizeBytes.toLocaleString("zh-CN")} 字节`;
    const label = archive.label || "整包下载";
    const link = downloadLink(archive, "archive-link", label, `${label} ${name}`);
    link.title = `ZIP · ${archive.fileCount} 个文件 · ${formatSize(archive.sizeBytes)}`;
    action.append(link);
  }
  if (folderAction) {
    const link = element("a", "folder-download-link", folderAction.label);
    link.href = folderAction.href;
    link.setAttribute("aria-label", `${folderAction.label} ${name}`);
    action.replaceChildren(link);
    size.title = "当前可下载的 RD 分包合计";
  }
  row.append(nameCell, size, action);
  return row;
}

function fileRow(file) {
  const row = element("tr", file.kind === "rd-package" ? "file-row rd-package-row" : "file-row");
  const size = element("td", "size", formatSize(file.sizeBytes));
  if (file.sizeBytes !== null) size.title = `${file.sizeBytes.toLocaleString("zh-CN")} 字节`;
  const action = element("td", "action");
  const link = downloadLink(file, "download-link", "下载", `下载 ${file.name}`);
  action.append(link);
  row.append(element("td", "file-name", file.name), size, action);
  return row;
}

function sequenceForPath(dataset, path) {
  return dataset?.rd?.sequences.find((sequence) => sequence.path === path || sequence.downloadPath === path);
}

function rdFolderAction(dataset, path) {
  const sequence = sequenceForPath(dataset, path);
  if (!sequence) return null;
  const sizeBytes = dataset.rd.files.filter((file) => file.sequence === sequence.id).reduce((sum, file) => sum + file.sizeBytes, 0);
  return { href: route(dataset, sequence.downloadPath), label: "RD 分包", sizeBytes };
}

function renderRDTools(dataset, path) {
  for (const url of taskObjectURLs) URL.revokeObjectURL(url);
  taskObjectURLs = [];
  const panel = $("rd-download-tools");
  panel.replaceChildren();
  const sequence = sequenceForPath(dataset, path);
  panel.hidden = !sequence;
  if (!sequence) return;
  panel.append(element("p", "", `本序列已发布 ${sequence.publishedPackages} / ${sequence.totalPackages} 个 RD 分包。每包约 4 GiB 以内，按原始编号范围组织，可独立解压。`));
  const files = dataset.rd.files.filter((file) => file.sequence === sequence.id);
  if (files.length) {
    const filename = `RD_${sequence.id}.aria2`;
    const tasks = files.map((file) => `${file.url}\n  out=${file.name}`).join("\n") + "\n";
    const urls = files.map((file) => file.url).join("\n") + "\n";
    const links = element("div", "batch-links");
    for (const [text, content, name] of [["批量下载本序列（aria2 清单）", tasks, filename], ["下载网址清单", urls, `RD_${sequence.id}_urls.txt`]]) {
      const href = URL.createObjectURL(new Blob([content], { type: "text/plain;charset=utf-8" }));
      taskObjectURLs.push(href);
      const link = element("a", "batch-download", text);
      link.href = href;
      link.download = name;
      links.append(link);
    }
    panel.append(links);
    const details = element("details");
    details.append(element("summary", "", "批量下载说明"), element("p", "", "已安装 aria2 时，将下载清单保存到目标文件夹，然后运行以下命令。清单仅包含已经发布的分包；后续分包上线后，可重新获取清单并续传。"), element("code", "", `aria2c -c -j 2 -x 4 -i "${filename}"`));
    panel.append(details);
  }
  for (const warning of dataset.rd.warnings || []) {
    if (warning.sequence === sequence.id) panel.append(element("p", "", `源数据说明：原始编号 ${warning.range[0]}–${warning.range[1]} 仅存在 ${warning.availableTypes.join("、")}，按实际文件提供。`));
  }
}

function render() {
  const current = currentDirectory();
  const { dataset, path } = current || { dataset: null, path: "" };
  renderBreadcrumbs(dataset, path);
  const notice = dataset ? dataset.notice : datasets.map((item) => item.notice).filter(Boolean).join(" ");
  $("dataset-notice").textContent = notice;
  $("dataset-notice").hidden = !notice;
  const rdDataset = dataset?.rdCatalogUrl ? dataset : !dataset ? datasets.find((item) => item.rdCatalogUrl) : null;
  const rdStatus = $("rd-status");
  rdStatus.hidden = !rdDataset;
  if (rdDataset) {
    const rd = rdDataset.rd;
    rdStatus.textContent = rd ? `RD 分包：已发布 ${rd.totals.publishedPackages} / ${rd.totals.plannedPackages} 包。${rd.message || (rd.status === "completed" ? "全部 RD 分包已上线。" : "分包陆续上线，已完成的可直接下载。")}` : "RD 下载目录暂时无法加载，请稍后刷新。";
    if (rdDataset.rdError && rd) rdStatus.textContent += " 当前显示上次获取的下载目录。";
  }
  const archiveDownload = $("archive-download");
  archiveDownload.replaceChildren();
  archiveDownload.hidden = !dataset?.archive;
  if (dataset?.archive) {
    const label = dataset.archive.label ? `下载 ${dataset.name} ${dataset.archive.label}` : dataset.notice ? `下载 ${dataset.name} 已发布文件` : `下载整个 ${dataset.name}`;
    archiveDownload.append(downloadLink(dataset.archive, "archive-link", `${label}（ZIP · ${formatSize(dataset.archive.sizeBytes)}）`, label));
  }
  renderRDTools(dataset, path);
  const entries = [];
  if (dataset) {
    const directory = dataset.directories.get(path);
    for (const [name, child] of [...directory.folders].sort((a, b) => collator.compare(a[0], b[0]))) entries.push({ name, href: route(dataset, child), folderAction: rdFolderAction(dataset, child) });
    for (const file of directory.files) entries.push({ file });
  } else {
    for (const item of datasets) entries.push({ name: item.name, href: route(item), archive: item.downloadRoot ? null : item.archive, folderAction: item.downloadRoot ? { href: route(item, item.downloadRoot), label: "分包下载", sizeBytes: item.rd?.files.reduce((sum, file) => sum + file.sizeBytes, 0) || 0 } : null });
  }
  const pageCount = Math.max(1, Math.ceil(entries.length / PAGE_SIZE));
  currentPage = Math.min(currentPage, pageCount);
  const fragment = document.createDocumentFragment();
  if (dataset) {
    const parent = path ? route(dataset, path.split("/").slice(0, -1).join("/")) : route(null);
    fragment.append(folderRow(".. 返回上级", parent, true));
  }
  for (const entry of entries.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)) fragment.append(entry.file ? fileRow(entry.file) : folderRow(entry.name, entry.href, false, entry.archive, entry.folderAction));
  $("file-list").replaceChildren(fragment);
  $("table-wrap").hidden = false;
  $("status").textContent = !current ? "该目录不存在，请从目录首页重新进入。" : entries.length ? "" : sequenceForPath(dataset, path) ? "本序列的 RD 分包正在上传，完成后会在此处显示。" : "此目录为空。";
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
    staticManifest = await response.json();
    const models = readManifest(staticManifest);
    await loadRDCatalogs(models);
    datasets = models;
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
setInterval(refreshRDCatalogs, 60000);
document.addEventListener("visibilitychange", () => { if (!document.hidden) refreshRDCatalogs(); });
loadManifest();
