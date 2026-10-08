# Falsity 接口契约（api-contract.md）

> 版本：Day 22  PATCH / DELETE 上线版
> 说明：本文档记录 Falsity 项目对外暴露的 HTTP 接口。状态分为四类：
> - **已部署**：已在 CloudBase 公网可访问（**当前绝大多数接口属这类**）
> - **仅本地**：`server.js` 已实现，但未部署到 CloudBase（静态 mock 版不包含后端）
> - **实现中**：正在实现，目标当天部署
> - **未实现**：后续计划要补的接口，当前只有契约草案
>
> ⚠️ **2026-10-08 补记（Day 22）**：清理了 §2 / §3 / §4 三节的过时内容——
> 这三节之前都写着「仅本地」或过时的路径写法，而实际上**早已部署上线**。
> 教训：**文档状态要定期对代码**。看到「仅本地」时，先去地址栏开一下确认，别直接当真。
> 文档写错不会影响程序运行（前端请求的是真实地址，云函数不读这份文档），
> 但会坑到以后来读它的人——包括三天后的你自己。  

---

## 1. 健康检查 /api/health

| 项 | 内容 |
|---|---|
| 状态 | **已部署**（CloudBase 云函数） |
| 公网地址 | `https://falsity001-d1gowkogp40251a26-1499370664.ap-shanghai.app.tcloudbase.com/api/health` |
| 方法 | `GET` |
| 鉴权 | 无 |

### 请求
```text
GET /api/health
```

### 成功响应 200
```json
{
  "status": "ok",
  "service": "falsity",
  "env": "falsity001-d1gowkogp40251a26",
  "endpoint": "/api/health",
  "deployedAt": "2026-10-04 20:30 (北京时间)",
  "requestTime": "2026-10-04T12:31:22.312Z",
  "nodeVersion": "v20.19.3",
  "path": "/"
}
```

### 字段说明
| 字段 | 含义 |
|---|---|
| `status` | 固定返回 `ok` |
| `service` | 项目名 |
| `env` | CloudBase 环境 ID |
| `endpoint` | 该接口对外路径 |
| `deployedAt` | 本次部署时间戳（人工写入，用于核对该版本是否已上线） |
| `requestTime` | 实时请求时间（证明函数真的在运行） |
| `nodeVersion` | 云端 Node.js 版本 |
| `path` | 请求的实际 URL 路径 |

---

## 2. 帖子列表 /api/posts

| 项 | 内容 |
|---|---|
| 状态 | **已部署**（Day 20 当天部署成功；Day 22 补记——本文档之前一直误标「仅本地」） |
| 方法 | `GET` |
| 鉴权 | 无 |
| 数据来源 | `posts` 表（PostgreSQL，`pending = false`） |

>⚠️ 2026-10-08 补记：这节之前写「仅本地」，是**文档没跟上代码**，不是接口没上线。
>   实际 Day 20 已部署，Day 22 早上实测返回 7 条已过审帖。
>   教训：**文档状态要定期对代码**——文档说「仅本地」时，先去地址栏开一下确认，别当真。

### 请求
```text
GET /api/posts
```

### 成功响应 200
```json
{
  "posts": [
    {
      "id": "p001",
      "type": "opinion",
      "category": "求职面试",
      "title": "面试时被问『为什么离开上一家公司』，别说真话",
      "body": "...",
      "author": "在职老张",
      "authorVerified": true,
      "createdAt": "2026-09-15T10:30:00+08:00",
      "pending": false,
      "views": 1580,
      "comments": [ ... ]
    }
  ]
}
```

### 业务规则
- 只返回 `pending: false` 的帖子（已通过审核）
- 按 `createdAt` 倒序排列

---

## 3. 单篇帖子 GET /api/post?id=xx

| 项 | 内容 |
|---|---|
| 状态 | **已部署**（Day 21 当天部署；Day 22 补记——本节之前写的是 `/api/posts/:id` +「仅本地」，两处都过时） |
| 方法 | `GET` |
| 鉴权 | 无 |
| 数据来源 | `posts` 表 + `comments` 表（两次查询后拼成一条帖子） |

