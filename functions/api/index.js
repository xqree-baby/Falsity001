// Day 17｜「api」云函数（Web 函数版）
// 用途：一个函数按路径分发三个接口——
//   GET  /api/hot        今日热搜（读 trends 表）
//   GET  /api/favorites  收藏列表（favorites 联 posts，只返回已过审帖子）
//   POST /api/sync       抓微博/B站/抖音真实热搜写回 trends（手动触发，判重不重复插行）
// 运行环境：CloudBase Web 函数（必须自己 createServer + listen(9000)，不能写 exports.main）
// 依赖：零第三方包，只用 Node 内置能力（fetch 为 Node 18+ 内置）
// 数据库访问：CloudBase PostgreSQL 的 REST API（PostgREST 协议）
//   地址  https://{环境ID}.api.tcloudbasegateway.com/v1/rdb/rest/{表名}?查询参数
//   鉴权  Authorization: Bearer <API Key>
//   Key 配在函数环境变量 CLOUDBASE_API_KEY 里——不进代码、不进仓库（规矩五.3）
//   API Key = service_role 角色：绕过 RLS，服务端专用，绝不能下发到前端
// 路由兼容：网关可能把 /api/xxx 前缀剥掉再转发（Day 15 health 函数收到的是 "/"），
//   所以 /hot 和 /api/hot 两种路径都认

const http = require('http');

const ENV_ID = 'falsity001-d1gowkogp40251a26';
const DB_BASE = `https://${ENV_ID}.api.tcloudbasegateway.com/v1/rdb/rest`;
const API_KEY = process.env.CLOUDBASE_API_KEY || '';

const PORT = 9000; // Web 函数固定监听 9000，平台把 HTTP 请求转发进来

// ---------------- 小工具 ----------------

// 北京时间（UTC+8）的今天，格式 YYYY-MM-DD
// 坑：云函数系统时区是 UTC。北京时间 00:00–08:00 之间，UTC 还是「昨天」，
//     直接 new Date().toISOString() 取日期会把同一天的榜单写成两批。
//     办法：时间戳 + 8 小时再取 ISO 日期，得到的就是北京日期。
function beijingToday() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// 统一 JSON 出口：带 CORS 头（页面在 webapps 域名，接口在 gateway 域名，跨域）
function json(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
  });
  res.end(JSON.stringify(obj));
}

// 带超时的 fetch + JSON 解析（抓外部接口用，防止对面挂了把我们拖死）
async function fetchJson(url, headers, timeoutMs = 15000) {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetch(url, { headers, signal: ctrl.signal });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.json();
  } finally {
    clearTimeout(timer);
  }
}

// ---------------- 数据库访问层（PostgREST） ----------------

// 读表：GET /v1/rdb/rest/{表}?select=...&过滤=...&order=...
async function dbGet(pathAndQuery) {
  if (!API_KEY) throw new Error('CLOUDBASE_API_KEY 未配置（在云函数环境变量里加 CLOUDBASE_API_KEY）');
  const res = await fetch(`${DB_BASE}/${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${API_KEY}`, Accept: 'application/json' },
  });
  if (!res.ok) throw new Error(`数据库 REST API 返回 ${res.status}：${(await res.text()).slice(0, 200)}`);
  return res.json();
}

// upsert 写入：POST + Prefer: resolution=merge-duplicates
// 「存在则更新、不存在则插入」，冲突判定列用查询参数 on_conflict 指定。
// 值全部走 JSON 请求体（PostgREST 天然参数化），不存在 SQL 拼接。
async function dbUpsertTrends(rows) {
  if (!API_KEY) throw new Error('CLOUDBASE_API_KEY 未配置（在云函数环境变量里加 CLOUDBASE_API_KEY）');
  const res = await fetch(`${DB_BASE}/trends?on_conflict=platform,title,date`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'resolution=merge-duplicates', // 重复同步不产生重复行
    },
    body: JSON.stringify(rows),
  });
  if (!res.ok) throw new Error(`数据库 REST API 返回 ${res.status}：${(await res.text()).slice(0, 200)}`);
}

// ---------------- 三个平台的抓取定义（附录 F） ----------------

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

const PLATFORMS = [
  {
    name: 'weibo',
    url: 'https://weibo.com/ajax/side/hotSearch',
    referer: 'https://weibo.com',
    // 微博字段：data.realtime[].word / .num / .realpos（realpos 个别条目缺失，用下标兜底）
    pick: (d) =>
      ((d.data && d.data.realtime) || []).slice(0, 30).map((x, i) => ({
        title: x.word,
        hot: x.num || 0,
        rank: x.realpos || i + 1,
      })),
    failHint: '微博接口返回 403，通常是请求头缺少 Referer',
  },
  {
    name: 'bilibili',
    url: 'https://api.bilibili.com/x/web-interface/search/square?limit=50',
    referer: 'https://www.bilibili.com',
    // B站字段：data.trending.list[].keyword / .heat_score
    // ★ B站接口不返回排名字段——rank 用数组下标 + 1 补（这就是「接口数据和表对不上」的实例）
    pick: (d) =>
      ((d.data && d.data.trending && d.data.trending.list) || []).slice(0, 30).map((x, i) => ({
        title: x.keyword,
        hot: x.heat_score || 0,
        rank: i + 1,
      })),
    failHint: 'B站接口返回 412，通常是 User-Agent 不是桌面浏览器',
  },
  {
    name: 'douyin',
    url: 'https://www.douyin.com/aweme/v1/web/hot/search/list/?device_platform=webapp&aid=6383',
    referer: 'https://www.douyin.com',
    // 抖音字段：data.word_list[].word / .hot_value / .position
    pick: (d) =>
      ((d.data && d.data.word_list) || []).slice(0, 30).map((x, i) => ({
        title: x.word,
        hot: x.hot_value || 0,
        rank: x.position || i + 1,
      })),
    failHint: '抖音返回 200 但列表为空，通常是请求头缺少 Referer',
  },
];

