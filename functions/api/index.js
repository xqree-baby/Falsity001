// Day 17 建（Day 18 追加写入接口，Day 20 追加帖子列表，Day 21 追加帖子详情与评论）
// 用途：一个函数按路径分发七个接口——
//   GET  /api/posts       已过审帖子列表（Day 20 新增，首页帖子区接真实数据库）
//   GET  /api/post?id=xx  单篇帖子详情 + 该帖评论（Day 21 新增，详情页接真实数据库）
//   GET  /api/hot        今日热搜（读 trends 表）
//   GET  /api/favorites  收藏列表（favorites 联 posts，只返回已过审帖子）
//   POST /api/favorites  收藏一篇帖子（Day 18 新增，第一个写入接口）
//   POST /api/comments   发一条评论（Day 21 新增，post_id 放请求体）
//   PATCH /api/post      改一条帖子（Day 22 新增，白名单字段 + 改前查存在）
//   DELETE /api/comments 删一条评论（Day 22 新增，删前查存在 + 回显删掉的是哪条）
//   POST /api/sync       抓微博/B站/抖音真实热搜写回 trends（手动触发，判重不重复插行）
//
// ⚠️ 为什么详情和评论不用 /api/posts/:id 这种形态（2026-10-07 实测）：
//   CloudBase HTTP 网关**不支持 {id} 路径参数**，只认固定路径；
//   而 /api/posts 已被 Day 20 的列表接口占用，改不成 /api/posts/{id}。
//   → 另起固定路径 /api/post?id=xx 和 /api/comments，编号放 query / 请求体。
//   （query 参数是可行的：Day 17 的 /api/hot?date=2026-10-05 一直正常工作。）
// 运行环境：CloudBase Web 函数（必须自己 createServer + listen(9000)，不能写 exports.main）
// 依赖：零第三方包，只用 Node 内置能力（fetch 为 Node 18+ 内置）
// 分层（Day 19）：这个文件是业务层，只管「接口该返回什么」。
//   数据库相关的全部在同目录的 db.js 里，通过 db.findPostById() 这类调用去用，
//   本文件里不再出现任何表名和查询语法——要改数据库写法只动 db.js 一个地方。
// 路由兼容：网关可能把 /api/xxx 前缀剥掉再转发（Day 15 health 函数收到的是 "/"），
//   所以 /hot 和 /api/hot 两种路径都认

const http = require('http');
const db = require('./db');

const PORT = 9000; // Web 函数固定监听 9000，平台把 HTTP 请求转发进来

// ---------------- 小工具 ----------------

// 北京时间（UTC+8）的今天，格式 YYYY-MM-DD
// 坑：云函数系统时区是 UTC。北京时间 00:00–08:00 之间，UTC 还是「昨天」，
//     直接 new Date().toISOString() 取日期会把同一天的榜单写成两批。
//     办法：时间戳 + 8 小时再取 ISO 日期，得到的就是北京日期。
function beijingToday() {
  return new Date(Date.now() + 8 * 3600 * 1000).toISOString().slice(0, 10);
}

// 统一 JSON 出口（Day 20 改动：这里不再自己加 Access-Control-Allow-Origin）
//⚠️ 为什么去掉（今天踩到的真跨域坑，不是「没配跨域」，是「配了两遍」）：
//   部署到 HTTP 网关后实测（带浏览器 Origin 头请求）返回的是
//     access-control-allow-origin: https://xxx.webapps.tcloudbase.com,*
//   —— 网关已经先加了一个「请求方的域名」，我们又加了一个「*」，
//   网关把两个值用逗号拼在一起。浏览器的规则是「这个头只能有一个值」，
//   见到两个就认为跨域配置非法，于是**在网络层就掐掉整个响应**，
//   JS 侧只能拿到 Failed to fetch，连状态码都读不到。
//   判据：Console 里会出现
//     The 'Access-Control-Allow-Origin' header contains multiple values ...
//     but only one is allowed.
//   为什么服务器侧脚本测不出来：不用浏览器发请求就没有 Origin 头，
//   网关不加自己的那一份，响应里只剩我们的 *，看起来一切正常。
//   → 所以验跨域必须用真浏览器（或至少手动带 Origin 头），不能只用 node fetch。
//现在改成不碰这个头，让网关那份原样透传给浏览器。
function json(res, status, obj) {
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
  });
  res.end(JSON.stringify(obj));
}