> ⚠️ **地址形态变更（Day 21）**：本节原来写 `GET /api/posts/p001`，
> 实际部署的是 `GET /api/post?id=p001`。原因见下方「为什么不是 /api/posts/:id」。

### 请求
```text
GET /api/post?id=p006
```

### 成功响应 200（以下是 Day 22 实测的真实返回）
```json
{
  "ok": true,
  "post": {
    "id": "p006",
    "type": "opinion",
    "category": "晋升发展",
    "title": "30 岁转行，来得及，但别裸转",
    "body": "30 岁转行成功的人有个共同点：没有一个是先辞职再学的……",
    "author": "跳槽过来人",
    "authorVerified": true,
    "views": 760,
    "createdAt": "2026-09-14T09:00:00+08:00",
    "comments": []
  }
}
```

### 字段说明
| 字段 | 含义 |
|---|---|
| `ok` | 固定 `true` |
| `post.comments` | 该帖的评论**完整对象数组**（含正文，不只是条数） |
| `post.authorVerified` | 作者是否公司认证用户 |
| `post.createdAt` | 发布时间（UTC+8） |

> ⚠️ 跟 `§2 /api/posts` 的区别：列表接口的 `comments` 是**空数组占位**
> （只给 `.length` 让卡片显示「N 条评论」，不是真内容）；
> 本接口的 `comments` 是**带正文的完整数组**。两个形状不一样，前端渲染代码不能混用。

### 失败响应
**缺 id → 400**（实测）
```json
{ "ok": false, "error": "缺少 id 参数（用法：/api/post?id=p001）" }
```
**帖子不存在或待审核 → 404**
```json
{ "ok": false, "error": "帖子不存在或还在审核中" }
```

### 业务规则
-未通过审核（`pending: true`）的帖子不可见，**与列表、收藏列表口径一致**
- **「不存在」和「还在审核中」故意不区分**：不该告诉外人这篇存在但看不到
- 评论查不到要让帖子照常显示（评论是附加信息，不该拖垮正文）

### 为什么不是 `/api/posts/:id`
CloudBase HTTP 网关**不支持 `{id}` 路径参数**，只认固定路径；
而 `/api/posts` 已经被 Day 20 的列表接口占用，改不成 `/api/posts/{id}`。
→ 另起固定路径 `/api/post`，帖子编号放 **query**（`?id=p006`）。
query 参数是可行的：Day 17 的 `/api/hot?date=2026-10-05` 一直正常工作。

> **踩坑记录（Day 21 同伴验证）**：详情页当时写的是相对路径 `fetch('/api/posts/'+id)`，
> 页面跑在静态托管域名上，这个相对路径请求发到静态托管自己那儿，
> 静态托管里没有 `/api/` → 必然 404 → 页面 catch 里 `p` 是 `null`，
> 再读 `p.author` 就抛 `Cannot read properties of null`。
> **教训：后端有接口 ≠ 前端会调用它。**接线要单独验。

---

## 4. 发表评论 POST /api/comments

| 项 | 内容 |
|---|---|
| 状态 | **已部署**（Day 21 当天部署；Day 22 补记——本节之前写的是 `/api/posts/:id/comments` +「仅本地」，两处都过时） |
| 方法 | `POST` |
| 鉴权 | 无（当前 MVP 还没有登录系统） |
| 数据去向 | 写入 `comments` 表 |

> ⚠️ **地址形态变更（Day 21）**：本节原来写 `POST /api/posts/:id/comments`，
> 实际部署的是 `POST /api/comments`，帖子编号放**请求体的 `post_id` 字段**。
> 原因见下方「为什么编号放请求体」。

### 请求
```text
POST /api/comments
Content-Type: application/json
```

### 请求体
| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `post_id` | string | ✅ | 要评论的帖子编号，对应 `posts.id` |
| `body` | string | ✅ | 评论内容，不能为空 |
| `author` | string | ❌ | 昵称，留空按「匿名」存 |

```json
{
  "post_id": "p006",
  "author": "宝宝",
  "body": "亲测有效。"
}
```

