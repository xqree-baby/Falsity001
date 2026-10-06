# Falsity 接口契约（api-contract.md）

> 版本：Day 18  POST 写入接口版  
> 说明：本文档记录 Falsity 项目对外暴露的 HTTP 接口。状态分为三类：  
> - **已部署**：已在 CloudBase 公网可访问  
> - **实现中**：Day 18 正在实现，目标当天部署  
> - **仅本地**：`server.js` 已实现，但未部署到 CloudBase（静态 mock 版不包含后端）  
> - **未实现**：后续计划要补的接口，当前只有契约草案  

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
| 状态 | **仅本地**（`server.js` 已实现） |
| 方法 | `GET` |
| 鉴权 | 无 |

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

## 3. 单篇帖子 /api/posts/:id

| 项 | 内容 |
|---|---|
| 状态 | **仅本地** |
| 方法 | `GET` |
| 鉴权 | 无 |

### 请求
```text
GET /api/posts/p001
```

### 成功响应 200
```json
{
  "post": { ... }
}
```

### 失败响应 404
```json
{ "error": "not found" }
```

### 业务规则
- 未通过审核（`pending: true`）的帖子不可见

---

## 4. 发表评论 /api/posts/:id/comments

| 项 | 内容 |
|---|---|
| 状态 | **仅本地** |
| 方法 | `POST` |
| 鉴权 | 无 |

### 请求体
```json
{
  "author": "匿名",
  "body": "亲测有效。"
}
```

### 成功响应 201
```json
{
  "comment": {
    "id": "c003",
    "author": "匿名",
    "body": "亲测有效。",
    "createdAt": "2026-10-04T13:35:00.000Z"
  }
}
```

### 失败响应
- `400`：`{ "error": "body 必填" }`
- `404`：`{ "error": "not found" }`（帖子不存在或未审核）

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
| 状态 | **实现中**（Day 18 目标：部署） |
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
