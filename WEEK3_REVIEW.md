# 第 3 周｜周验证日

> 填写日期：2026-10-07（Day 21）　填写人：宝宝
> 说明：本文按周验证日模板原字段填写，**未增删栏位**。无证据的一律标 FAIL，不做模糊表述。

---

## 姓名 / 校区 / 项目名称

| 项 | 内容 |
|---|---|
| 姓名 | 【待填】 |
| 校区 | 【待填】 |
| 项目名称 | Falsity001 —— 职场经验分享网站（MVP） |
| 仓库 | https://github.com/xqree-baby/Falsity001 |
| 公网首页 | https://falsity-mock005-falsity001-d1gowkogp40251a26.webapps.tcloudbase.com |

---

## 本周完成的主要任务

| Day | 日期 | 主要任务 | 提交 |
|---|---|---|---|
| Day 15 | 10-04 | 开通 CloudBase 环境；部署 `/api/health` 云函数并经 HTTP 网关对外暴露；静态托管 mock 版首页；新建 `api-contract.md` | `5cab8cb` |
| Day 16 | 10-05 | 设计并建 `posts` / `comments` 两张表（PostgreSQL，TIMESTAMPTZ）；写入种子数据 9 帖 + 8 评论，含 2 条待审核帖 | `cd3b896` |
| Day 17 | 10-05 | 新建 `trends` / `favorites` 表；建 `api` 云函数按路径分发多接口；`POST /api/sync` 抓微博/B站/抖音三平台真实热搜；首页加「今日热搜」模块 | `6c1bd97` |
| Day 18 | 10-06 | `POST /api/favorites` 收藏写入接口上线；用数据库唯一索引做判重；修 PostgREST 关联置 null 导致的 502 | `0cff7c4` |
| Day 19 | 10-06 | 拆分数据访问层 `db.js`（业务层 / 数据访问层分离）；全接口 12 项回归；改 SSH 推送通道 | `ffbe22a` |
| Day 20 | 10-07 | 新增 `GET /api/posts`；前端收拢 `API_BASE` 指向公网；修跨域响应头重复导致被拦 | `8e52c44` |
| Day 21 | 10-07 | 周验收 + 同伴交叉验证 + 演示提纲；修同伴发现的前端 bug（详情页、评论、高亮） | 本次提交 |

---

## 本周检测执行结果

Day 21 当天用脚本直连公网实测（非缓存、非推测）：

| 检测项 | 地址 / 方式 | 结果 |
|---|---|---|
| 公网首页可访问 | `GET /`（webapps 域名） | **200**，30215 字节，含 `API_BASE` 且指向真实网关 |
| 健康接口 | `GET /api/health` | **200**，`env=falsity001-d1gowkogp40251a26`，Node v20.19.3 |
| 帖子列表接口 | `GET /api/posts`（带 `Origin` 头） | **200**，`ok=true`，`count=7` |
| 跨域响应头 | 同上，看 `Access-Control-Allow-Origin` | **单值** = 页面域名（Day 20 那个「两个值」的问题未复发） |
| 收藏列表接口 | `GET /api/favorites` | **200** |
| 热搜接口 | `GET /api/hot` | **200**，date=2026-10-07，**0 条**（当天未同步，非故障） |
| 帖子详情接口 | `GET /api/post?id=p001` | **200**（Day 21 新增），含帖子全字段 + 3 条真实评论 |
| 评论写入接口 | `POST /api/comments` | **201**（Day 21 新增），写后详情接口能读回该条 |
| 接口回归（Day 19 已做） | 12 项 | 12 项全过 |
| **真实写入** | `POST /api/favorites` body `{"post_id":"p009"}` | **201 Created**，`id=fmuxrdm6j`；条数 6 → 7 |
| **真实写入 2** | `POST /api/comments` body `{"post_id":"p001",...}` | **201 Created**，`id=cmuxt9y0p`；该帖评论 2 → 3 |
| 本地后端测试 | 真实启动 `index.js`，mock 注入 db 层 | **45 项全过** |
| 本地前端测试 | 热搜切换点击脚本 | **21 项全过**（还原修复后 8 项失败，反向对照有效） |
| 本地前端回归 | `day21-frontend-check.cjs` | **15 项全过** |