### 成功响应 201（Day 22 实测的真实返回）
```json
{
  "ok": true,
  "comment": {
    "id": "cmuz716qn",
    "postId": "p006",
    "author": "宝宝",
    "body": "亲测有效。",
    "createdAt": "2026-10-08T15:06:49.055+08:00"
  }
}
```

### 字段说明
| 字段 | 含义 |
|---|---|
| `comment.id` | 评论编号，`c` + 时间戳 base36（如 `cmuz716qn`），**不是自增数字** |
| `comment.postId` | 属于哪篇帖子 |
| `comment.createdAt` | 由数据库生成后原样退回，不是我们猜的 |

### 失败响应
**缺 post_id → 400**
```json
{ "ok": false, "error": "post_id 必填（要评论的帖子编号）" }
```
**评论内容为空 → 400**（实测）
```json
{ "ok": false, "error": "评论内容不能为空" }
```
**请求体不是合法 JSON → 400**
```json
{ "ok": false, "error": "请求体不是合法的 JSON" }
```
**帖子不存在或未过审 → 404**
```json
{ "ok": false, "error": "帖子不存在或还在审核中" }
```

### 业务规则
- 校验顺序固定：**读体 → 解析 → 校验 post_id → 校验内容 → 确认帖子存在且已过审 → 写**
- 不给待审核的帖子收评论，跟详情页不给看保持同一个口径
- **评论编号不查表生成**：`c` + 时间戳 base36，自带随机性。
  不用「查表里最大号 +1」—— 那是查完再插，两步之间有缝，并发会撞主键
- 写入用 `Prefer: return=representation`，让数据库把插入的行原样退回，
  返回的 `id` / `createdAt` 就是库里真实存的值
- 外键 `comments_post_fk` 也拦一道，但代码里**先查一次帖子**，
  好给前端一句人话（「帖子不存在」而不是「外键冲突」）

### 为什么编号放请求体
CloudBase HTTP 网关不支持 `{id}` 路径参数（见§3「为什么不是 /api/posts/:id」）。
本来想把 `p001` 放 URL 上，但网关不支持；退而求其次放请求体的 `post_id`。

> 这不是什么优雅设计，是**平台限制下的妥协**。
> 记录在这儿的意义是：以后换平台/网关支持路径参数了，可以改回 RESTful 的标准形态。

---

## 5. 发帖 /api/posts

| 项 | 内容 |
|---|---|
| 状态 | **仅本地** |
| 方法 | `POST` |
| 鉴权 | 无（当前用 URL 参数 `?as=verified` 模拟认证身份） |

### 请求
```text
POST /api/posts?as=verified
```

### 请求体
```json
{
  "type": "opinion",
  "category": "求职面试",
  "title": "标题",
  "body": "正文"
}
```

### 成功响应 201
```json
{
  "post": { ... },
  "pending": true
}
```

### 失败响应 400
```json
{ "error": "title 和 body 必填" }
```
或
```json
{ "error": "type 必须是 opinion 或 question" }
```

### 业务规则
- 所有帖子当前一律先进入 `pending: true` 审核状态（Day 13 拍板）
- 未认证用户（不带 `?as=verified`）强制 `type=question`、`author=匿名网友（待审核）`
- 认证用户必须显式传 `type` 且只能是 `opinion` / `question`

---

## 6. 待审核列表 /api/admin/pending

| 项 | 内容 |
|---|---|
| 状态 | **仅本地** |
| 方法 | `GET` |
| 鉴权 | 无（当前是 MVP 演示入口，未做登录） |

### 请求
```text
GET /api/admin/pending
```

### 成功响应 200
```json
{
  "posts": [ ... ]
}
```

### 业务规则
- 只返回 `pending: true` 的帖子

---

## 7. 审核通过 /api/admin/posts/:id/approve

| 项 | 内容 |
|---|---|
| 状态 | **仅本地** |
| 方法 | `POST` |
| 鉴权 | 无 |

### 请求
```text
POST /api/admin/posts/p003/approve
```

### 成功响应 200
```json
{
  "post": { ... },
  "action": "approve"
}
```

### 业务规则
- 把 `pending` 改为 `false`
- 去掉 author 里的 `（待审核）` 后缀

---

## 8. 审核驳回 /api/admin/posts/:id/reject