// ---------------- Day 23：三类错误提示统一出口 ----------------
// 改前是什么（今天要解决的问题）：
//   1. 路由没匹配上→ 回英文 'not found'，用户看到的是编程词，不是人话
//   2. 数据库报错 → 把 PostgREST 的英文原文连着 HTTP 码一起甩出去，
//      形如「数据库 REST API 返回 400：{"code":"42P01","message":"relation ... does not exist"}」
//   3. 兜底catch → 把 e.message 原样吐出去，可能一整句都是英文
//
// 改成什么：按 HTTP 语义分三类，每类给一句用户能看懂的中话。
//   400/409 = 你传的东西不对（或跟现有数据冲突），用户改一下就能重试
//   404     = 找的东西不存在（被删了、或编号写错了）
//   5xx     = 我们这边出错了，用户干等就行，不是他的错
//
//⚠️ 为什么另外留一个 detail 字段：
//   用户看error（中文人话），排查的人看 detail（技术原文）。
//   两者分开之后，「给用户看」和「给开发者查」不再互相干扰——
//   以前是技术原文直接甩到页面上，用户看到一串英文以为坏了。
//   已有的具体中文提示（如「帖子 p001 不存在」）不在本次改动范围，保持原样。
const ERROR_CLASS = {
  400: { code: 'BAD_REQUEST', text: '你提交的内容有问题，请检查后再试一次。' },
  404: { code: 'NOT_FOUND', text: '没找到要找的内容，它可能已经被删掉了。' },
  409: { code: 'CONFLICT', text: '这个操作跟已有数据冲突了，换一个再试试。' },
  500: { code: 'SERVER_ERROR', text: '服务器出错了，请稍后重试。' },
  502: { code: 'DB_UNREACHABLE', text: '服务器暂时连不上数据库，请稍后重试。' },
  503: { code: 'NOT_CONFIGURED', text: '服务还没配置好，请稍后重试。' },
};

