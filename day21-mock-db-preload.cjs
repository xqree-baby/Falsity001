// Day 21 测试用：预加载模块，在 index.js 之前把 db.js 换成 mock。
// 用法：node --require ./day21-mock-db-preload.cjs functions/api/index.js
// 为什么需要它：mock 必须在**同一个进程、同一个 require 缓存**里替换 db.js，
//   父进程替换 spawn 出来的子进程是无效的（Day 21 踩过，全部 503 就是这个原因）。
const path = require('path');
const dbPath = path.join(__dirname, 'functions', 'api', 'db.js');
const realDb = require(dbPath);

const MOCK = {
  p001: {
    id: 'p001', type: 'opinion', category: '职场新人', title: '入职前三个月，别急着证明自己',
    body: '正文内容', author: '带教老陈', author_verified: true, views: 42,
    created_at: '2026-09-18T09:15:00Z',
  },
};
const MOCK_COMMENTS = [
  { id: 'c001', post_id: 'p001', author: '小王', body: '第一条评论', created_at: '2026-09-19T01:00:00Z' },
  { id: 'c002', post_id: 'p001', author: '匿名', body: '第二条评论', created_at: '2026-09-19T02:00:00Z' },
];

// 别的帖子保持原逻辑（走真 dbGet 会因缺 Key 报 503），
// 但只有 p001 在测试里被访问，其余返回 undefined 即可。
require.cache[dbPath].exports = {
  ...realDb,
  findPostForDetail: async (id) => MOCK[id],
  findCommentsByPost: async (id) => (id === 'p001' ? MOCK_COMMENTS : []),
  insertComment: async (row) => ({ ...row }),
};