### 真实读写验证详情（Day 21 实测）

**结论：读、写两条通路均已验证通过。**

写入请求与返回（**两条**独立写入，收藏 + 评论）：

```
POST .../api/favorites
Content-Type: application/json
Origin: https://falsity-mock005-....webapps.tcloudbase.com
body: {"post_id":"p009"}

→ HTTP 201
→ Access-Control-Allow-Origin: https://falsity-mock005-....webapps.tcloudbase.com（单值，正确）
→ {"ok":true,"favorite":{"id":"fmuxrdm6j","post_id":"p009",
   "title":"入职前三个月，别急着证明自己","savedAt":"2026-10-07T15:00:48.907+08:00"}}
```

```
POST .../api/comments
Content-Type: application/json
body: {"post_id":"p001","author":"宝宝","body":"Day21 公网写入验证"}

→ HTTP 201
→ {"ok":true,"comment":{"id":"cmuxt9y0p","postId":"p001","author":"宝宝",
   "body":"Day21 公网写入验证","createdAt":"2026-10-07T15:53:56.857+08:00"}}
```

写入前后对比（`GET /api/favorites` 实测）：

| | 条数 | 内容 |
|---|---|---|
| 写入前 | 6 | f001~f003 + p001/p002/p005/p006 |
| 写入后 | **7** | 新增 `id=fmuxrdm6j` / `post_id=p009` / 标题「入职前三个月，别急着证明自己」/ 作者「带教老陈」/ 分类「职场新人」 |

**写后读回验证**（`GET /api/post?id=p001` 实测）：

| | 评论条数 | 最后一条 |
|---|---|---|
| 写入前 | 2 | —— |
| 写入后 | **3** | `cmuxt9y0p` / 宝宝 / 「Day21 公网写入验证」 |

即：写进去的评论能被详情接口原样读回，**写入确实落库、不是假成功**。

**说明**：
- 选 p009 的原因：p001/p002/p004/p005/p006/p008 均已收藏会撞唯一索引返回 409，p003 待审核返回 400，仅 p009 可打出 201。
- 跨域响应头为**单值**，Day 20 修复有效。
- 该记录为**验收写入**，非真实用户收藏/评论；表无删除接口，故保留（不擅自改库）。
- 探测 `GET /api/comments` 曾返回 404，**经查是我探测方法写错**（该接口只注册 `POST`，用 GET 打会落到函数末尾的兜底 404），非网关配置问题；返回体带 `receivedPath` 即可证明是函数自己打的 404。

**校验过程的一处失误（已修正）**：首次校验脚本用 `x.posts.id` 找新记录，返回 `false`，一度疑为写入失败。实查后确认是**脚本写错**——读接口返回扁平结构（`post_id` 平铺，无嵌套 `posts` 对象），并非写入失败。改按 `post_id` 字段校验后，第一条即 `fmuxrdm6j / p009`。**接口本身无异常。**

**另一处失误（已修正）**：修完详情页后，我用 `GET` 去探测评论接口，拿到 404 便推断「网关没绑 `/api/comments`」，差点让同伴去改 CloudBase 路由配置。改用正确方法 `POST` 后立刻 201。**教训：探测前先确认方法对不对，别急着怀疑用户的环境配置。**

---

## 证据链接

### 页面（静态托管）

- 公网首页：https://falsity-mock005-falsity001-d1gowkogp40251a26.webapps.tcloudbase.com
- 实测：200，31148 字节，含 `API_BASE` 且指向真实网关
- 说明：**在 MOCK005 环境内原地覆盖部署时 URL 不变**（域名绑定环境，不随部署版本变）。此前「每次部署 URL 都变」是因换环境（mock004→mock005），非同一环境内重新上传所致

### API（云函数网关）

基址 `https://falsity001-d1gowkogp40251a26-1499370664.ap-shanghai.app.tcloudbase.com/api`

