# Falsity 接口契约（api-contract.md）

> 版本：Day 15  mock 版  
> 说明：本文档记录 Falsity 项目对外暴露的 HTTP 接口。状态分为三类：
> - **已部署**：已在 CloudBase 公网可访问  
> - **仅本地**：`server.js` 已实现，但未部署到 CloudBase（静态 mock 版不包含后端）  
> - **未实现**：Day 16–20 及后续计划要补的接口，当前只有契约草案  

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

## 9. Day 16–20 计划接口（未实现）

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

## 10. 前端 mock 版部署信息

| 资源 | 公网地址 |
|---|---|
| mock 首页 | `https://falsity-mock003-falsity001-d1gowkogp40251a26.webapps.tcloudbase.com/` |
| `/api/health` | `https://falsity001-d1gowkogp40251a26-1499370664.ap-shanghai.app.tcloudbase.com/api/health` |

### mock 版数据回退策略
- 静态托管没有后端，首页加载 `/api/posts` 会失败
- 失败时自动回退读取同目录 `posts.json`
- 回退数据会按 `pending: false` 过滤并按 `createdAt` 倒序，与本地 `server.js` 行为一致
