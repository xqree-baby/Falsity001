// Day 7 MVP 后端（零依赖，使用 Node 内置 http 模块）
// 规则判定在后端，前端不参与判定（TECH_DESIGN 一.1.2）
// 数据存 posts.json，不做数据库

const http = require('http');
const fs = require('fs/promises');
const path = require('path');

const DATA_FILE = path.join(__dirname, 'posts.json');
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

// ---------- 数据读写 ----------
async function readPosts() {
  const raw = await fs.readFile(DATA_FILE, 'utf8');
  return JSON.parse(raw);
}
async function writePosts(data) {
  await fs.writeFile(DATA_FILE, JSON.stringify(data, null, 2), 'utf8');
}
function genId(prefix, items) {
  // 简单自增：按已有数量生成；并发不安全但 MVP 阶段够用
  const n = String((items || []).length + 1).padStart(3, '0');
  return prefix + n;
}
function nowIso() {
  return new Date().toISOString();
}
function json(res, status, payload) {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}
async function readJsonBody(req) {
  let buf = '';
  await new Promise((resolve, reject) => {
    req.on('data', chunk => {
      buf += chunk;
      if (buf.length > 64 * 1024) {
        reject(new Error('body too large'));
        req.destroy();
      }
    });
    req.on('end', resolve);
    req.on('error', reject);
  });
  if (!buf) return {};
  try { return JSON.parse(buf); } catch (e) { return {}; }
}
async function serveStatic(rel, res, contentType) {
  try {
    const file = await fs.readFile(path.join(__dirname, rel));
    const ct = contentType
      || (rel.endsWith('.html') ? 'text/html; charset=utf-8'
        : rel.endsWith('.css') ? 'text/css; charset=utf-8'
        : 'application/octet-stream');
    res.writeHead(200, { 'Content-Type': ct });
    res.end(file);
  } catch (e) {
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
    res.end('404 not found: ' + rel);
  }
}

// ---------- 路由 ----------
const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${PORT}`);
  const method = req.method;
  const p = url.pathname;

  // 静态页面
  if (method === 'GET' && (p === '/' || p === '/index.html')) {
    return serveStatic('public/index.html', res);
  }
  if (method === 'GET' && p === '/submit') {
    return serveStatic('public/submit.html', res);
  }
  if (method === 'GET' && p === '/admin') {
    return serveStatic('public/admin.html', res);
  }
  const postMatch = p.match(/^\/post\/([\w-]+)$/);
  if (method === 'GET' && postMatch) {
    return serveStatic('public/post.html', res);
  }
  if (method === 'GET' && p === '/style.css') {
    return serveStatic('public/style.css', res);
  }

  // 读接口
  if (method === 'GET' && p === '/api/posts') {
    const data = await readPosts();
    const list = data.posts
      .filter(x => !x.pending)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    return json(res, 200, { posts: list });
  }
  const getOne = p.match(/^\/api\/posts\/([\w-]+)$/);
  if (method === 'GET' && getOne) {
    const data = await readPosts();
    const post = data.posts.find(x => x.id === getOne[1]);
    if (!post || post.pending) return json(res, 404, { error: 'not found' });
    return json(res, 200, { post });
  }
  if (method === 'GET' && p === '/api/admin/pending') {
    const data = await readPosts();
    const list = data.posts.filter(x => x.pending);
    return json(res, 200, { posts: list });
  }

  // 写接口：发帖
  if (method === 'POST' && p === '/api/posts') {
    const body = await readJsonBody(req);
    const data = await readPosts();
    const verified = url.searchParams.get('as') === 'verified';
    let type = body.type;
    let pending = false;
    let author = body.author || '匿名网友';
    if (!verified) {
      // 未认证：强制 type=question、pending=true、作者隐藏为「匿名网友」
      type = 'question';
      pending = true;
      author = '匿名网友（待审核）';
    } else {
      if (type !== 'opinion' && type !== 'question') {
        return json(res, 400, { error: 'type 必须是 opinion 或 question' });
      }
      if (!author) author = '在职老张（认证）';
    }
    if (!body.title || !body.body) {
      return json(res, 400, { error: 'title 和 body 必填' });
    }
    const newPost = {
      id: genId('p', data.posts),
      type,
      title: String(body.title).slice(0, 120),
      body: String(body.body).slice(0, 4000),
      author,
      authorVerified: verified,
      createdAt: nowIso(),
      pending,
      comments: [],
    };
    data.posts.push(newPost);
    await writePosts(data);
    return json(res, 201, { post: newPost, pending });
  }

  // 写接口：评论
  const cmtMatch = p.match(/^\/api\/posts\/([\w-]+)\/comments$/);
  if (method === 'POST' && cmtMatch) {
    const body = await readJsonBody(req);
    const data = await readPosts();
    const post = data.posts.find(x => x.id === cmtMatch[1]);
    if (!post || post.pending) return json(res, 404, { error: 'not found' });
    if (!body.body) return json(res, 400, { error: 'body 必填' });
    const newComment = {
      id: genId('c', post.comments),
      author: String(body.author || '匿名').slice(0, 40),
      body: String(body.body).slice(0, 1000),
      createdAt: nowIso(),
    };
    post.comments.push(newComment);
    await writePosts(data);
    return json(res, 201, { comment: newComment });
  }

  // 写接口：审核
  const adminMatch = p.match(/^\/api\/admin\/posts\/([\w-]+)\/(approve|reject)$/);
  if (method === 'POST' && adminMatch) {
    const action = adminMatch[2];
    const data = await readPosts();
    const post = data.posts.find(x => x.id === adminMatch[1]);
    if (!post) return json(res, 404, { error: 'not found' });
    if (action === 'approve') {
      post.pending = false;
      // 审核通过时去掉创建时拼进 author 的「（待审核）」后缀，避免首页出现文字矛盾
      post.author = post.author.replace('（待审核）', '').trim() || post.author;
      await writePosts(data);
      return json(res, 200, { post, action: 'approve' });
    } else {
      data.posts = data.posts.filter(x => x.id !== adminMatch[1]);
      await writePosts(data);
      return json(res, 200, { action: 'reject', id: adminMatch[1] });
    }
  }

  json(res, 404, { error: 'route not found' });
});

server.listen(PORT, () => {
  console.log(`[day7-mvp] listening on http://localhost:${PORT}`);
});