| 接口 | 方法 | 实测 |
|---|---|---|
| `/health` | GET | 200 |
| `/posts` | GET | 200，7 条 |
| `/post?id=p001` | GET | **200**（Day 21 新增），含帖子全字段 + 该帖真实评论（3 条） |
| `/comments` | POST | **201 Created**（Day 21 新增，body `{"post_id":"p001","author":"宝宝","body":"..."}`，返回 `id=cmuxt9y0p`）；写后经 `GET /api/post?id=p001` 读回该条 |
| `/favorites` | GET | 200 |
| `/favorites` | POST | **201 Created**（Day 21 实测，body `{"post_id":"p009"}`，返回 `id=fmuxrdm6j`）；400/404/409 契约 Day 18 已验 |
| `/hot` | GET | 200，当天 0 条（未触发 sync） |
| `/sync` | POST | Day 17/19 已验（三平台各 30 条） |

**设计约束（本日新增，写下来防止以后重犯）**：CloudBase HTTP 网关**不支持 `/api/posts/{id}` 花括号路径参数**，且不允许与已有 `/api/posts` 冲突。故新增接口一律用**固定路径 + query/body 传参**。

### 云函数

- `functions/api/index.js` —— 业务层，按路径分发 **7 个**接口
- `functions/api/db.js` —— 数据访问层，PostgREST 语法与鉴权收拢于此
- `functions/health/index.js` —— 健康检查
- 三者均已部署 CloudBase 在线编辑器

### 数据库（PostgreSQL，CloudBase SQL 型）

- 建表脚本：`db/schema.sql`（posts / comments / trends / favorites + 唯一索引）
- 种子脚本：`db/seed.sql`（9 帖 + 8 评论 + 3 条收藏）
- 线上表数据：posts 9 行、comments 8 行、favorites **7 行**（Day 21 写入验证后，6 → 7）
- 「改数据 → 刷新跟着变」已验证：控制台改 p002 的 category 后，右栏分类计数由 2→1、1→2

### 文档

- `api-contract.md` —— 接口契约（⚠️ 其中 `/api/posts` 一节仍写「仅本地」，已过期未更新）
- `DEMO_OUTLINE.md` —— 本周新增，演示提纲四段结构
- `PEER_VERIFY_SCRIPT.md` —— 本周新增，同伴交叉验证操作话术

---

## 完成标准：已完成（1 项如实标未完成）

| 标准 | 状态 | 说明 |
|---|---|---|
| 公网首页展示真实数据 | **已完成** | 7 篇帖子，评论数/分类数逐条与接口返回一致 |
| 改数据库 → 刷新跟着变 | **已完成** | 控制台改 p002 分类，页面右栏计数与卡片标签同步变化 |
| 跨域问题定位与修复 | **已完成** | 根因=响应头两个值；已修并复验为单值（Day 21 写入时再次确认单值） |
| **真实读写** | **已完成** | 读：7 个接口实测 200；写：`POST /api/favorites` 201（6→7 条）、`POST /api/comments` 201（写后详情接口读回该条） |
| 演示提纲 | **已完成** | `DEMO_OUTLINE.md`，四段结构齐全，约 750 字 |
| 同伴交叉验证 | **已完成** | 同伴修复后重测，三项全过（详见下节） |
| 热搜当日有数据 | **未完成（FAIL）** | `/api/hot` 返回 `{"ok":true,"date":"2026-10-07","data":[]}`，当天未触发 `POST /api/sync`；**接口本身 200 正常**，属数据未同步非功能缺陷 |

**结论：完成标准基本全部完成，1 项如实标 FAIL。**

- 降级条款要求优先补齐的「**公网可访问 + 真实读写**」两项 —— **均已补齐并实测通过**。
- 同伴交叉验证已由真人执行并给出三行结论，非自评。
- 热搜当日 0 条如实标 **FAIL**：功能在（按钮能切、能出接口），但当天没有数据可展示，不能因为「接口没报错」就算完成。

---

## 同伴交叉验证

**执行情况：执行了两次** —— 首次**未通过**（发现 3 个真实 bug），修复后二次复测**三项全过**。

最终结论（同伴原话）：

| 项目 | 状态 |
|---|---|
| 可打开 | ☑ **能** |
| 可真实读写 | ☑ **能** |
| 无报错 | ☑ **有** |

### 第一次验证：未通过（发现 3 个真实 bug）

同伴按话术操作后反馈了失败，我据此定位并修复：