| 项 | 内容 |
|---|---|
| 状态 | **仅本地** |
| 方法 | `POST` |
| 鉴权 | 无 |

### 请求
```text
POST /api/admin/posts/p003/reject
```

### 成功响应 200
```json
{
  "action": "reject",
  "id": "p003"
}
```

### 业务规则
- 直接从 `posts` 数组中删除该帖子

---

## 9. 今日热搜 /api/hot

| 项 | 内容 |
|---|---|
| 状态 | **已部署**（Day 17 当天部署成功；Day 18 补记） |
| 方法 | `GET` |
| 鉴权 | 无 |
| 数据来源 | `trends` 表（由 `/api/sync` 从微博/B站/抖音写入） |

### 请求
```text
GET /api/hot
GET /api/hot?date=2026-10-05   （可选：查指定日期，格式 YYYY-MM-DD，北京时间）
```

### 成功响应 200
```json
{
  "ok": true,
  "date": "2026-10-05",
  "data": [
    { "platform": "weibo",     "title": "热搜词条一", "hot": 2345678, "rank": 1, "fetched_at": "2026-10-05T20:30:00.000+08:00" },
    { "platform": "bilibili",  "title": "热搜词条二", "hot": 987654,  "rank": 1, "fetched_at": "2026-10-05T20:30:00.000+08:00" },
    { "platform": "douyin",    "title": "热搜词条三", "hot": 1234567, "rank": 1, "fetched_at": "2026-10-05T20:30:00.000+08:00" }
  ]
}
```

### 字段说明
| 字段 | 含义 |
|---|---|
| `ok` | 固定 `true`，表示请求本身成功（哪怕 data 为空也是 true） |
| `date` | 本次返回的是哪一天的热搜（北京时间） |
| `data[].platform` | 来源平台：`weibo` / `bilibili` / `douyin` |
| `data[].title` | 热搜词条文本 |
| `data[].hot` | 热度值（各平台口径不同，只做展示用，跨平台不可比） |
| `data[].rank` | 平台内排名，1 开始 |
| `data[].fetched_at` | 最近一次同步时间 |

### 业务规则
- 默认返回**当日**（北京时间）数据；当日还没同步过时返回 `data: []`
- 排序：先按 platform 分组，组内按 rank 升序

---

## 10. 收藏列表 /api/favorites

| 项 | 内容 |
|---|---|
| 状态 | **已部署**（Day 17 当天部署成功；Day 18 补记） |
| 方法 | `GET` |
| 鉴权 | 无 |
| 数据来源 | `favorites` 表联 `posts` 表 |

### 请求
```text
GET /api/favorites
```

### 成功响应 200
```json
{
  "ok": true,
  "data": [
    {
      "id": "f001",
      "post_id": "p001",
      "title": "面试时被问『为什么离开上一家公司』，别说真话",
      "author": "在职老张",
      "authorVerified": true,
      "category": "求职面试",
      "type": "opinion",
      "savedAt": "2026-10-05T19:00:00.000+08:00"
    }
  ]
}
```

### 字段说明
| 字段 | 含义 |
|---|---|
| `id` | 收藏记录 ID（f001 格式） |
| `post_id` / `title` / `author` / `authorVerified` / `category` / `type` | 被收藏帖子的信息（联表带出） |
| `savedAt` | 收藏时间 |

### 业务规则
- 只返回收藏了**存在且已过审**（`pending: false`）帖子的记录
- 按 `savedAt` 倒序
- 写入接口见下方 §10.1

---

## 10.1 收藏一篇帖子 POST /api/favorites

| 项 | 内容 |
|---|---|
| 状态 | **已部署**（Day 18 当天部署成功；Day 22 补记——本节之前一直误标「实现中」） |
| 方法 | `POST` |
| 鉴权 | 无（当前 MVP 还没有登录系统） |
| 数据去向 | 写入 `favorites` 表 |

### 请求
```text
POST /api/favorites
Content-Type: application/json
```

### 请求体
```json
{
  "post_id": "p001"
}
```

| 字段 | 类型 | 必填 | 说明 |
|---|---|---|---|
| `post_id` | string | ✅ | 要收藏的帖子编号，对应 `posts.id` |