// ---------------- 三个接口的实现 ----------------

// GET /api/hot —— 今日热搜
async function handleHot(req, res, query) {
  let date = query.get('date') || beijingToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json(res, 400, { ok: false, error: 'date 参数格式应为 YYYY-MM-DD' });
  }
  const rows = await dbGet(
    `trends?select=platform,title,hot,rank,date,fetched_at` +
      `&date=eq.${date}&order=platform.asc,rank.asc&limit=200`
  );
  return json(res, 200, { ok: true, date, data: rows });
}

// GET /api/favorites —— 收藏列表（联表只返回已过审帖子）
async function handleFavorites(req, res) {
  // PostgREST 嵌套查询：posts(...) 表示顺着外键把关联帖子的字段带出来
  // posts.pending=eq.false 过滤掉「收藏了但帖子还没过审/已进待审核」的记录
  const rows = await dbGet(
    `favorites?select=id,post_id,created_at,posts(title,author,author_verified,category,type)` +
      `&posts.pending=eq.false&order=created_at.desc&limit=100`
  );
  return json(res, 200, {
    ok: true,
    data: rows.map((r) => ({
      id: r.id,
      post_id: r.post_id,
      title: r.posts.title,
      author: r.posts.author,
      authorVerified: r.posts.author_verified,
      category: r.posts.category,
      type: r.posts.type,
      savedAt: r.created_at,
    })),
  });
}

// POST /api/sync —— 抓三平台热搜写库（三平台并行，单平台失败不影响其他）
async function handleSync(req, res) {
  const date = beijingToday();            // 榜单日期按北京时间
  const fetchedAt = new Date().toISOString();

  // 三个平台并行抓；每个平台自己 try/catch，互不拖累
  const results = await Promise.all(
    PLATFORMS.map(async (p) => {
      try {
        const data = await fetchJson(p.url, { 'User-Agent': UA, Referer: p.referer });
        const items = p.pick(data);
        if (items.length === 0) throw new Error(p.failHint);
        return { platform: p.name, items, ok: true, count: items.length };
      } catch (e) {
        return { platform: p.name, items: [], ok: false, error: `${p.name} 抓取失败：${e.message}。${p.failHint}` };
      }
    })
  );

  // 汇总各平台结果 + 拼出待写入行
  const platforms = {};
  let allRows = [];
  for (const r of results) {
    platforms[r.platform] = r.ok ? { ok: true, count: r.count } : { ok: false, error: r.error };
    for (const it of r.items) {
      allRows.push({
        platform: r.platform,
        title: it.title,
        hot: Number(it.hot) || 0,
        rank: Number(it.rank) || 0,
        date,
        fetched_at: fetchedAt,
      });
    }
  }

  // 三个平台全失败：ok=false，页面保留 seed 并标注「示例数据」
  if (allRows.length === 0) {
    return json(res, 200, {
      ok: false,
      error: `三个平台全部失败：${results.map((r) => r.error).join('；')}`,
    });
  }

  // 写库（upsert 判重）；写失败把已抓到的平台结果一并带回，方便排查
  try {
    await dbUpsertTrends(allRows);
  } catch (e) {
    return json(res, 200, {
      ok: false,
      error: `抓到了 ${allRows.length} 条，但写入数据库失败：${e.message}`,
      platforms,
    });
  }

  return json(res, 200, { ok: true, date, platforms });
}

// ---------------- HTTP 服务器（Web 函数入口） ----------------

const server = http.createServer(async (req, res) => {
  // CORS 预检：浏览器跨域调用前会先发 OPTIONS 探路
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  const u = new URL(req.url, 'http://localhost');
  let path = u.pathname.replace(/\/+$/, '') || '/';
  if (path.startsWith('/api/')) path = path.slice(4); // /api/hot -> /hot（网关前缀兼容）

  try {
    if (req.method === 'GET' && path === '/hot') return await handleHot(req, res, u.searchParams);
    if (req.method === 'GET' && path === '/favorites') return await handleFavorites(req, res);
    if (req.method === 'POST' && path === '/sync') return await handleSync(req, res);

    // 404 时带回收到的原始路径，部署后如果路由不对，看这个字段就知道函数实际收到了什么
    return json(res, 404, { ok: false, error: 'not found', receivedPath: req.url });
  } catch (e) {
    // 503 = 没配 Key（部署问题）；502 = 数据库访问失败（链路问题）
    const status = /CLOUDBASE_API_KEY/.test(e.message) ? 503 : 502;
    return json(res, status, { ok: false, error: e.message });
  }
});

server.listen(PORT, () => {
  console.log(`api function listening on port ${PORT}`);
});
