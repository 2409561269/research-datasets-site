# 科研数据集下载中心

轻量静态网站：HTML / CSS / JavaScript，无构建步骤、后端、数据库或第三方 CDN。数据文件始终保存在腾讯云 COS；网页托管平台只保存页面和文件清单。

## 项目文件

- `index.html`：页面结构与下载说明。
- `styles.css`：桌面与手机布局。
- `script.js`：读取 JSON、搜索、数据集 / 文件夹 / 类型筛选、每页 50 个文件。
- `datasets.json`：全部公开文件信息。
- `favicon.svg`：本地图标。
- `.nojekyll`：GitHub Pages 按静态文件发布。
- `netlify.toml`：发布根目录，无构建命令。

所有资源采用相对路径，兼容 `https://用户名.github.io/research-datasets-site/` 项目子路径。

## 本地运行

在本目录运行静态 HTTP 服务，例如：

```powershell
python -m http.server 8000 --bind 127.0.0.1
```

然后访问 `http://127.0.0.1:8000/`。不要通过 `file://` 验证 JSON 加载。

如果 Windows 的 Python 出现 `socket.getfqdn` / `UnicodeDecodeError`，可使用 Node 静态服务，或选择其他静态服务器。这是本机主机名解析编码问题。

## 维护文件清单

### 增加文件 / 修改大小与描述

在对应数据集的 `files` 数组中增加一项，或修改现有项：

```json
{
  "id": "experiment-001",
  "folder": "experiment-2026/raw",
  "name": "sample-001.zip",
  "sizeBytes": null,
  "type": "ZIP",
  "url": "https://YOUR-BUCKET.cos.ap-shanghai.myqcloud.com/experiment-2026/raw/sample-001.zip",
  "description": "实验样本说明"
}
```

- `id`：在本数据集内唯一。
- `folder`：显示和筛选使用的路径；空字符串表示根目录。
- `sizeBytes`：准确字节数；未知时用 `null`，不要用猜测值。已知为零的文件填写 `0`。
- `type`：TXT、BIN、ZIP 等显示类型。
- `url`：真实、可匿名访问、无签名有效期的 HTTPS 地址。示例中的 YOUR-BUCKET 是占位符，需要替换。
- `description`：可选纯文本。

当前测试大小：文本 151 字节；二进制 8,388,608 字节（8 MiB）。界面以二进制单位显示，最多保留两位小数，鼠标悬停大小可查看准确字节数。总大小也按此规则四舍五入。

### 增加新数据集和文件夹

在顶层 `datasets` 数组增加一个对象，提供唯一 `id`、`name`、可选 `description` 和 `files` 数组。文件夹由每条文件的 `folder` 自动汇总，无需修改 HTML。改为正式数据集后，可将侧栏的测试提示改为项目介绍。

当前是平面目录筛选，不是动态 COS 文件浏览器。清单一次读取到浏览器，每页最多渲染 50 项；今后如果清单达到数十万条，再按数据集拆分清单。10 TB 是 COS 数据量，不等同于页面或清单大小。

### 替换正式 COS 地址

先上传正式文件并由管理员设置最小范围的公开读取权限，再在无登录浏览器检查完整 HTTPS 地址。修改清单中的文件名、大小、类型、描述和 `url` 即可。中文、空格和特殊字符路径请使用 COS 提供的对象地址；不要粘贴临时签名链接。

本网站不调用 ListObjects、不读取云账号凭据，也不自动修改 COS 权限、策略或 CORS。

## 下载行为与 COS 设置

下载按钮是普通 `<a href="COS_HTTPS_URL">`，浏览器直接请求 COS，页面没有大文件 `fetch`、Blob、内存缓存或下载代理。

普通跨站链接下载不要求 COS 启用 CORS。`download` 属性对跨源资源不一定生效，实际保存行为主要由 COS 响应头决定。当前两个测试对象已返回 `Content-Disposition: attachment`，无需更改。若未来对象被浏览器打开，管理员可在 COS 控制台对象详情的自定义头部 / HTTP 元数据设置：

```text
Content-Disposition: attachment; filename="sample-001.zip"
```

设置前先检查对象现有元数据，不修改整个 Bucket 的访问策略。不要依赖匿名 URL 的 `response-content-disposition` 查询参数绕过配置：部分覆盖参数需要签名。本网站不使用临时签名。

浏览器下载大文件可使用支持续传的工具，例如：

```sh
curl -L -C - -o test-range.bin "https://research-datasets-test-1511906351.cos.ap-shanghai.myqcloud.com/public-tests/test-range.bin"
```

如果只检查 Range，请使用 `Range: bytes=0-1023`，检查 206 和 `Content-Range`，不要重复下载整个大文件。HEAD 失败时要继续检查小范围 GET，不能据此认定下载失败。

## Netlify 初次部署与更新

1. 登录 `https://app.netlify.com/`，确认使用 Free 方案，不开通付费功能。
2. 打开 `https://app.netlify.com/drop`，上传本目录或提供的纯静态 ZIP。解压层级的根目录必须直接包含 `index.html`。
3. 如站点以 private 状态创建，使用 Publish 对公网发布；检查无痕窗口无需登录。
4. 从项目 Overview / Domains 复制实际的 `https://站点名.netlify.app/` 地址。
5. 以后在同一项目的 Deploys 页面找到手动部署区域，重新上传完整站点，避免每次新建项目。

可选：导入 GitHub 仓库，Production branch 设为 `main`，Build command 留空，Publish directory 设为 `.`。之后推送 main 即自动更新。不要把 COS 数据文件放入仓库或部署包。

## GitHub Pages 初次部署与更新

1. 在 GitHub 新建公开仓库 `research-datasets-site`，如已有同名仓库先核实内容，避免覆盖。
2. 把本项目文件放到仓库 `main` 分支根目录。
3. 打开仓库 Settings → Pages → Build and deployment，Source 选择 Deploy from a branch，Branch 选择 main，目录选择 / (root)，点击 Save。
4. 等待 Pages 构建完成后，打开 `https://用户名.github.io/research-datasets-site/`。
5. 以后编辑 `datasets.json` 并提交 main，等待 Pages 构建即可更新。

本地 Git 更新示例：

```powershell
git add datasets.json
git commit -m "Update dataset catalog"
git push origin main
```

只在这个独立项目目录操作；不要将父目录、其他项目、证据文件或真实科研数据批量加入仓库。

## 上线检查

- 首页、styles.css、script.js、datasets.json 均返回 200。
- 搜索、空结果、清除筛选和手机宽度显示正常。
- 无痕窗口可浏览首页，点击 test-public.txt 可以下载 151 字节文件。
- 下载请求主机是腾讯云 COS，不是网页托管域名。
- 二进制小范围 GET 返回 206，Content-Range 总大小为 8388608。
- 公开部署中没有密钥、日志、本地路径、测试下载文件或其他项目内容。

## 中国大陆用户测试

默认托管域名不要求购买域名或为境外托管单独申请国内接入备案；这不意味着它们经过中国大陆网络加速。跨境 DNS、TLS、连接稳定性可能随网络和时间变化。

分别使用国内校园网和手机 4G/5G（关闭 Wi-Fi、VPN 和代理），在无痕浏览器访问真实发布地址。记录时间、城市、运营商、首页是否显示两个文件、首次打开耗时、文本下载、二进制小范围请求是否成功。在一天的不同时段至少重复一次。某台本机或服务器成功，不代表全国校园网与移动网络都可用。

静态网页免费额度与 COS 的存储、请求和公网下载费用分开计算。COS 直链流量不经过 Netlify / GitHub Pages；正式公开前应自行评估 COS 流量预算。