### 成功响应 201
```json
{
  "ok": true,
  "favorite": {
    "id": "f1a2b3c4d5",
    "post_id": "p001",
    "title": "面试时被问『为什么离开上一家公司』，别说真话",
    "savedAt": "2026-10-06T08:22:13.412Z"
  }
}
```

### 字段说明
| 字段 | 含义 |
|---|---|
| `ok` | 固定 `true`，表示写入成功 |
| `favorite.id` | 本次生成的收藏编号（`f` + 时间戳 base36） |
| `favorite.post_id` | 被收藏的帖子编号 |
| `favorite.title` | 被收藏帖子的标题（接口顺带带出来，前端不用再查一次） |
| `favorite.savedAt` | 收藏时间，由数据库生成后原样退回 |

### 失败响应

**重复提交 → 409**（同一篇帖子已经收藏过）
```json
{
  "ok": false,
  "error": "帖子 p001 已经收藏过了，不能重复收藏"
}
```

**缺必填字段 → 400**
```json
{
  "ok": false,
  "error": "post_id 必填（要收藏的帖子编号）"
}
```

**请求体不是合法 JSON → 400**
```json
{
  "ok": false,
  "error": "请求体不是合法的 JSON"
}
```

**帖子不存在 → 404**
```json
{
  "ok": false,
  "error": "帖子 p999 不存在"
}
```

### 业务规则
- **判重口径（一篇帖只能被收藏一次）**：MVP 还没做登录，`favorites` 表没有 `user_id`，
  只能按帖子维度判重。等第 3 周后段做登录时，约束要改成 `UNIQUE (user_id, post_id)`。
- **判重由数据库保证，不是代码**：唯一约束 `favorites_post_unique UNIQUE (post_id)`，
  代码不预查、直接插，撞约束了再把数据库的 409 翻成中文提示。
  为什么不预查：并发两个请求可能都查到「还没收藏过」然后都插进去，代码判重挡不住这种情况。
- **收藏编号不查表生成**：`f` + 时间戳 base36，自带随机性，不用「查最大号 +1」——
  那是查完再插，两步之间有缝，并发会撞主键。
- 所有 `error` 提示一律中文
- 写入用 `Prefer: return=representation`，让数据库把插入的行原样退回，
  返回的 `id` / `created_at` 就是库里真实存的值

---

## 11. 热搜同步 /api/sync

| 项 | 内容 |
|---|---|
| 状态 | **已部署**（Day 17 当天部署成功；Day 18 补记） |
| 方法 | `POST`（手动触发） |
| 鉴权 | 无 |
| 数据去向 | 写入 `trends` 表 |
| 运行环境 | CloudBase 云函数，Node 内置 fetch，零第三方依赖 |

### 请求
```text
POST /api/sync
```

### 成功响应 200（三个平台都成功）
```json
{
  "ok": true,
  "date": "2026-10-05",
  "platforms": {
    "weibo":    { "ok": true, "count": 30 },
    "bilibili": { "ok": true, "count": 30 },
    "douyin":   { "ok": true, "count": 30 }
  }
}
```

### 部分失败响应 200（单平台失败不影响其他平台）
```json
{
  "ok": true,
  "date": "2026-10-05",
  "platforms": {
    "weibo":    { "ok": false, "error": "微博接口返回 403，通常是请求头缺少 Referer" },
    "bilibili": { "ok": true, "count": 30 },
    "douyin":   { "ok": true, "count": 30 }
  }
}
```

### 全部失败响应 200
```json
{ "ok": false, "error": "三个平台全部失败：微博 403；B站 412；抖音 列表为空" }
```

