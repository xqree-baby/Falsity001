// Day 21 本地真跑验证：详情接口 + 发评论接口（上线前必跑，规矩五.5）
// 跑法：node day21-detail-test.cjs
//
// ⚠️ 三个坑踩过的教训，写在下面免得下次再犯：
//   1. 云函数里 PORT 写死 9000，改环境变量无效（Day 18 已记）。
//   2. **mock db 必须在被测进程里替换**。用 spawn 起子进程跑真 index.js 时，
//      父进程里 require.cache 改 db.js 对子进程无效 → 子进程拿真 db.js →
//      requireKey() 抛「CLOUDBASE_API_KEY 未配置」→ 全 503，
//      看着像接口坏了，其实是 mock 没生效。
//      正确做法：spawn 时用 `node --require ./day21-mock-db-preload.cjs`，
//      让预加载脚本在 index.js 之前把 db.js 换掉（见 preload 文件）。
//   3. Response body 只能读一次：check() 里已 await 了 res.text()，
//      后面再 res.json() 会抛「Body has already been read」。
//      每个响应只读一次，存进变量复用。
const path = require('path');
const { spawn } = require('child_process');

// 预加载脚本负责在 index.js 之前把 db.js 换成 mock
const preload = path.join(__dirname, 'day21-mock-db-preload.cjs');
const entry = path.join(__dirname, 'functions', 'api', 'index.js');
const child = spawn(process.execPath, ['--require', preload, entry], { stdio: 'inherit' });

process.on('exit', () => child.kill());

