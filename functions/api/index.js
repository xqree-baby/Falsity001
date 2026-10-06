// Day 17 建（Day 18 追加写入接口）
// 用途：一个函数按路径分发四个接口——
//   GET  /api/hot        今日热搜（读 trends 表）
//   GET  /api/favorites  收藏列表（favorites 联 posts，只返回已过审帖子）
//   POST /api/favorites  收藏一篇帖子（Day 18 新增，第一个写入接口）
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

// 读完请求体（Web 函数里 req 是 IncomingMessage，流要自己收完）
// 有大小上限：防止有人 POST 一个几百 MB 的body 把函数内存吃光
function readBody(req, limitBytes = 64 * 1024) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > limitBytes) {
        reject(new Error('请求体太大'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
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

// 插入 favorites 一行；PostgREST 用 Prefer: return=representation 让数据库把插入的行原样退回，
// 这样返回给前端的 id / created_at 就是库里真实存的值，不用自己猜。
// 重复提交不在这里判断——直接插，让 UNIQUE(post_id) 报错（见下方 handleFavorite 的 catch）。
async function dbInsertFavorite(row) {
  if (!API_KEY) throw new Error('CLOUDBASE_API_KEY 未配置（在云函数环境变量里加 CLOUDBASE_API_KEY）');
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
    e.dbStatus = res.status;
    throw e;
  }
  const rows = await res.json();
  return rows[0];
}

// 生成收藏编号：f + 时间戳 base36（如 f1a2b3c4d5）。
// 为什么不用「查表里最大 fXXX 再 +1」：那是查完再插，两步之间有缝，
// 并发两个请求会拿到同一个号、第二个撞主键报错。id 自己带随机性就不用查表。
// 为什么不用自增整数：posts/comments 都沿用 p001/c001 字符串主键，保持全库风格一致。
function newFavoriteId() {
  return 'f' + Date.now().toString(36);
}

// ---------------- 一条日志（Day 18 余力加练：方便以后排查问题） ----------------
// 只记「谁、做了什么、对哪条记录、成功还是被拒」，不带请求体正文——
// 帖子内容属于用户数据，不进日志。
function logLine(event, detail) {
  console.log(`[${new Date().toISOString()}] [${event}] ${detail}`);
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

// POST /api/favorites —— 收藏一篇帖子（Day 18 新增：第一个写入接口）
async function handleFavorite(req, res) {
  // 1) 读请求体。Web 函数里 req 是 IncomingMessage，流要自己读完；空体是正常情况（用户就是没传）
  const raw = await readBody(req);
  let body;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch (e) {
    return json(res, 400, { ok: false, error: '请求体不是合法的 JSON' });
  }

  // 2) 校验必填字段。提示一律中文——这是完成标准之一。
  //    顺带挡掉前端漏传/传空串/传非对象这几种脏输入，都归到同一个提示，不给用户看内部细节。
  const postId = typeof body.post_id === 'string' ? body.post_id.trim() : '';
  if (!postId || typeof body !== 'object' || Array.isArray(body)) {
    logLine('favorite.reject', `原因=缺 post_id`);
    return json(res, 400, { ok: false, error: 'post_id 必填（要收藏的帖子编号）' });
  }

  // 3) 确认帖子真的存在（外键 favorites_post_fk 也拦一道，但数据库报错不好读，
  //    这里先查一次，好给前端一句人话：「这篇帖子不存在」而不是「外键冲突」）
  const [post] = await dbGet(`posts?id=eq.${encodeURIComponent(postId)}&select=id,title,pending&limit=1`);
  if (!post) {
    logLine('favorite.reject', `post_id=${postId} 原因=帖子不存在`);
    return json(res, 404, { ok: false, error: `帖子 ${postId} 不存在` });
  }

  // 4) 写入。判重不在代码里做——直接插，让 UNIQUE(post_id) 报重复（唯一真相来源）
  const id = newFavoriteId();
  try {
    const saved = await dbInsertFavorite({ id, post_id: postId, created_at: new Date().toISOString() });
    logLine('favorite.ok', `id=${saved.id} post_id=${postId}`);
    return json(res, 201, {
      ok: true,
      favorite: {
        id: saved.id,
        post_id: saved.post_id,
        title: post.title,
        savedAt: saved.created_at,
      },
    });
  } catch (e) {
    // 409 Conflict = 唯一约束撞了 = 这篇帖子已经收藏过，这就是「重复提交被拒」
    if (e.dbStatus === 409) {
      logLine('favorite.reject', `id=${id} post_id=${postId} 原因=重复提交`);
      return json(res, 409, { ok: false, error: `帖子 ${postId} 已经收藏过了，不能重复收藏` });
    }
    logLine('favorite.error', `post_id=${postId} 错误=${e.message}`);
    throw e; // 交给最外层的 catch：503/502 + 原始报错
  }
}

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
    if (req.method === 'POST' && path === '/favorites') return await handleFavorite(req, res);
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