### 业务规则
- 数据源固定为三个官方公开接口（微博 / B站 / 抖音），不换聚合站
- 每平台取前 30 条，三平台**并行**抓取
- 必带请求头：桌面 UA + 各平台自己首页的 Referer
- 日期 `date` 按**北京时间（UTC+8）**计算（云函数默认 UTC，直接 toISOString() 在北京时间 0–8 点会算成前一天）
- 判重：唯一索引 `(platform, title, date)` + `INSERT ... ON CONFLICT ... DO UPDATE`，**同一个词条**重复同步不产生重复行
- ⚠️ 判重边界（Day 17 实测发现）：判重只认「平台+标题+日期」三项完全相同。热搜榜实时变动，两次抓取之间词条会洗牌——某词条掉出前 30、另一新词条补位，标题不同就判不了重，同一天会多出一行。实测第 2 次 sync 后抖音 30 → 31 行即此原因（非 bug）。要严格按「每日每平台固定条数」去重，需先删当日该平台的行再整批插入（列 Day 18 待办）
- SQL 一律参数化，禁止字符串拼接
- 全部失败时页面保留 seed 并标注「示例数据」

---

## 12. 第 3 周后段计划接口（未实现）

| 接口 | 方法 | 说明 | 当前状态 |
|---|---|---|---|
| `/api/auth/login` | `POST` | 用户登录，返回 token | 未实现 |
| `/api/auth/register` | `POST` | 用户注册 | 未实现 |
| `/api/auth/me` | `GET` | 获取当前登录用户信息 | 未实现 |
| `/api/upload/images` | `POST` | 图片上传（≤5 张，需单独审核） | 未实现 |
| `/api/comments/:id/like` | `POST` | 评论点赞 | 未实现 |
| `/api/comments/:id/report` | `POST` | 评论举报 | 未实现 |
| `/api/comments/:id/reply` | `POST` | 回复评论 | 未实现 |

> 以上接口依赖真实数据库、登录态、文件存储，按学习计划放到第 3 周后段实现；当前仅作为契约草案，细节实现时再补充。

---

## 13. 前端 mock 版部署信息

| 资源 | 公网地址 |
|---|---|
| mock 首页 | `https://falsity-mock003-falsity001-d1gowkogp40251a26.webapps.tcloudbase.com/` |
| `/api/health` | `https://falsity001-d1gowkogp40251a26-1499370664.ap-shanghai.app.tcloudbase.com/api/health` |

### mock 版数据回退策略
- 静态托管没有后端，首页加载 `/api/posts` 会失败
- 失败时自动回退读取同目录 `posts.json`
- 回退数据会按 `pending: false` 过滤并按 `createdAt` 倒序，与本地 `server.js` 行为一致

---

## 14. 改帖子 PATCH /api/post?id=xx（Day 22 新增）

| 项 | 内容 |
|---|---|
| 状态 | **已部署**（Day 22 当天部署并真机验证通过） |
| 方法 | `PATCH` |
| 鉴权 | 无（当前 MVP 还没有登录系统） |
| 数据去向 | 更新 `posts` 表 |

### 请求
```text
PATCH /api/post?id=p001
Content-Type: application/json
```

| 字段 | 类型 | 必填 | 约束 | 说明 |
|---|---|---|---|---|
| `title` | string | ❌ | 非空、≤ 200 字 | 标题 |
| `category` | string | ❌ | 非空、≤ 32 字 | 分类 |
| `views` | number | ❌ | **非负整数**、≤ 1 亿 | 浏览量 |

**至少要给一个字段**，一个都不给返回 400。

### 成功响应 200
```json
{
  "ok": true,
  "id": "p001",
  "changed": [
    { "field": "views", "before": 1580, "after": 1688 }
  ],
  "post": {
    "id": "p001",
    "type": "opinion",
    "category": "求职面试",
    "title": "面试时被问『为什么离开上一家公司』，别说真话",
    "author": "在职老张",
    "authorVerified": true,
    "views": 1688,
    "createdAt": "2026-09-15T10:30:00+08:00"
  }
}
```

### 字段说明
| 字段 | 含义 |
|---|---|
| `changed[]` | 只包含**实际动过的字段**，每项给改前/改后对比 |
| `changed[].before` | 改之前的值，**来自更新前的查询** |
| `changed[].after` | 改之后的值，**来自数据库的返回**（不是回显请求体） |
| `post` | 改完之后这一行的完整内容 |
| `ignoredFields` | 只在有传非白名单字段时出现，列出被无视的字段名 |