| # | 同伴看到的现象 | 根因 | 修复 |
|---|---|---|---|
| 1 | 点开帖子后详情页加载失败，控制台 `Cannot read properties of null (reading 'author')` | 前端用相对路径 `fetch('/api/posts/'+id)`，静态托管没有 `/api/`；且后端无详情路由 | 改 `GET /api/post?id=xx`；后端新增 `handlePostDetail()` |
| 2 | 评论区点发送没反应 | 前端用相对路径 `/api/posts/.../comments`；后端无评论写入路由 | 改 `POST /api/comments`（`post_id` 走 body）；后端新增 `handleCreateComment()` |
| 3 | 切热搜平台时，词条列表换了，**深色高亮仍钉在「微博」**上 | `active` class 只在生成按钮 HTML 时写死一次，切换走的 `renderTrends()` 只重画列表、不改按钮 class | `renderTrends()` 开头同步按钮 class（`index.html` 353-355 行） |

**bug 1、2 的一个关键约束**：CloudBase HTTP 网关**不支持 `/api/posts/{id}` 这种花括号路径参数**，也不允许与已有 `/api/posts` 冲突。故改用固定路径 + query/body 传参（`/api/post?id=`、`POST /api/comments` + `post_id`）。

**bug 1 的排查插曲**：我先看到控制台报错就下结论说「接口 404」，其实 404 是第一现场，`p.author` 是二次错误 —— 先修 404，二次错误自然消失。**不能只盯着报错文本，要回溯第一现场。**

### 第二次验证：三项全过

修复后重新上传静态托管，**URL 未变**（在 MOCK005 环境原地覆盖部署，域名绑定环境不随部署版本变）。同伴用同一地址重测，三行全过。

线上确认修复已生效：

| 检查项 | 结果 |
|---|---|
| 首页状态 / 大小 | 200，31148 字节（修复前 30812，差值与新增代码体量吻合） |
| 含 `Day 21 修` 注释 | true |
| 含 `classList.toggle` 高亮同步代码 | true |
| 内联脚本语法 | OK（26854 字符，可正常执行） |

### 本地验证（含反向对照）

| 验证 | 结果 |
|---|---|
| 后端本地测试（真实启动 `index.js`，mock 注入 db 层） | **45 项全过** |
| 前端接口地址回归 | **15 项全过** |
| 热搜切换点击脚本（点抖音→微博→B站→来回 6 次） | **21 项全过** |
| **反向对照：临时把修复还原后跑同一脚本** | **8 项失败**，且 `active` 永远为 `["weibo"]` |

**反向对照是这里最关键的一步** —— 它证明测试脚本真的能抓到这个问题，不是写了个永远为真的假测试。

**验证手段说明（如实记录）**：本机 Edge 当天无法启动（puppeteer 报 `Code: 0`，命令行 `--screenshot`/`--dump-dom` 亦无输出），故高亮验证用 jsdom 校验 DOM 逻辑（`class` / `dataset`）+ 直读 `style.css` 确认 `.trends-tab.active` 规则存在，**未做到像素级截图取证**。同伴手机录屏（8.3 秒）经 ffmpeg 抽帧后确认了修复前的现象：抖音按钮带焦点框但深蓝填充仍留在微博。

---

## 遇到的问题 + 报错原文与已尝试动作

### 问题 1（本周最花时间）跨域被拦：不是「没配」，是「配了两遍」

**报错原文**（浏览器 Console）：

```
Access to fetch at 'https://falsity001-...-1499370664.ap-shanghai.app.tcloudbase.com/api/hot'
from origin 'https://falsity-mock004-....webapps.tcloudbase.com'
has been blocked by CORS policy: The 'Access-Control-Allow-Origin' header
contains multiple values 'https://falsity-mock004-....webapps.tcloudbase.com,*',
but only one is allowed.
```

**已尝试动作**：

