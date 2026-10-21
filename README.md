# 低空弱小目标数据集

轻量静态网站：HTML / CSS / JavaScript，无构建步骤、后端、数据库或第三方 CDN。数据文件始终保存在腾讯云 COS；网页托管平台只保存页面和文件清单。

## 项目文件

- `index.html`：标题与简洁文件目录。
- `styles.css`：桌面与手机布局。
- `script.js`：读取 JSON、逐级目录浏览、路径导航；单个目录超过 100 项时分页。
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
- `folder`：相对文件夹路径，使用 `/` 分隔；空字符串表示数据集根目录。
- `sizeBytes`：准确字节数；未知时用 `null`，不要用猜测值。已知为零的文件填写 `0`。
- `type`：TXT、BIN、ZIP 等显示类型。
- `url`：真实、可匿名访问、无签名有效期的 HTTPS 地址。示例中的 YOUR-BUCKET 是占位符，需要替换。
- `description`：可选纯文本。

当前正式数据集为 Jinze-FullChain：630 个文件，共 1,301,948,314 字节（1.212534 GiB），保留原相对目录、名称和内容。发布前核对大小、CRC64 和匿名访问；多分片 ETag 不作为全文件 MD5。界面以二进制单位显示，鼠标悬停可查看准确字节数。

### 增加新数据集和文件夹

在顶层 `datasets` 数组增加一个对象，提供唯一 `id`、`name`、可选 `description` 和 `files` 数组。文件夹由每条文件的 `folder` 自动汇总，无需修改 HTML。只有稳定、已上传、大小和 CRC64 一致且匿名访问通过的对象才进入清单；完整私有扫描清单、凭据、日志和本地绝对路径不公开。

首页只显示数据集文件夹，目前为 `Jinze-FullChain`。点击进入后，只显示当前层的子文件夹和文件；通过路径导航或“返回上级”逐级浏览，不平铺展示全部 630 个文件。浏览器前进、后退和目录链接可用，直接打开目录链接也能恢复对应位置。单个目录超过 100 项时分页。

目录根据静态清单生成，不是动态 COS 文件浏览器。清单一次读取到浏览器；今后如果清单达到数十万条，再按数据集拆分清单。10 TB 是 COS 数据量，不等同于页面或清单大小。

### 替换正式 COS 地址

先上传正式文件并由管理员设置最小范围的公开读取权限，再在无登录浏览器检查完整 HTTPS 地址。修改清单中的文件名、大小、类型、描述和 `url` 即可。中文、空格和特殊字符路径请使用 COS 提供的对象地址；不要粘贴临时签名链接。

本网站不调用 ListObjects、不读取云账号凭据，也不自动修改 COS 权限、策略或 CORS。

## 下载行为与 COS 设置

下载按钮是普通 `<a href="COS_HTTPS_URL">`，浏览器直接请求 COS，页面没有大文件 `fetch`、Blob、内存缓存或下载代理。

普通跨站链接下载不要求 COS 启用 CORS。`download` 属性对跨源资源不一定生效，实际保存行为主要由 COS 响应头决定。发布时检查 `Content-Disposition: attachment`。Bucket 保持私有，仅对获准且完成核验的对象设置匿名只读，不向未来新增文件自动开放。若对象被浏览器打开，管理员可在 COS 控制台对象详情的自定义头部 / HTTP 元数据设置：

```text
Content-Disposition: attachment; filename="sample-001.zip"
```

设置前先检查对象现有元数据，不修改整个 Bucket 的访问策略。不要依赖匿名 URL 的 `response-content-disposition` 查询参数绕过配置：部分覆盖参数需要签名。本网站不使用临时签名。

浏览器下载大文件可使用支持续传的工具，例如：

```sh
curl -L -C - -o point_alignment.csv "https://research-datasets-test-1511906351.cos.ap-shanghai.myqcloud.com/datasets/Jinze-FullChain/alignment/metadata/point_alignment.csv"
```

如果只检查 Range，请使用 `Range: bytes=0-1023`，检查 206 和 `Content-Range`，不要重复下载整个大文件。HEAD 失败时要继续检查小范围 GET，不能据此认定下载失败。

## 更新现有 Netlify 项目

1. 登录 `https://app.netlify.com/`，确认使用 Free 方案，不开通付费功能。
2. 打开已有项目 `https://app.netlify.com/projects/fantastic-narwhal-5c2364/deploys`，上传最新纯静态 ZIP。根目录必须直接包含 `index.html`。
3. ZIP 仅包含 index.html、styles.css、script.js、datasets.json、favicon.svg、.nojekyll、netlify.toml。
4. 验证原地址 `https://fantastic-narwhal-5c2364.netlify.app/` 无需登录。
5. 继续复用同一项目，不新建站点。当前仍为手动发布，没有配置 GitHub 自动同步。

可选：导入 GitHub 仓库，Production branch 设为 `main`，Build command 留空，Publish directory 设为 `.`。之后推送 main 即自动更新。不要把 COS 数据文件放入仓库或部署包。

## 更新现有 GitHub Pages

1. 复用 `https://github.com/2409561269/research-datasets-site`，不新建仓库。
2. 提交前检查本地状态与远端 main，避免覆盖别人的提交。
3. 沿用已配置的 main 分支根目录发布，不修改 Pages 配置。
4. 等待构建完成，打开 `https://2409561269.github.io/research-datasets-site/` 验证。
5. 更新目录后分别验收 GitHub Pages 和 Netlify。

本地 Git 更新示例：

```powershell
git add datasets.json
git commit -m "Update dataset catalog"
git push origin main
```

只在这个独立项目目录操作；不要将父目录、其他项目、证据文件或真实科研数据批量加入仓库。

## 上线检查

- 首页、styles.css、script.js、datasets.json 均返回 200。
- 首页仅列出 Jinze-FullChain 文件夹，进入后逐级浏览；路径导航、返回上级、浏览器前进后退和手机宽度显示正常。
- 无痕窗口可浏览目录；630 个正式文件均可通过各自目录找到，测试条目已移除；数据集根目录 README.md 下载为 1,834 字节。
- 下载请求主机是腾讯云 COS，不是网页托管域名。
- 大文件 point_alignment.csv 小范围 GET 返回 206，Content-Range 总大小为 36,484,847。
- 公开部署中没有密钥、日志、本地路径、测试下载文件或其他项目内容。

## 中国大陆用户测试

默认托管域名不要求购买域名或为境外托管单独申请国内接入备案；这不意味着它们经过中国大陆网络加速。跨境 DNS、TLS、连接稳定性可能随网络和时间变化。

分别使用国内校园网和手机 4G/5G（关闭 Wi-Fi、VPN 和代理），在无痕浏览器访问真实发布地址。记录时间、城市、运营商、是否显示正式文件目录、首次打开耗时、README 下载和大文件小范围请求是否成功。某台本机或服务器成功，不代表全国校园网与移动网络都可用。

静态网页免费额度与 COS 的存储、请求和公网下载费用分开计算。COS 直链流量不经过 Netlify / GitHub Pages；正式公开前应自行评估 COS 流量预算。
