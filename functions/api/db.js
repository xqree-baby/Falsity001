// Day 19 建：数据访问层
// 职责：唯一知道「表叫什么、PostgREST 查询语法怎么写、鉴权头怎么带」的文件。
//   业务层（index.js）只说「我要找这篇帖子」，不关心它怎么找——两边靠下面五个函数对话。
// 为什么单独拆：PostgREST 的语法、表名、字段名是数据库实现的细节。
//   不拆的话这些字符串会散在四个 handler 里，改一次数据库写法要翻四个文件，
//   而散开的代码只有最新那处被仔细测过。拆开后改这里就够了。
// 依赖：零第三方包，只用 Node 内置 fetch（Node 18+）。不 require 任何东西，两层之间只留函数调用。
// 不进数据库、不改字段、不改接口契约：这个文件只做「把现有的五种查法搬过来」，
//   搬之前和搬之后的 SQL 完全一致——重构不是改行为。

// ---------------- 数据库连接参数 ----------------

const ENV_ID = 'falsity001-d1gowkogp40251a26';
const DB_BASE = `https://${ENV_ID}.api.tcloudbasegateway.com/v1/rdb/rest`;

// Key 从环境变量读，不写死在代码里（规矩五.3：密钥不进代码不进仓库）
// service_role 角色：绕过 RLS，服务端专用，绝不能下发到前端
const API_KEY = process.env.CLOUDBASE_API_KEY || '';

// ---------------- 两个底层工具（不对外，仅本文件内部用） ----------------

// 检查 Key 有没有配。没配就抛这个错，最外层靠它把状态码翻成 503（部署问题，不是链路问题）
function requireKey() {
  if (!API_KEY) {
    throw new Error('CLOUDBASE_API_KEY 未配置（在云函数环境变量里加 CLOUDBASE_API_KEY）');
  }
}