1. 先用脚本打接口 → 200，CORS 头单值 `*`，**看起来正常**（误判方向，脚本不带 `Origin` 头）
2. 改用带 `Origin` 头的请求复测 → 复现出两个值：网关回显页面域名 + 代码里的 `*`
3. 定位机理：CloudBase HTTP 网关自己会加一个 ACAO，云函数代码里再加一个 `*`，网关把两个逗号拼接；浏览器规定该头只能有一个值，故整个响应被网络层掐掉
4. 修复：`functions/api/index.js` 中删掉 `Access-Control-Allow-Origin`（`json()` 与 OPTIONS 分支各一处），跨域完全交给网关
5. 复验：带 `Origin` 头再打 → ACAO 单值，200

**教训**：验跨域不能用不带浏览器头部的脚本请求，那样测不出真实问题。

### 问题 2：`GET /api/posts` 返回 404，误以为是后端挂了

**返回体**：`{"code":"INVALID_PATH","message":"...","requestId":"..."}`

**已尝试动作**：对比自家函数的 404 形状（`{"ok":false,"error":"not found","receivedPath":"..."}`）→ 判断这是**网关**返回的，请求压根没到函数。修法：控制台 HTTP 网关加绑 `/api/posts` → api 函数，并补 `GET /posts` 路由。

**教训**：404 要看返回体是谁的形状，数字 404 不一定是自己代码的问题。

### 问题 3：首页报 `Cannot read properties of undefined (reading 'length')`

**原因**：`renderCards()` 读 `p.comments.length`，但新接口只返回 posts 表 10 个字段，不含 `comments`。换数据源后前端按旧形状读导致崩溃。

**修复**：接口侧加 `countCommentsByPost()` 补评论数并用空数组占位；前端两处加 `|| []` 兜底。

**教训**：换数据源不只是换 URL，返回字段也要对齐。

### 问题 4：`GET /api/favorites` 整体 502

**报错原文**：`Cannot read properties of null (reading 'title')`

**原因**：PostgREST 嵌套过滤 `posts.pending=eq.false` 在父行不满足时把关联对象置为 `null`（而非删整行），代码直接读 `r.posts.title` 抛错，**整个接口挂掉**。

**修复**：`.filter(r => r.posts)` 过滤掉关联为 null 的行。

**流程教训**：Day 18 修过一次但没提交进 `0cff7c4`，导致线上一直带雷，直到 Day 19 库里首次出现待审帖数据才爆。**当天验证通过的修复如果不提交，等于没修。**

### 问题 5：环境类（已解决，记录备查）

| 问题 | 解决 |
|---|---|
| 访问 GitHub 时好时坏，push 反复失败 | 查实为**网络封 443 但通 22**，改 SSH 通道后一次成功 |
| 「push 报网络错」被误判为失败 | 实为**报错 ≠ 没推上**，判断成败须用 `git ls-remote` / api.github.com 问远端 |
| CloudBase Web 函数用 `exports.main` 报 443 错误 | Web 函数必须 `http.createServer` + `listen(9000)` |
| 新接口不生效 | 须在 HTTP 网关**加绑路由**，与部署函数是两次操作 |

### 问题 6：切热搜平台时，高亮不跟着按钮走（同伴交叉验证抓出来的）

**现象**（同伴手机录屏 8.3 秒，抽帧确认）：

点「抖音」，词条列表确实换成了抖音内容，但**深蓝色高亮仍留在「微博」按钮上**，抖音只是被按了一下（泛出浅蓝按压态）。抖音按钮上另有一圈深色描边，那是浏览器 `:focus` 的焦点框 —— 说明**点击事件确实触发了、焦点确实跟着走了，只有高亮没走**。

**根因**：

```javascript
// index.html 第 326 行（loadTrends 内）—— active 只在这里写死一次
return `<button class="trends-tab ${trendsPlatform === p.key ? 'active' : ''}" ...>`;

// index.html renderTrends()（修复前）—— 只重画列表，压根没碰按钮
function renderTrends() {
  const root = document.getElementById('trendsList');   // ← 就这一行往下走
  ...
}
```

高亮是纯 CSS 实现的（`style.css:447`，`.trends-tab.active` → `background: var(--c-blue)`）。这个 class 在**生成按钮 HTML 的那一刻**按当时的 `trendsPlatform` 写死；之后点按钮走的是 `renderTrends()`，那条路径不碰按钮 class。**列表和按钮高亮是两个数据源，切换时只更新了一个。**

**已尝试动作**：

