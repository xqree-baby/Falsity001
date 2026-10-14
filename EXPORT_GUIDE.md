# 数据库 · 部署 · 额度 · 到期 · 备份说明

> 验收表最后一项要求：「到期时间、计费状态和数据导出说明」。
> 本文件一次写齐，含密钥不外泄的做法。

---

## 一、数据库

| 项 | 内容 |
|---|---|
| 类型 | PostgreSQL（CloudBase 云开发「SQL 型数据库」） |
| 环境 id | `falsity001-d1gowkogp40251a26` |
| schema | `public`（CloudBase 默认，也是能用 REST API 访问的那个） |
| 表 | `posts`（帖子）/ `comments`（评论）/ `trends`（热搜）/ `favorites`（收藏） |
| 建表脚本 | `db/schema.sql` —— 可重复执行（`CREATE TABLE IF NOT EXISTS`） |
| 种子脚本 | `db/seed.sql` —— 幂等，语义是「清空重灌」 |

**关系**：`comments.post_id → posts.id`（一对多）、`favorites.post_id → posts.id`（一篇帖可被多人收藏）

**字段约定**（踩过的坑都在这）：

- 时间戳统一 `TIMESTAMPTZ`（带时区，存 `+08:00` 不失真）
- 数据库列名是**蛇形**（`created_at` `author_verified`），接口层转**驼峰**（`createdAt` `authorVerified`），只有 `db.js` 知道这层转换
- `posts.type` 有 CHECK 约束（`opinion`/`question`），代码里也校验一次，双重把关

### 连接方式

后端**不直连数据库**，走 CloudBase 托管的 PostgREST，用环境变量注入凭据：

| 环境变量 | 用途 |
|---|---|
| `CLOUDBASE_API_KEY` | 调用 PostgREST 的密钥 |

⚠️ **密钥不进代码、不进提交**。`.gitignore` 里明确挡了 `.env` 和 `.env.*`（保留 `.env.example`）。
28 天里做过两次全仓库密钥扫描，命中 0 条。

---

## 二、部署

### 静态托管（前端）

| 项 | 内容 |
|---|---|
| 服务 | falsitymock00v1（`falsitymock00v1-falsity001-d1gowkogp40251a26.webapps.tcloudbase.com`） |
| 部署方式 | 控制台 → 静态网站托管 → **上传** → **本地项目上传** |
| 类型 | **文件夹**（选「文件」只会传一个 html，样式全丢） |
| 源目录 | `public/`（6 个文件） |
| 框架 | 其他（无构建步骤） |
| 目标路径 | `/` |

**⚠️ 覆盖上传同一个服务，域名不变**；只有**新建独立服务**才会产生新域名。

### 云函数（后端）

| 项 | 内容 |
|---|---|
| 函数 | `api`（HTTP 云函数，`http.createServer` + `listen(9000)`，**不能写 `exports.main`**） |
| 网关 | `https://falsity001-d1gowkogp40251a26-1499370664.ap-shanghai.app.tcloudbase.com/api` |
| 代码 | `functions/api/index.js`（业务分发）+ `functions/api/db.js`（数据访问） |
| 部署 | 控制台 → 云函数 → `api` → 编辑代码粘贴 → 部署 |

⚠️ **Web 云函数不能写 `exports.main`**，必须是 HTTP 服务，否则网关收不到。
⚠️ **CORS 别配两遍**：网关自己会加 ACAO，函数里再加 `*` 会变成两个值逗号拼接，浏览器直接掐掉。前端只会看到 `Failed to fetch` 连状态码都读不到。

---

## 三、额度与到期（Day 27 实测）

| 项 | 数值 |
|---|---|
| 套餐 | 云开发免费体验版（不支持自动续费） |
| 额度总额 | **3000 资源点** |
| 有效期至 | **2027-04-04** |
| 周期内已用 | 342.98 点（约 11.4%） |
| 统计周期 | 2026-10-04 ～ 2026-11-04（当前套餐周期） |

**⚠️ 额度是跟随套餐有效期的总池子，不是每月重发。** 所以不能按「每月 3000 点」来规划。

**消耗构成**：PostgreSQL 327.64 点（**占 95%**）/ 云函数 5.35 点。

**风险判断**：数据库用量会随真实用户发帖、评论**线性增长**。当前 7 帖规模毫无压力，用户量上来后数据库是唯一需要盯的项。

查看入口：CloudBase 控制台 → 套餐用量 → 基本信息 / 用量明细。

---

## 四、数据导出说明

### 场景一：只导帖子正文（最常用）

不用连数据库，**直接调接口导出 JSON**。在浏览器或任意 HTTP 工具里：

```
GET https://falsity001-d1gowkogp40251a26-1499370664.ap-shanghai.app.tcloudbase.com/api/posts
```

返回 `{ok, count, posts:[...]}`，另存为 `.json` 即完成。

⚠️ 这个接口**只返回已过审的帖子**（`pending=true` 被过滤），要导出待审的得走第 3 节的管理员路径。

### 场景二：导出全部数据（含评论、收藏）

1. CloudBase 控制台 → **SQL 型数据库** → PostgreSQL 管理
2. 点「数据导入导出」或用客户端工具连接
3. 导出语句：

```sql
-- 帖子
SELECT * FROM posts ORDER BY created_at DESC;
-- 评论（含帖子标题，便于阅读）
SELECT c.*, p.title AS post_title
FROM comments c LEFT JOIN posts p ON p.id = c.post_id
ORDER BY c.created_at DESC;
-- 收藏（含帖子标题）
SELECT f.*, p.title AS post_title
FROM favorites f LEFT JOIN posts p ON p.id = f.post_id;
-- 热搜
SELECT * FROM trends ORDER BY date DESC;
```

### 场景三：导出成 CSV（给 Excel 看）

PostgreSQL 没有自带 `SELECT ... INTO OUTFILE` 的浏览器版本，用 SQL 编辑器的结果集导出功能，
或把上面的结果集另存为 CSV。

### 场景四：备份整个数据库

**用 `db/schema.sql` + 真实数据重建**是最稳的做法：

1. 导出四张表的数据（上面的 SELECT 语句）
2. 新建环境时执行 `db/schema.sql` 建表
3. 再把导出的数据 INSERT 回去

`schema.sql` 可重复执行，不会因为「表已存在」报错。

### ⚠️ 导出时必须注意

| 事项 | 原因 |
|---|---|
| **绝不导出密钥** | PostgREST 调用密钥在环境变量里，不在表里；但导出时别顺手把 `.env` 一起打包 |
| 导出文件别提交进 git | 真实用户数据属于隐私，`.gitignore` 挡了 `.env`，但 CSV/JSON 导出文件需自己注意 |
| 导出后核对行数 | `SELECT COUNT(*)` 与导出条数对照，防止截断 |

---

## 五、当前未完成项（诚实标注）

**审核页从未接后端。** 前端 `loadAdmin()` 请求相对路径 `/api/admin/pending`，打到静态托管自己名下；
网关侧该路由也未绑定。这条影响验收表「完整链路」一项，详见 `day28-附录J.md` 第四节。

修法（三步）也写在那里。