setTimeout(async () => {
  const B = 'http://127.0.0.1:9000';
  let pass = 0, fail = 0;
  const check = (name, cond, extra = '') => {
    if (cond) { pass++; console.log('  PASS  ' + name); }
    else { fail++; console.log('  FAIL  ' + name + (extra ? '  -> ' + extra : '')); }
  };
  // 统一读一次 body，后面复用（坑 3）
  const get = async (u, o) => {
    const r = await fetch(B + u, o);
    const text = await r.text();
    let json = null;
    try { json = JSON.parse(text); } catch (e) { /* 非 JSON 留 null */ }
    return { r, text, j: json };
  };

  console.log('\n=== 1. 路由存在性（Day 21 改用 query 传 id：网关不支持 {id} 路径参数）===');
  let res = await get('/api/post?id=p001');
  check('GET /api/post?id=p001 返回 200', res.r.status === 200, '实际 ' + res.r.status + ' ' + res.text.slice(0, 90));
  res = await get('/post?id=p001');
  check('GET /post?id=p001（无前缀兼容）200', res.r.status === 200, '实际 ' + res.r.status);
  res = await get('/api/post');
  check('GET /api/post 缺 id -> 400', res.r.status === 400, '实际 ' + res.r.status + ' ' + res.text.slice(0, 70));
  res = await get('/api/post?id=');
  check('GET /api/post?id=（空值）-> 400', res.r.status === 400, '实际 ' + res.r.status);

  console.log('\n=== 2. 详情返回结构（前端要靠它渲染）===');
  res = await get('/api/post?id=p001');
  const j = res.j || {};
  check('ok=true', j.ok === true);
  const p = j.post || {};
  check('post.id = p001', p.id === 'p001');
  check('post.title 有值', !!p.title);
  check('post.author 有值（Day 21 报错的根因字段）', !!p.author, 'author=' + p.author);
  check('post.body 有值', !!p.body);
  check('post.createdAt 已转驼峰', !!p.createdAt);
  check('authorVerified 已转驼峰', p.authorVerified === true);
  check('无蛇形字段残留', !('author_verified' in p) && !('created_at' in p),
    JSON.stringify(Object.keys(p)));
  check('comments 是真数组（不是空数组占位）', Array.isArray(p.comments));
  check('comments 长度 = 2', (p.comments || []).length === 2, '实际 ' + (p.comments || []).length);
  check('comment.author 有值', !!(p.comments || [])[0] && !!p.comments[0].author);
  check('comment.createdAt 已转驼峰', !!(p.comments || [])[0] && !!p.comments[0].createdAt);
  check('comment.postId 驼峰', !!(p.comments || [])[0] && p.comments[0].postId === 'p001');

  console.log('\n=== 3. 404 分支（不能崩，要给一句人话）===');
  res = await get('/api/post?id=p999');
  check('不存在的帖子 -> 404', res.r.status === 404, '实际 ' + res.r.status);
  check('404 返回中文提示', !!(res.j && typeof res.j.error === 'string' && res.j.error.length > 0),
    JSON.stringify(res.j));

  console.log('\n=== 4. 发评论（POST /api/comments，post_id 在 body 里）===');
  res = await get('/api/comments', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ post_id: 'p001', author: '小李', body: 'Day 21 测试评论' }),
  });
  check('正常发评论 -> 201', res.r.status === 201, '实际 ' + res.r.status + ' ' + res.text.slice(0, 90));
  check('返回 comment.id', !!(res.j && res.j.comment && res.j.comment.id));
  check('返回 comment.postId 驼峰', res.j && res.j.comment && res.j.comment.postId === 'p001');
  check('返回 comment.author', res.j && res.j.comment && res.j.comment.author === '小李');
  check('返回 comment.body', res.j && res.j.comment && res.j.comment.body === 'Day 21 测试评论');

  console.log('\n=== 5. 发评论的校验分支 ===');
  const cases = [
    [{ post_id: 'p001', body: '   ' }, 400, '空内容'],
    [{ post_id: 'p001' }, 400, '缺内容字段'],
    [{ post_id: 'p001', body: 123 }, 400, '内容是数字'],
    [{ post_id: 'p001', author: 'x' }, 400, '只有昵称没内容'],
    [{ body: '有内容没编号' }, 400, '缺 post_id'],
    [{ post_id: '', body: 'x' }, 400, 'post_id 是空串'],
    [{ post_id: 123, body: 'x' }, 400, 'post_id 是数字'],
    [[], 400, 'body 是数组'],
    ['字符串', 400, 'body 是字符串'],
  ];
  for (const [payload, want, label] of cases) {
    res = await get('/api/comments', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    check(`${label} -> ${want}`, res.r.status === want, '实际 ' + res.r.status + ' ' + res.text.slice(0, 60));
  }
  res = await get('/api/comments', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{坏json',
  });
  check('坏 JSON -> 400', res.r.status === 400, '实际 ' + res.r.status);

  res = await get('/api/comments', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ post_id: 'p999', body: 'x' }),
  });
  check('给不存在的帖子发评论 -> 404', res.r.status === 404, '实际 ' + res.r.status);

  console.log('\n=== 6. 昵称留空兜底为「匿名」===');
  res = await get('/api/comments', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ post_id: 'p001', body: '匿名测试' }),
  });
  check('留空昵称 -> 201', res.r.status === 201, '实际 ' + res.r.status);
  check('昵称存为「匿名」', res.j && res.j.comment && res.j.comment.author === '匿名',
    JSON.stringify(res.j && res.j.comment));

  console.log('\n=== 7. 回归：Day 18-20 原有接口没被改坏 ===');
  for (const p2 of ['/api/posts', '/api/hot', '/api/favorites']) {
    res = await get(p2);
    check('GET ' + p2 + ' -> 200（缺 Key 时 503 也算链路通）',
      res.r.status === 200 || res.r.status === 503, '实际 ' + res.r.status);
  }
  res = await get('/api/favorites', {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}',
  });
  check('POST /api/favorites 缺 post_id -> 400', res.r.status === 400, '实际 ' + res.r.status);
  res = await get('/api/nope');
  check('未知路径 -> 404 带 receivedPath', res.r.status === 404);

  console.log('\n=== 8. CORS：确认没把 Access-Control-Allow-Origin 加回来 ===');
  res = await get('/api/post?id=p001', { headers: { Origin: 'https://example.com' } });
  check('GET 详情不带 ACAO（交给网关）', !res.r.headers.get('access-control-allow-origin'),
    'ACAO=' + res.r.headers.get('access-control-allow-origin'));
  res = await get('/api/comments', { method: 'OPTIONS' });
  check('OPTIONS 预检 -> 204', res.r.status === 204, '实际 ' + res.r.status);
  check('OPTIONS 不带 ACAO', !res.r.headers.get('access-control-allow-origin'));

  console.log('\n-----------------------------------');
  console.log('通过 ' + pass + ' 项，失败 ' + fail + ' 项');
  console.log('-----------------------------------\n');
  child.kill();
  process.exit(fail ? 1 : 0);
}, 1500);