1. 抽同伴录屏的帧，确认是持续状态而非过渡帧（排除动画时序问题）
2. 读 `renderTrends()` 与 `loadTrends()`，定位到 class 只写一次
3. 读 `style.css:447` 确认高亮确实依赖 `.active`（排除 CSS 覆盖/优先级问题）
4. 修复：在 `renderTrends()` **开头**同步三个按钮的 class，用 `classList.toggle` 而非重建按钮 —— 重建会丢焦点，还得重新绑事件、重复绑会叠加

**修法**：

```javascript
function renderTrends() {
  // Day 21 修：按钮高亮要跟着 tabs 一起换。之前 active 只在 loadTrends 生成 HTML 时写死一次，
  // 点别的平台时列表换了、按钮还是旧平台深色——同伴交叉验证时发现的。
  // 不重建按钮（那样会丢焦点、还得重绑事件），只翻 class，两边永远同源。
  document.getElementById('trendsTabs').querySelectorAll('.trends-tab').forEach(b => {
    b.classList.toggle('active', b.dataset.p === trendsPlatform);
  });
  // ...原代码不变
}
```

**验证**：jsdom 点击脚本 21 项全过；**临时还原修复后同一脚本 8 项失败**且 `active` 恒为 `["weibo"]`；前端接口回归 15 项仍全过。

**教训**：**同源原则** —— 凡是「选中态」这类由状态派生出来的 UI，两个以上地方用到时就该由同一处计算，不能一个在生成时写死、一个在切换时忘记改。本项目里顶栏导航高亮（`index.html:182`）当时写对了，用的就是 `classList.toggle` 每次重算；热搜这处偷懒只在生成时写死。**同一个项目里已有正确写法时，照着它写。**

**同源教训的推广自查**：凡是「状态 → UI」的派生显示，多处消费时优先「每次渲染都重算」，而不是「初始化时算一次」。

### 问题 7：探测接口用错方法，差点让同伴白改配置

**现象**：我探测 `GET /api/comments` 得到 `404 {"ok":false,"error":"not found","receivedPath":"/api/comments"}`，据此推断「网关没绑 `/api/comments`」，准备让同伴去 CloudBase 控制台加路由。

**真相**：该接口只注册了 `POST`，用 GET 打会一路走到 `index.js` 末尾的兜底 404。改用 `POST` 立刻返回 201。

**判别依据（值得记住）**：返回体里带 `receivedPath` 字段 → 说明**请求已经到达我们自己的函数**（那个字段是 `index.js:521` 手动加的），是函数内部没匹配到路由，**不是网关没绑定**。真正的网关 404 返回体形状完全不同（形如 `{"code":"INVALID_PATH","message":...,"requestId":...}`，见问题 2）。

**教训**：**排查前先确认自己这边的请求没写错**。把「我发错了」和「对方配错了」分清再开口，否则会让同伴做无用功、甚至改坏本来正确的配置。

---

## 本周遗留（不在本周范围，记录待下周）

1. `api-contract.md` 中 `/api/posts` 一节仍写「仅本地」，实际已上线 —— **待更新**。Day 21 新增的 `/api/post`、`/api/comments` **尚未写入契约文档**
2. Console 中一条 `...ap.tcloudbase.com/api/posts` 报错未定位，该域名仓库内零匹配，疑为 DevTools 历史记录或浏览器插件 —— **待确认**
3. 热搜当日 0 条（`/api/sync` 需手动触发）—— 非功能缺陷，但验收标准中已如实标 FAIL
4. 余力加练「检查台加最后更新时间」未做
5. 登录系统上线后，`favorites` 唯一索引需从 `UNIQUE(post_id)` 改为 `UNIQUE(user_id, post_id)`
6. **`public/index.html` 仍有 3 处旧相对路径**（`/api/posts?as=`、`/api/admin/pending`、`/api/admin/posts/`），属发帖页 / 审核页的旧实现。静态托管没有 `/api/`，这些功能在公网上应该是坏的 —— Day 21 范围只修详情页与评论，**未扩展修复，遗留到下周**
7. 评论功能只有最简版：无删除、无审核、无点赞/举报，且无登录态（昵称可任意填写）