### 失败响应
**没有可改字段 → 400**
```json
{ "ok": false, "error": "没有可改的字段（可改：title / category / views）" }
```
**字段值不合法 → 400**
```json
{ "ok": false, "error": "views 必须是非负整数" }
```
**帖子不存在或待审核 → 404**
```json
{ "ok": false, "error": "帖子不存在或还在审核中" }
```
**id 缺失或格式不对 → 400**
```json
{ "ok": false, "error": "缺少 id 参数（用法：/api/post?id=p001）" }
```

### 业务规则
- **字段白名单**：只有 `title` / `category` / `views` 允许被改。
  传 `id` / `created_at` / `pending` / `author` 等系统字段会被**静默忽略**，
  并在响应的 `ignoredFields` 里明确列出——不无声吞掉（无声忽略是接口最大的坑之一：
  调用方会以为 `pending` 也改了）。
- **系统字段不可改的原因**：请求体是可以随便伪造的。不限制的话，
  传 `{id:'p999'}` 就能改掉记录编号、传 `{created_at:'1900-01-01'}` 就能改掉发布时间。
  这些是系统自己维护的字段，不属于「用户能编辑的内容」。
- **用 PATCH 不用 PUT**：PUT 语义是「整条替换，没传的字段会被清空」，
  我们要的是「只改点名的几个字段」。
- **`before` / `after` 都来自数据库**：`before` 来自更新前的查询，
  `after` 来自 PostgREST 的 `Prefer: return=representation`。
  **不用请求体原样回显**——万一数据库有默认值、触发器或类型转换，
  自己回显等于撒谎，页面上看着改了、库里其实不是那个值。
- **改之前先查一次**：这一遍查的既是 404 的判据，也是 `before` 的来源。
- **「更新 0 行」要单独判**：数据库对更新 0 行不报错（返回 200 + 空数组），
  不判的话上层拿到 `undefined` 再读 `.id` 会抛 TypeError，
  排查时只看到「Cannot read properties of undefined」，指不到「id 不存在」。
- `category` 不硬编码 6 个分类值：分类清单是产品约定，可能变；
  硬编码到后端，以后前端加一类就得后端发一次版。

###⚠️ 部署坑：OPTIONS 预检白名单必须放行 PATCH
浏览器把 PATCH / DELETE / PUT 算「非简单请求」，发出去之前**一定先问一句 OPTIONS**。
如果云函数的 `Access-Control-Allow-Methods` 没写上 `PATCH`，浏览器会直接判定「方法不允许」，
**根本不会把真正的 PATCH 请求发出去**。

它的可怕之处是**三重静默**：
- Network 里那条 PATCH 显示失败/ 被取消
- 浏览器 Console **一句红字都没有**（不是后端拒绝，是浏览器没发）
- 云函数日志里**什么都没有**（请求压根没到）

> 排查口诀：**改数据没反应 + 控制台无报错 + 服务器无日志 = 先怀疑预检白名单没放行这个方法。**

---

## 15. 删评论 DELETE /api/comments?id=xx（Day 22 新增）

| 项 | 内容 |
|---|---|
| 状态 | **已部署**（Day 22 当天部署并真机验证通过） |
| 方法 | `DELETE` |
| 鉴权 | 无（当前 MVP 还没有登录系统） |
| 数据去向 | 删除 `comments` 表里的一行 |

### 请求
```text
DELETE /api/comments?id=cmuz716qn
```

### 成功响应 200
```json
{
  "ok": true,
  "deleted": {
    "id": "cmuz716qn",
    "postId": "p006",
    "author": "宝宝",
    "body": "【Day 22 闭环测试】这条会被改完再删掉",
    "createdAt": "2026-10-08T15:06:49.055+08:00"
  }
}
```

### 字段说明
| 字段 | 含义 |
|---|---|
| `deleted.id` | 被删掉的评论编号 |
| `deleted.postId` | 它属于哪篇帖子 |
| `deleted.author` | 评论者昵称 |
| `deleted.body` | 评论正文——**删了就再也拿不回来，所以必须退回来** |
| `deleted.createdAt` | 评论时间 |