// 读表：GET /v1/rdb/rest/{表名}?select=...&过滤=...&order=...
// pathAndQuery 是拼好的「表名?查询串」，例如 `posts?id=eq.p001&select=id`
async function dbGet(pathAndQuery) {
  requireKey();
  const res = await fetch(`${DB_BASE}/${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' },
  });
  if (!res.ok) {
    throw new Error(`数据库 REST API 返回 ${res.status}：${(await res.text()).slice(0, 200)}`);
  }
  return res.json();
}

// ---------------- 下面六个是对外的函数（业务层只用这些） ----------------

// 查「已过审」的帖子列表，按发布时间倒序（Day 20 新增：给首页帖子区用）。
// 为什么要单独一条查询而不是复用 listFavoritesWithPosts：
//   帖子列表和收藏列表是两种不同的业务问题——前者问「全站有哪些帖子」，
//   后者问「谁收藏了什么」。硬凑成一个函数会让调用方为了拿帖子也得先造一条收藏记录。
// pending=eq.false：只看已过审的，与本地 server.js 和前端 posts.json 回退的行为保持一致。
// ⚠️ 注意排序键：PostgreSQL 的 created_at 是 TIMESTAMPTZ，带时区。
//   直接 order=created_at.desc 由数据库按绝对时间排，跨时区也可靠，
//   不要在代码里拿到字符串再按字典序排（那样会在时区偏移时错位）。
async function listApprovedPosts() {
  return dbGet(
    `posts?select=id,type,category,title,body,author,author_verified,pending,views,created_at` +
      `&pending=eq.false&order=created_at.desc&limit=100`
  );
}

// 查某几篇帖子各自有多少条评论（Day 20 追加）。
// 为什么单独查而不是让帖子查询顺带带出来：PostgREST 的嵌套查询要在 select 里写
//   comments(count)，但 count 是聚合结果、类型和普通行不一样，容易踩坑；
//   更重要的是卡片上要显示的其实是「评论条数」这一个数字，不是评论内容，
//   单独查一张小表（id, post_id, count）比拼内容再前端数一遍省得多，
//   也避免「帖子列表接口把评论正文全带出来」——那是详情页才需要的量。
// 入参：帖子编号数组；返回：{ p001: 3, p002: 0, ... }（没有评论的帖子也会给 0）
async function countCommentsByPost(postIds) {
  if (postIds.length === 0) return {};
  const rows = await dbGet(
    `comments?select=post_id&post_id=in.(${postIds.join(',')})&limit=1000`
  );
  // PostgREST 在只有 select 一个字段时可能直接返回数组，也可能返回 [{post_id:...}]；
  // 两种都兜住，并且只数每个 post_id 出现了几次。
  const counts = {};
  for (const id of postIds) counts[id] = 0; // 先给全部帖子补0，避免「没评论」在页面上变成 undefined
  for (const r of rows) {
    const pid = r.post_id;
    if (pid in counts) counts[pid] += 1;
  }
  return counts;
}

// 找一篇帖子。用来回答「这个 post_id 对应的帖子存在吗、是什么状态」——
// 收藏前要确认帖子真实存在，而不是只靠外键报错（外键报错不好读，给前端一句人话更有用）。
// 返回：帖子对象（找不到返回 undefined）；只取 id/title/pending 三个字段，别的不要
async function findPostById(postId) {
  const rows = await dbGet(
    `posts?id=eq.${encodeURIComponent(postId)}&select=id,title,pending&limit=1`
  );
  return rows[0];
}

// 查某一天的热搜。返回该日三个平台的全部词条，按平台分组、组内按排名升序。
// 返回：[{ platform, title, hot, rank, date, fetched_at }, ...]（可能为空数组）
async function findTrendsByDate(date) {
  return dbGet(
    `trends?select=platform,title,hot,rank,date,fetched_at` +
      `&date=eq.${date}&order=platform.asc,rank.asc&limit=200`
  );
}

// 收藏列表（联表带出帖子信息，只返回已过审帖子）。
// PostgREST 嵌套查询：posts(...) 表示顺着外键把关联帖子的字段带出来；
// posts.pending=eq.false 过滤掉「收藏了但帖子还没过审/已进待审核」的记录。
// ⚠️ 待验证（Day 19 实测留下的疑点，本文件按原样搬迁、没有加防御）：
//   Day 18 的记录说PostgREST 遇到被过滤掉的父行时，会把关联对象置成 null 而不是删整行，
//   并称当时加了 .filter(r => r.posts) 修复。但查 Day 18 的实际提交（0cff7c4），
//   代码里并没有这个 filter，而且当时线上接口返回正常（200）。
//   → 也就是说「posts 会变 null」这个坑目前只是推断，没有真实触发过。
//   → 本次重构按「不改行为」原则原样搬迁（Day 19 选项 1），不加 filter。
//   → 若将来出现「某条收藏的帖子被删/进待审核」导致本接口整体 502，
//     就在 index.js 的 handleFavorites 里加 .filter(r => r.posts)，那是正确的修法。
// 返回：[{ id, post_id, created_at, posts: {...} | null }, ...]
//     注意：posts 理论上可能是 null，调用方读 r.posts.title 前最好先判断。
async function listFavoritesWithPosts() {
  return dbGet(
    `favorites?select=id,post_id,created_at,posts(title,author,author_verified,category,type)` +
      `&posts.pending=eq.false&order=created_at.desc&limit=100`
  );
}

// 插入一条收藏记录，返回数据库真正存进去的那一行。
// 用 Prefer: return=representation 让数据库把插入的行原样退回，
// 这样返回给前端的 id / created_at 就是库里真实存的值，不用自己猜。
// 重复提交不在这里判断——直接插，让 UNIQUE(post_id) 报错，
// 调用方靠catch 里的 dbStatus === 409 判断「已经收藏过」。
async function insertFavorite(row) {
  requireKey();
  const res = await fetch(`${DB_BASE}/favorites`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify([row]),
  });
  if (!res.ok) {
    // 把数据库的原始报错带上去，调用方要靠它判断是「重复」还是别的错
    const e = new Error(`数据库 REST API 返回 ${res.status}：${(await res.text()).slice(0, 300)}`);
    e.dbStatus = res.status; //409 = 唯一约束撞了；503 = 网关/权限问题
    throw e;
  }
  const rows = await res.json();
  return rows[0];
}

// 批量写入热搜（upsert = 存在则更新、不存在则插入）。
// 冲突判定列用 on_conflict 指定，同一个词条重复同步不会产生重复行。
// 值全部走 JSON 请求体（PostgREST 天然参数化），不存在 SQL 拼接。
async function upsertTrends(rows) {
  requireKey();
  const res = await fetch(`${DB_BASE}/trends?on_conflict=platform,title,date`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates',
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) {
    throw new Error(`数据库 REST API 返回 ${res.status}：${(await res.text()).slice(0, 200)}`);
  }
}

// 只导出业务层需要的六个函数。
// dbGet / requireKey / DB_BASE 这些一律不导出——业务层不该有绕过去路的办法，
// 想查什么就从这六个里挑，或者以后真需要新的查法时在这里加一个函数。
module.exports = {
  listApprovedPosts,
  countCommentsByPost,
  findPostById,
  findTrendsByDate,
  listFavoritesWithPosts,
  insertFavorite,
  upsertTrends,
};