// 错误统一出口：status 决定给用户哪句人话，detail 只进日志/调试字段不给人看
function fail(res, status, detail) {
  const k = ERROR_CLASS[status] || ERROR_CLASS[500];
  return json(res, status, {
    ok: false,
    error: k.text,
    errorCode: k.code,
    detail: detail ? String(detail).slice(0, 200) : undefined,
  });
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

// ---------------- 收藏编号规则（业务规则，留在业务层） ----------------

// 生成收藏编号：f + 时间戳 base36（如 f1a2b3c4d5）。
// 为什么不用「查表里最大 fXXX 再 +1」：那是查完再插，两步之间有缝，
// 并发两个请求会拿到同一个号、第二个撞主键报错。id 自己带随机性就不用查表。
// 为什么不用自增整数：posts/comments 都沿用 p001/c001 字符串主键，保持全库风格一致。
function newFavoriteId() {
  return 'f' + Date.now().toString(36);
}

// ---------------- 评论编号规则（Day 21 新增，业务规则留业务层） ----------------

// 生成评论编号：c + 时间戳 base36（如 c1a2b3c4d5）。理由同 newFavoriteId：
//   不查表取最大号 +1（查完再插有缝，并发会撞主键），id 自带随机性就不用查表。
function newCommentId() {
  return 'c' + Date.now().toString(36);
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
  const post = await db.findPostById(postId);
  if (!post) {
    logLine('favorite.reject', `post_id=${postId} 原因=帖子不存在`);
    return json(res, 404, { ok: false, error: `帖子 ${postId} 不存在` });
  }

  // 4) 写入。判重不在代码里做——直接插，让 UNIQUE(post_id) 报重复（唯一真相来源）
  const id = newFavoriteId();
  try {
    const saved = await db.insertFavorite({ id, post_id: postId, created_at: new Date().toISOString() });
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

// ---------------- 四个接口的实现 ----------------

// GET /api/posts —— 已过审的帖子列表（Day 20 新增：首页帖子区接真实数据库）
async function handlePosts(req, res) {
  const rows = await db.listApprovedPosts();
  // 卡片上要显示「N 条评论」，而评论数不在 posts 表里，要单独查一次 comments 表。
  // ⚠️ 查不到评论数也要正常返回帖子（counts 为空对象时用 0 兜底）——
  //   列表接口不该因为评论统计失败就整个挂掉，那是锦上添花的信息。
  let counts = {};
  try {
    counts = await db.countCommentsByPost(rows.map((r) => r.id));
  } catch (e) {
    console.log(`[posts] 评论数查询失败，暂按 0 显示：${e.message}`);
  }
  // 字段名从蛇形改成驼峰，和 api-contract.md 第2 节约定的形状对齐——
  // 前端拿到的对象形状因此和读 posts.json 时完全一样，渲染代码不用两套。
  // 返回 pending: false 是因为查询已经过滤过了，但字段留着，
  // 这样前端 renderCards 之类的判断逻辑不用改。
  // comments 只给条数不给正文：列表页不需要正文，正文是详情页的事。
  return json(res, 200, {
    ok: true,
    count: rows.length,
    posts: rows.map((r) => ({
      id: r.id,
      type: r.type,
      category: r.category,
      title: r.title,
      body: r.body,
      author: r.author,
      authorVerified: r.author_verified,
      pending: r.pending,
      views: r.views,
      createdAt: r.created_at,
      // ⚠️ Day 20：这一条别删。页面上「N 条评论」读的就是它，
      //   漏了会让前端在 p.comments.length 处报
      //   「Cannot read properties of undefined」——因为 undefined.length 会抛。
      comments: new Array(counts[r.id] || 0),
    })),
  });
}

// GET /api/posts/:id —— 单篇帖子详情（Day 21 新增）
//
// 背景：Day 21 同伴交叉验证抓出来的第一个真 bug。
//   详情页在 index.html 里写的是相对路径 fetch('/api/posts/' + id)，
//   页面跑在静态托管域名上，这个相对路径请求发到静态托管自己那儿，
//   静态托管里没有 /api/ → 必然 404 → 页面 catch 里 p 是 null，
//   再读p.author 就抛「Cannot read properties of null」。
//   前端 Day 20 改过API_BASE，但那两处漏了；后端也压根没注册这条路由。
//
// 为什么评论要单独查、然后拼进 post.comments：
//   帖子表里没有评论正文（Day 20 列表接口的 comments 是空数组占位，只为数条数用的）。
//   详情页要显示评论内容，所以这里查第二张表再挂到 post.comments 上——
//   这样前端的 renderComments(p.comments) 不用改，形状和读假数据时一样。
async function handlePostDetail(req, res, postId) {
  const row = await db.findPostForDetail(postId);
  // 找不到 和 待审核 返回同一个 404：
  //   故意不区分——「待审核」不该告诉外人这篇存在但看不到。
  if (!row) {
    return json(res, 404, { ok: false, error: '帖子不存在或还在审核中' });
  }

  // 评论查不到要让帖子照常显示（评论是附加信息，不该拖垮正文）
  let comments = [];
  try {
    const rows = await db.findCommentsByPost(postId);
    comments = rows.map((c) => ({
      id: c.id,
      postId: c.post_id,
      author: c.author,
      body: c.body,
      createdAt: c.created_at,
    }));
  } catch (e) {
    console.log(`[postDetail] 评论查询失败，帖子照常返回、评论区显示为空：${e.message}`);
  }

  return json(res, 200, {
    ok: true,
    post: {
      id: row.id,
      type: row.type,
      category: row.category,
      title: row.title,
      body: row.body,
      author: row.author,
      authorVerified: row.author_verified,
      views: row.views,
      createdAt: row.created_at,
      comments,
    },
  });
}

// POST /api/comments —— 发一条评论（Day 21 新增）
//
// 同伴验证的第二个失败点：发评论返回 404。
//   原因和详情页一样——前端用了相对路径，且后端压根没注册这条路由。
//
// ⚠️ 为什么地址是 /api/comments 而不是 /api/posts/p001/comments：
//   CloudBase HTTP 网关不支持 {id} 路径参数，只认固定路径（实测 2026-10-07）。
//   所以帖子编号放请求体的 post_id 字段里，不放URL 上。
//
// 校验顺序照handleFavorite 那套：先读体 → 解析 → 校验 → 确认帖子存在 → 写。
// 昵称允许留空（前端默认给「匿名」），但内容和帖子编号必填。
async function handleCreateComment(req, res) {
  const raw = await readBody(req);
  let body;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch (e) {
    return json(res, 400, { ok: false, error: '请求体不是合法的 JSON' });
  }
  if (typeof body !== 'object' || Array.isArray(body) || !body) {
    return json(res, 400, { ok: false, error: '请求体格式不对' });
  }

  // 帖子编号必填（因为不能放在 URL 上，只能靠请求体带）
  const postId = typeof body.post_id === 'string' ? body.post_id.trim() : '';
  if (!postId) {
    logLine('comment.reject', `原因=缺 post_id`);
    return json(res, 400, { ok: false, error: 'post_id 必填（要评论的帖子编号）' });
  }

  // 评论内容必填
  const text = typeof body.body === 'string' ? body.body.trim() : '';
  if (!text) {
    logLine('comment.reject', `post_id=${postId} 原因=内容为空`);
    return json(res, 400, { ok: false, error: '评论内容不能为空' });
  }
  // 昵称留空按「匿名」存，跟详情页昵称框的占位提示一致
  const author = (typeof body.author === 'string' && body.author.trim()) || '匿名';

  // 确认帖子存在且已过审（不给待审核的帖子收评论，跟详情页不给看保持同一个口径）
  const post = await db.findPostForDetail(postId);
  if (!post) {
    logLine('comment.reject', `post_id=${postId} 原因=帖子不存在或未过审`);
    return json(res, 404, { ok: false, error: '帖子不存在或还在审核中' });
  }

  const id = newCommentId();
  try {
    const saved = await db.insertComment({
      id,
      post_id: postId,
      author,
      body: text,
      created_at: new Date().toISOString(),
    });
    logLine('comment.ok', `id=${saved.id} post_id=${postId}`);
    return json(res, 201, {
      ok: true,
      comment: {
        id: saved.id,
        postId: saved.post_id,
        author: saved.author,
        body: saved.body,
        createdAt: saved.created_at,
      },
    });
  } catch (e) {
    logLine('comment.error', `post_id=${postId} 错误=${e.message}`);
    throw e; // 交给最外层catch翻成 502/503
  }
}

// ---------------- 修改与删除（Day 22） ----------------

// 今天要回答的问题：删除为什么比新增更容易出事？确认加在哪？
//
//   新增出错 → 最坏是多了一条脏数据。它还在那儿、看得见、能筛出来、能删掉。
//   删除出错 → 是「本来存在的东西没了」。当场没人报警（页面照样打开，
//             只是少了一条），等发现时已经不可逆，备份也未必有。
//
//   所以删除/修改这类操作，确认要比新增多几道。今天这四道是：
//     ① 对象必须存在（不存在给 404，不做「静默成功」——静默成功会让人以为删掉了）
//     ② 关键参数必填且合法（少传就拒，不猜）
//     ③ 限定能改的字段（PATCH 不能让人改 id / created_at）
//     ④ 写一条日志（谁、对哪条、成功还是被拒，事后查得回来）

// PATCH 字段白名单：只有这几个键允许被改，其余一律忽略。
// 为什么必须要有白名单，不能「传什么改什么」：
//   请求体是可以随便伪造的。如果不限制，调用方传 {id:'p999'} 就把这条记录的编号改了，
//   传 {created_at:'1900-01-01'} 就能把发布时间改掉——
//   这些字段是系统自己维护的，不属于「用户能编辑的内容」。
// 只放行内容字段 + 一个计数字段（views 是浏览量，加减正常，改它不算破坏数据完整性）。
const PATCHABLE_POST_FIELDS = ['title', 'category', 'views'];

// 各字段的额外校验：类型不对的、越界的，在这里挡掉，给一句人话。
// 为什么不在数据库层挡：数据库只会报 CHECK  Violation 或类型错误，
//   那种报错给前端/user 看没有意义（「invalid input syntax for type integer」
//   没人知道该改什么）。挡住的地方要能说清「你要改的这东西不对」。
function validatePatchField(field, value) {
  if (field === 'title') {
    if (typeof value !== 'string' || !value.trim()) return 'title 必须是 non-empty 字符串';
    if (value.trim().length > 200) return 'title 太长了（最多 200 字）';
    return null;
  }
  if (field === 'category') {
    // 分类是固定 6 类（前端 index.html 里的 CATEGORIES 常量）。
    // 这里只做「是不是字符串、是不是空」的检查，不硬编码 6 个值——
    //   分类清单是产品约定，可能变；硬编码到后端，以后前端加一类就得改后端发一次版。
    if (typeof value !== 'string' || !value.trim()) return 'category 必须是字符串';
    if (value.trim().length > 32) return 'category 太长了（最多 32 字）';
    return null;
  }
  if (field === 'views') {
    // 浏览量必须是非负整数。传字符串 / 负数 / 小数都不行——
    //   让脏数据进库，以后做排序或统计就会得出奇怪的结论，而且没人知道是哪条坏的。
    if (!Number.isInteger(value) || value < 0) return 'views 必须是非负整数';
    if (value > 100000000) return 'views 太大了（上限 1 亿）';
    return null;
  }
  return null;
}

// PATCH /api/post?id=p001 —— 改一条帖子
//
// 为什么地址是 /api/post?id=xx 而不是 /api/posts/p001：
//   和 Day 21 的详情接口同一个理由——CloudBase HTTP 网关不支持 {id} 路径参数，
//   只认固定路径；而 /api/posts 已经被列表接口占了。所以复用 /api/post，编号放 query。
//   （这也说明「沿用已验证的形状」比「新造一个更顺手的形状」重要，
//     因为新形状还得重新验证一遍网关吃不吃。）
async function handleUpdatePost(req, res, postId) {
  // 确认 ②：id 必填。路径层已经挡了空字符串，这里再挡一次非正常形态。
  if (!/^p\d{3,}$/.test(postId)) {
    return json(res, 400, { ok: false, error: 'id 格式不对（应为 p001 这样的帖子编号）' });
  }

  const raw = await readBody(req);
  let body;
  try {
    body = raw ? JSON.parse(raw) : {};
  } catch (e) {
    return json(res, 400, { ok: false, error: '请求体不是合法的 JSON' });
  }
  if (typeof body !== 'object' || Array.isArray(body) || !body) {
    return json(res, 400, { ok: false, error: '请求体格式不对' });
  }

  // 只挑白名单里的字段。⚠️ 注意这里是「挑出来」而不是「挑不出来就报错」——
  //   传了 title、category、created_at，我们只改前两个，把 created_at 悄悄忽略。
  //   这样调用方即使多带了字段也不会整个失败，同时系统字段依然改不了。
  const patch = {};
  const ignored = [];
  for (const field of PATCHABLE_POST_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(body, field)) {
      const err = validatePatchField(field, body[field]);
      if (err) {
        logLine('post.update.reject', `id=${postId} 字段=${field} 原因=${err}`);
        return json(res, 400, { ok: false, error: err });
      }
      patch[field] = typeof body[field] === 'string' ? body[field].trim() : body[field];
    }
  }
  for (const key of Object.keys(body)) {
    if (!PATCHABLE_POST_FIELDS.includes(key)) ignored.push(key);
  }

  // 一个可改字段都没给：这是「什么也没说」，不是「删空」。
  //   特别要挡掉空请求体 —— 不挡的话会发一次 PATCH 带空对象，
  //   数据库可能什么都不改也可能报错，两种结果都让人不知道到底改没改。
  if (Object.keys(patch).length === 0) {
    logLine('post.update.reject', `id=${postId} 原因=没给任何可改字段`);
    return json(res, 400, {
      ok: false,
      error: `没有可改的字段（可改：${PATCHABLE_POST_FIELDS.join(' / ')}）`,
    });
  }

  // 确认 ①：改之前先查一次。
  //   为什么要查两遍（查一次还不够）：这一遍查的是「改之前长什么样」——
  //   既是 404 的判据，也是返回给页面的 before 值，
  //   让调用方看到「原来是什么 → 现在是什么」，而不是自己记着旧值去对比。
  const before = await db.findPostForDetail(postId);
  if (!before) {
    logLine('post.update.reject', `id=${postId} 原因=帖子不存在或未过审`);
    return json(res, 404, { ok: false, error: '帖子不存在或还在审核中' });
  }

  // 发给数据库的 patch 也要把 post_id 带上（要改 category 时得重新过一遍非空校验）
  const saved = await db.updatePost(postId, patch);
  if (!saved) {
    // 走到这里说明「查的时候存在、更新的时候不见了」——
    //   中间有别人删了它，或者 pending 状态变了。属于并发，不能当成功。
    logLine('post.update.reject', `id=${postId} 原因=更新命中 0 行`);
    return json(res, 404, { ok: false, error: '帖子不存在，或在查询到更新之间被删掉了' });
  }

  // 确认 ④：日志。改了什么字段也记一笔，事后能查。
  logLine('post.update.ok', `id=${postId} 字段=${Object.keys(patch).join(',')}` +
    (ignored.length ? ` 已忽略=${ignored.join(',')}` : ''));

  // ⚠️ 返回的 after 值全部来自数据库（saved），不是把请求体原样退回去。
  //   before 来自更新前的查询，两个值都不是我们自己编的 → 截图里的对比是可信的。
  return json(res, 200, {
    ok: true,
    id: postId,
    // 只回显实际动过的这几个字段的前后对比，不是整条帖子。
    //   理由：调用方要的是「我改的那一栏变没变」，塞一整条帖子会让人在页面里找哪行变了。
    changed: Object.keys(patch).map((k) => ({
      field: k,
      before: k === 'views' ? before.views : before[k],
      after: k === 'views' ? saved.views : saved[k],
    })),
    post: {
      id: saved.id,
      type: saved.type,
      category: saved.category,
      title: saved.title,
      author: saved.author,
      authorVerified: saved.author_verified,
      views: saved.views,
      createdAt: saved.created_at,
    },
    // 明确告诉调用方「你传的这些字段我无视了」，而不是悄悄吞掉。
    //   无声忽略是接口最大的坑之一：调用方会以为 pending 也改了。
    ...(ignored.length ? { ignoredFields: ignored } : {}),
  });
}

// DELETE /api/comments?id=c001 —— 删一条评论
//
// 为什么删的是评论、不是帖子（这个判断本身就是今天要学的东西）：
//   posts 表被两张表用外键指着——comments.post_id 和 favorites.post_id 都 REFERENCES posts(id)。
//   也就是说「删帖子」这个动作数据库会直接挡下来（外键约束），而且一旦有评论或收藏，
//   光报错不够用，你还得决定是「连评论一起删」还是「先转移归属」——这是产品决策不是技术决策。
//   评论是叶子节点：没有任何表指向 comments，删它不会牵连任何东西。
//   → 今天用最安全的对象演示「不可逆」，真要做删除产品时再面对级联删除那摊事。
//
// 为什么用 /api/comments?id=xx 而不是 /api/comments/xx：网关不支持路径参数（同上），编号放 query。
async function handleDeleteComment(req, res, commentId) {
  // 确认 ②：id 必填。c001 是种子数据、c 开头的 base36 是 Day 21 之后新发的，两种都收。
  if (!commentId || commentId.length > 16) {
    return json(res, 400, { ok: false, error: '缺少 id 参数（用法：/api/comments?id=c001）' });
  }

  // 确认 ①：删之前先查一次。
  //   ⚠️ 这一步是 DELETE 最重要的一步，不能省：
  //   「删一条不存在的东西」有两种处理方式——
  //     a) 返回成功（幂等）：调用方重复点两次删除不会报错，适合「确保它不存在」的场景；
  //     b) 返回 404：调用方能知道「我以为在删的东西本来就不在这里」，可能自己搞错了 id。
  //   这里选 b)：404。因为调用方是人点的按钮，不是一段要幂等跑的脚本，
  //   「我删的那条评论找不到」对用户是有意义的信息，值得看见。
  const before = await db.findCommentById(commentId);
  if (!before) {
    logLine('comment.delete.reject', `id=${commentId} 原因=评论不存在`);
    return json(res, 404, { ok: false, error: `评论 ${commentId} 不存在，没有删掉任何东西` });
  }

  // ⚠️ 删之前把「删掉的是哪条」记下来。
  //   因为一旦 DELETE 成功就再也拿不回正文了，不留这一笔的话，
  //   用户投诉「我那条评论怎么没了」，日志里只有一个光秃秃的 id，谁也认不出是哪条。
  const saved = await db.deleteComment(commentId);
  if (!saved) {
    logLine('comment.delete.reject', `id=${commentId} 原因=删除命中 0 行`);
    return json(res, 404, { ok: false, error: `评论 ${commentId} 在查询到删除之间被别人删掉了` });
  }

  // 确认 ④：日志（含正文快照，删了就查不回来了）
  logLine('comment.delete.ok', `id=${commentId} post_id=${saved.post_id} 正文快照="${String(saved.body).slice(0, 40)}"`);

  // 回显删掉的是哪一条：id / 属于哪篇帖子 / 昵称 / 正文。
  //   理由：不可逆的操作要留一张「回执」，让调用方能对得上自己刚才删的是哪条。
  return json(res, 200, {
    ok: true,
    deleted: {
      id: saved.id,
      postId: saved.post_id,
      author: saved.author,
      body: saved.body,
      createdAt: saved.created_at,
    },
  });
}

// GET /api/hot —— 今日热搜
async function handleHot(req, res, query) {
  let date = query.get('date') || beijingToday();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return json(res, 400, { ok: false, error: 'date 参数格式应为 YYYY-MM-DD' });
  }
  const rows = await db.findTrendsByDate(date);
  return json(res, 200, { ok: true, date, data: rows });
}

// GET /api/favorites —— 收藏列表（联表只返回已过审帖子）
async function handleFavorites(req, res) {
  const rows = await db.listFavoritesWithPosts();
  return json(res, 200, {
    ok: true,
    // ⚠️ 过滤 posts 为 null 的行（Day 19 回归抓到的 bug）
    // 为什么必须有这行：查询里的 posts.pending=eq.false 是「让 PostgREST 顺着外键带出帖子并按过审状态过滤」，
    //   但父行不满足条件时 PostgREST 的行为是把关联对象置成 null，而不是删掉整条收藏记录。
    //   所以库里只要存在「收藏了但那篇帖子已被删/改待审核/未过审」的记录，
    //   这里就会拿到一条 posts 为 null 的行，直接读 r.posts.title 抛 TypeError，
    //   整个接口 502——连正常的那几条都看不到（不是少显示一条，是全挂）。
    // 历史：Day 18 当天就遇到过并修过一次，但那次修复没落盘进提交（0cff7c4），线上一直带着这个雷。
    //   Day 19 回归时库里终于出现了「收藏了待审核帖子」的数据（p003），雷爆了。
    data: rows
      .filter((r) => r.posts) // ← 关联对象为 null 的先扔掉，不让它进后面的 map
      .map((r) => ({
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
    await db.upsertTrends(allRows);
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
  // CORS 预检：浏览器跨域调用前会先发 OPTIONS 探路。
  // ⚠️ Day 20：这里原来也加了 Access-Control-Allow-Origin，已去掉——
  //   网关会自己加一份，函数再加就是「同一个头两个值」，浏览器直接拒绝整个响应。
  //   方法/请求头的允许项保留，它们不会和网关重复。
  // ⚠️ Day 22 追加 PATCH / DELETE 到 Allow-Methods（这个漏了会「静默失败」，很难查）：
  //   浏览器把 PATCH / DELETE / PUT 算「非简单请求」，发出去之前一定先来问一句 OPTIONS：
  //     「这些方法我允许吗？」
  //   如果这里只写了 GET,POST,OPTIONS，浏览器读完直接判定「这个方法不允许」，
  //   **根本不会把真正的 PATCH 请求发出去**。
  //   页面上的表现是 Network 里那条 PATCH 显示「失败 / 被取消」，
  //   但开发者工具的 Console 一句红字都没有（这不是后端拒绝，是浏览器没发），
  //   而且服务器日志里也什么都没有——因为请求压根没到。
  //   → 排查口诀：改数据没反应、控制台无报错、服务器没日志 = 先怀疑预检白名单没放行这个方法。
  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Methods': 'GET,POST,PATCH,DELETE,OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type',
    });
    return res.end();
  }

  const u = new URL(req.url, 'http://localhost');
  let path = u.pathname.replace(/\/+$/, '') || '/';
  if (path.startsWith('/api/')) path = path.slice(4); // /api/hot -> /hot（网关前缀兼容）

  try {
    if (req.method === 'GET' && path === '/posts') return await handlePosts(req, res);
    // 单篇详情：GET /api/post?id=p001（Day 21）
    // ⚠️ 为什么用 query 不用 /api/posts/p001：
    //   CloudBase HTTP 网关**不支持 {id} 这种路径参数**，只认固定路径；
    //   而 /api/posts 已经被 Day 20 的列表接口占了，不能改成 /api/posts/{id}。
    //   所以另起一个固定路径 /api/post，帖子编号放query（?id=p001）。
    //   这个位置 Day 17 就验证过能用——/api/hot?date=2026-10-05 一直正常工作。
    if (req.method === 'GET' && path === '/post') {
      const id = u.searchParams.get('id') || '';
      if (!id) return json(res, 400, { ok: false, error: '缺少 id 参数（用法：/api/post?id=p001）' });
      return await handlePostDetail(req, res, id);
    }
    // 发评论：POST /api/comments（Day 21）
    // 同样因为网关不支持路径参数，帖子编号放请求体里的 post_id，不用放在 URL 上。
    if (req.method === 'POST' && path === '/comments') return await handleCreateComment(req, res);
    // 改帖子：PATCH /api/post?id=p001（Day 22）
    // 复用详情接口那条路径（GET /api/post?id=xx），只是换个方法——同一个资源用不同方法表达不同动作，
    //   这是 REST 的基本约定：GET 读、PATCH 改、DELETE 删，都指向同一个地址。
    if (req.method === 'PATCH' && path === '/post') {
      const id = u.searchParams.get('id') || '';
      if (!id) return json(res, 400, { ok: false, error: '缺少 id 参数（用法：/api/post?id=p001）' });
      return await handleUpdatePost(req, res, id);
    }
    // 删评论：DELETE /api/comments?id=c001（Day 22）
    // 同一个 /comments 路径配不同方法：POST 是发评论，DELETE 是删评论。
    // ⚠️ 这个「同一个地址换方法」的设计是今天刻意选的：
    //   因为 CloudBase HTTP 网关按「路径」绑定路由，不区分方法，
    //   所以同一个路径配多个方法**不用去控制台多绑一条**，省一次部署期操作。
    if (req.method === 'DELETE' && path === '/comments') {
      const id = u.searchParams.get('id') || '';
      if (!id) return json(res, 400, { ok: false, error: '缺少 id 参数（用法：/api/comments?id=c001）' });
      return await handleDeleteComment(req, res, id);
    }
    if (req.method === 'GET' && path === '/hot') return await handleHot(req, res, u.searchParams);
    if (req.method === 'GET' && path === '/favorites') return await handleFavorites(req, res);
    if (req.method === 'POST' && path === '/favorites') return await handleFavorite(req, res);
    if (req.method === 'POST' && path === '/sync') return await handleSync(req, res);

    // 404 时带回收到的原始路径，部署后如果路由不对，看这个字段就知道函数实际收到了什么
    // Day 23：error 从英文 'not found' 换成中文人话；receivedPath 保留（排查路由时要看它）
    return fail(res, 404, `no route for ${req.url}`);
  } catch (e) {
    // Day 23：三类错误统一出口。原来是把 e.message 原样吐出去（可能是英文技术原文），
    // 现在给用户一句中文人话，技术原文放进 detail 字段供排查。
    // 503 = 没配 Key（部署问题）；502 = 数据库访问失败（链路问题）
    const status = /CLOUDBASE_API_KEY/.test(e.message) ? 503 : 502;
    return fail(res, status, e.message);
  }
});

server.listen(PORT, () => {
  console.log(`api function listening on port ${PORT}`);
});
