// Day 15｜/api/health 云函数（Web 函数版）
// 用途：健康检查接口。CloudBase HTTP 网关路由 /api/health -> 本函数，
//       函数内启动 HTTP 服务（Web 函数必须监听 9000 端口），
//       所有请求返回健康检查 JSON。
// 注意：本函数是「Web 函数」类型（创建时用了 HTTP 模板），不是事件函数，
//       所以不能写 exports.main，必须自己 createServer + listen(9000)。

const http = require('http');

// 部署时间戳：每次重新部署前改这里，用来确认公网拿到的是最新一版
const DEPLOYED_AT = '2026-10-04 20:30 (北京时间)';

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify({
    status: 'ok',                                  // 固定 ok，表示服务正常
    service: 'falsity',                            // 项目名
    env: 'falsity001-d1gowkogp40251a26',           // CloudBase 环境 ID
    endpoint: '/api/health',                       // 对外的接口路径
    deployedAt: DEPLOYED_AT,                       // 本次部署时间（核对版本用）
    requestTime: new Date().toISOString(),         // 每次请求的实时时间（证明函数真在跑）
    nodeVersion: process.version,                  // 云端实际运行的 Node 版本
    path: req.url                                  // 函数实际收到的请求路径（调试用）
  }));
});

// Web 函数必须监听 9000 端口，平台会把 HTTP 请求转发进来
server.listen(9000, () => {
  console.log('health function listening on port 9000');
});