### 失败响应
**评论不存在 → 404**（不给「静默成功」）
```json
{ "ok": false, "error": "评论 cmuz716qn 不存在，没有删掉任何东西" }
```
**缺 id → 400**
```json
{ "ok": false, "error": "缺少 id 参数（用法：/api/comments?id=c001）" }
```

### 业务规则
#### ★ 为什么删的是评论、不是帖子
`posts`表被两张表用外键指着——`comments.post_id` 和 `favorites.post_id`
都 `REFERENCES posts(id)`。也就是说「删帖子」这个动作**数据库会直接挡下来**；
而且一旦那篇帖子有评论或收藏，光报错还不够用，你还得决定是「连评论一起删」
还是「先转移归属」——**这是产品决策，不是技术决策**。

评论是**叶子节点**：没有任何表指向 `comments`，删它不会牵连任何东西。
→ 用最安全的对象演示「不可逆」，真要做删除产品时再面对级联删除那摊事。

#### ★ 为什么删除比新增更容易出事
- **新增出错** → 最坏是多了一条脏数据。它还在那儿、看得见、能筛出来、能删掉。
- **删除出错** → 是「本来存在的东西没了」。当场没人报警（页面照样打开，只是少了一条），
  等发现时已经不可逆，备份也未必有。

#### ★ 落了的四道确认
| # | 确认 | 代码怎么做 |
|---|---|---|
| ① | 对象必须存在 | 删之前先查一次，不存在给 404|
| ② | id 必填且合法 | 缺 id / 格式不对给 400 |
| ③ | 限定能改的字段 | PATCH 用白名单（见 §14） |
| ④ | 写日志并带正文快照 | 删成功/ 被拒都记一条，日志里带正文前 40 字 |

#### 补充规则
- **查→ 删的顺序不能反**：必须先查到、拿定它长什么样，再删。
  顺序反了就变成「先删后看」，看不到就没法在删之前拒绝。
- **删除不幂等，重复删返回 404**：
  「删一条不存在的东西」有两种处理方式——返回成功（幂等）或返回 404。
  这里选 404，因为调用方是人点的按钮，不是一段要幂等跑的脚本，
  「我删的那条评论找不到」对用户是有意义的信息。
- **回执必须带正文**：一旦 DELETE 成功就再也拿不回正文了。
  不留这一笔的话，用户投诉「我那条评论怎么没了」，日志里只有一个光秃秃的 id，谁也认不出是哪条。
- **同一个 `/comments` 路径配不同方法**：`POST` 是发评论，`DELETE` 是删评论。
  这样做是因为 CloudBase HTTP 网关按「路径」绑定路由、不区分方法，
  同一路径配多个方法**不用去控制台多绑一条**，省一次部署期操作。

---

## 16. 四类操作闭环（Day 22 验证记录）

| 类别 | 接口 | 实测 |
|---|---|---|
| 增 POST | `/api/comments` | 201，新建 id `cmuz716qn` |
| 查 GET | `/api/post?id=…` | 200，删前返回该条、删后返回空数组 |
| 改 PATCH | `/api/post?id=p001` | 200，`before 1580 → after 1688`，再查确认落库 |
| 删 DELETE | `/api/comments?id=…` | 200，回执带正文；再删一次返回 404 |

验证脚本：`day22-crud-live.mjs`（真环境 26 项全过）、
`day22-local-check.cjs`（本地假 db 42 项全过）、
`day22-delete-live.mjs`（真环境 17 项全过）。

> PATCH 改完后专门查了列表接口 `/api/posts`，确认 p001 的 views 也是新值——
> **证明「改」没有把别的接口搞坏**。改数据时一定要顺手回归一下读它的那些接口。

---

## 17. 已知缺口（Day 22 收尾时仍未做）

| 缺口 | 说明 |
|---|---|
| 余力加练：软删除 |清单里的余力项（`is_deleted` 标记代替真删）**未做**，待老大决定 |
| PATCH 文案 | 有一处错误提示里夹了英文词（`non-empty`），待改成纯中文 |
| 真实登录鉴权 | PATCH / DELETE 目前**无鉴权**，任何人拿到 id 就能改/删。这是 MVP 阶段的已知风险，做登录时要补「只允许改自己的」 |
| 批量操作 | 清单明确今日不做 |

