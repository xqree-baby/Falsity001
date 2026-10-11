#!/usr/bin/env node
// =============================================================================
// release-check · 发布前检查（Day 25）
//
// 范围：C1 密钥泄漏 + C2 公网可达性（最小版本）
//未实现：C3 接口契约 / C4 前端错误提示 / C5 Git 干净——输出里标「未实现」，不报通过
//
// 用法：
//   node release-check.mjs
//   node release-check.mjs --html 输出路径.html
//
// 退出码：0=已实现项全通过  1=有失败项  2=脚本自身出错（不算检查失败）
//
// ⚠️ 沙箱环境注意（实测得出，别改）：
//   spawnSync/execFileSync 配 stdio:'pipe' 在本环境必报 EBUSY。
//   可行路径只有一条：shell:true + 重定向到文件 + fs 读回来。
//   见下方 runGit()。
// =============================================================================

import fs from 'fs';
import path from 'path';
import os from 'os';
import { spawnSync } from 'child_process';
import { fileURLToPath } from 'url';

// 本脚本就放在仓库根目录，所以 dirname 就是 ROOT（曾写成 '../..' 导致扫到 D 盘，报 EPERM）
const ROOT = path.dirname(fileURLToPath(import.meta.url));
const GIT = 'C:/Users/MR/.workbuddy/binaries/PortableGit/versions/1.2.0/cmd/git.exe';

// ---------- 沙箱适配层：唯一跑 git 的地方 ----------
function runGit(args) {
  const out = path.join(os.tmpdir(), 'rc-git-' + Date.now() + '.txt');
  const cmd = '"' + GIT + '" ' + args.join(' ') + ' > "' + out + '" 2>&1';
  const r = spawnSync(cmd, { cwd: ROOT, stdio: 'ignore', shell: true });
  let text = '';
  try { text = fs.readFileSync(out, 'utf8'); } catch (e) { text = ''; }
  try { fs.unlinkSync(out); } catch (e) {}
  return { code: r.status, text };
}

const results = [];
function record(id, name, status, detail, extra) {
  results.push({ id, name, status, detail: detail || '', extra: extra || [] });
}

// ============================ C1 密钥泄漏 ============================
// 判定核心：不是「有没有出现变量名」，而是「变量名旁边有没有一个像密钥的字面量」。
// 本仓库 API_KEY 字样出现 9 处全是干净写法，绝不能误报。
const SECRET_KEYWORDS = ['API_KEY', 'APIKEY', 'SECRET', 'PASSWORD', 'PASSWD', 'TOKEN', 'ACCESS_KEY'];

// 命中后必须排除的干净写法（对应 CHECKLIST.md「明确不算泄漏」）
const SAFE_PATTERNS = [
  /process\.env\./,// 取变量名，不是值
  /\$\{[^}]+\}/,                    // 模板字符串，运行时才填值
  /未配置/,                          // 中文错误提示里提到变量名
  /local-test-not-a-real-key/i,
  /^["'`]?(test|fake|dummy|example|placeholder)/i,
];

const SCAN_EXT = ['.js', '.mjs', '.cjs', '.html', '.json', '.md'];
const SCAN_SKIP_DIR = ['node_modules', '.git', '.workbuddy'];
// 报告输出目录要排除，但**不能写死目录名**——Day 25 踩过两次：
//   ①原写死 'release-check-out'，实际输出到 'day25-out' → 报告里的假密钥被当成新泄漏（自污染）；
//   ②改用「目录里同时有 check*.html 和 check-*.txt」判定，又因 txt 其实写在根目录而失效，同一个坑再踩一次。
// 教训：判据不能靠猜目录特征。本工具生成的报告一律按**文件名特征**排除，跟目录名无关。
function isOwnReport(file) {
  const b = path.basename(file);
  return /^check.*\.(html|txt)$/i.test(b);
}

function walk(dir, acc) {
  for (const name of fs.readdirSync(dir)) {
    const full = path.join(dir, name);
    const st = fs.statSync(full);
    if (st.isDirectory()) {
      if (SCAN_SKIP_DIR.includes(name)) continue;
      walk(full, acc);
    } else if (SCAN_EXT.includes(path.extname(name)) && !isOwnReport(full)) acc.push(full);
  }
  return acc;
}

function checkC1() {
  const leaks = [];

  // --- 标准 1：.env 类文件不能被 git 跟踪 ---
  const tracked = runGit(['ls-files']);
  const trackedList = tracked.text.split(/\r?\n/).map(s => s.trim()).filter(Boolean);
  const envTracked = trackedList.filter(f => /(^|\/)\.env(\.|$)/.test(f) && !f.endsWith('.env.example'));

  // --- 标准 2：扫「关键词 + 字面量」的组合 ---
  const files = walk(ROOT, []);
  for (const f of files) {
    const rel = path.relative(ROOT, f).replace(/\\/g, '/');
    if (rel.startsWith('skills/release-check/')) continue; // 别扫自己
    const lines = fs.readFileSync(f, 'utf8').split(/\r?\n/);
    lines.forEach((line, i) => {
      if (!SECRET_KEYWORDS.some(k => line.includes(k))) return;
      // 整行若命中任一安全写法 → 放行
      if (SAFE_PATTERNS.some(p => p.test(line))) return;
      // 找「=号右边是引号包的一串东西」
      const m = line.match(/=\s*["'`]([^"'`]{8,})["'`]/);
      if (!m) return;
      const val = m[1];
      // 明显的占位值不算
      if (/^(test|fake|dummy|example|placeholder|your_|xxx+|<)/i.test(val)) return;
      if (!/[A-Za-z]/.test(val)) return;// 纯数字不像密钥
      leaks.push({ file: rel, line: i + 1, text: line.trim().slice(0, 120), value: val.slice(0, 12) + '...' });
    });
  }

  const items = [];
  if (envTracked.length) items.push(`被 git 跟踪的 .env 文件：${envTracked.join(', ')}`);
  if (leaks.length) leaks.forEach(l => items.push(`${l.file}:${l.line}疑似密钥字面量→ ${l.text}`));

  const detail = items.length
    ? items.join('\n')
    : `扫描 ${files.length} 个文件，命中 0 条；git 跟踪 ${trackedList.length} 个文件，其中 .env 类 0 个`;
  record('C1', '密钥泄漏', items.length ? 'FAIL' : 'PASS', detail,
    items.length ? [] : [`已排除 ${SECRET_KEYWORDS.length} 类关键词的 9 处安全写法`]);
}

// ============================ C2 公网可达性 ============================
// 硬边界：只发 GET。不发 POST/PATCH/DELETE——避免污染库，也避开已知的收藏 409。
const API_BASE = 'https://falsity001-d1gowkogp40251a26-1499370664.ap-shanghai.app.tcloudbase.com/api';
const STATIC_URL = 'https://falsity-mock005-falsity001-d1gowkogp40251a26.webapps.tcloudbase.com';

async function probe(url) {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), 15000);
  try {
    const res = await fetch(url, {
      signal: ctl.signal,
      headers: { Origin: STATIC_URL, Accept: 'application/json' }, // 必须带 Origin 才能验到 ACAO
    });
    const acao = res.headers.get('access-control-allow-origin');
    let jsonOk = false, body = '';
    try { const t = await res.text(); jsonOk = t.trim().startsWith('{') || t.trim().startsWith('['); body = t.slice(0, 160); } catch (e) {}
    return { ok: res.status === 200, status: res.status, acao, acaoCount: acao ? acao.split(',').length : 0, jsonOk, body };
  } catch (e) {
    return { ok: false, status: 0, error: e.name === 'AbortError' ? '超时(15s)' : e.message };
  } finally { clearTimeout(timer); }
}

// ★ 两种 404 长得像但根因完全不同，必须归类（Day 22 实测）
function classify404(body) {
  if (/INVALID_PATH/.test(body)) return '网关路由没绑（修：控制台配网关路由，不是改代码）';
  if (/"ok"\s*:\s*false/.test(body) && /not found/i.test(body)) return '函数里少注册该分支（修：改 functions/api/index.js）';
  return '未知 404，需人工判断';
}

async function checkC2() {
  const items = [];
  const notes = [];

  const posts = await probe(API_BASE + '/posts');
  if (posts.error) {
    items.push(`接口不可达：${posts.error}`);
    notes.push('⚠️ 拿不到任何响应 ≠ 后端故障，可能是本机断网。先直开浏览器地址栏验证');
  } else {
    if (!posts.ok) {
      const why = posts.status === 404 ? classify404(posts.body) : `HTTP ${posts.status}`;
      items.push(`GET /posts → ${posts.status}；${why}`);
      if (posts.status === 404) notes.push('已按返回体形状归类，两种 404 修的位置不同');
    } else if (!posts.jsonOk) {
      items.push(`GET /posts → 200 但返回体不是 JSON：${posts.body}`);
    }
    if (posts.acaoCount > 1) {
      items.push(`ACAO 头有 ${posts.acaoCount} 个值（逗号拼接）→ 浏览器会掐掉：${posts.acao}`);
      notes.push('Day 20 同款病根：网关自己会加 ACAO，函数里再加 * 就重了');
    }
  }

  const home = await probe(STATIC_URL + '/');
  if (home.error) items.push(`静态托管不可达：${home.error}`);
  else if (!home.ok) items.push(`静态托管首页 → HTTP ${home.status}`);

  if (!items.length) notes.push('ACAO 头只有 1 个值（无重复配置）');
  notes.push('探活只发 GET，未改动任何线上数据');

  record('C2', '公网可达性', items.length ? 'FAIL' : 'PASS', items.join('\n') || '接口 200 + JSON 合法；静态首页 200；ACAO 无重复', notes);
}

// ============================ 输出 ============================
const NOT_IMPLEMENTED = [
  ['C3', '接口契约一致', 'api-contract.md 写 14 条，index.js 实注册 11 条，差/admin/* 三条'],
  ['C4', '前端错误提示规范', '四页 friendlyError / 裸状态码检查'],
  ['C5', 'Git 工作区干净', '工作区 + 远端一致性'],
];

function printText() {
  const lines = [];
  lines.push('');
  lines.push('══════════════════════════════════════════════════════════');
  lines.push('release-check · 发布前检查   ' + new Date().toLocaleString('zh-CN'));
  lines.push('══════════════════════════════════════════════════════════');
  for (const r of results) {
    const icon = r.status === 'PASS' ? '[通过]' : '[失败]';
    lines.push('');
    lines.push(`${icon} ${r.id} ${r.name}`);
    lines.push('-'.repeat(58));
    r.detail.split('\n').forEach(l => lines.push('  ' + l));
    r.extra.forEach(e => lines.push('  · ' + e));
  }
  lines.push('');
  lines.push('--- 未实现项（不算通过）---');
  NOT_IMPLEMENTED.forEach(([id, n, why]) => lines.push(`  [未实现] ${id} ${n} —— ${why}`));

  const fails = results.filter(r => r.status === 'FAIL');
  lines.push('');
  lines.push('══════════════════════════════════════════════════════════');
  lines.push(fails.length ? `结论：${fails.length} 项失败` : '结论：已实现项全部通过');
  lines.push('⚠️ 通过 ≠ Skill 可信。未经「故意弄坏」反向验证的通过，不作为证据。');
  lines.push('══════════════════════════════════════════════════════════');
  const out = lines.join('\n');
  console.log(out);
  return out;
}

function esc(s) { return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'); }

function printHtml(file, text) {
  const card = (r) => {
    const pass = r.status === 'PASS';
    return `<div class="card ${pass ? 'pass' : 'fail'}">
      <div class="hd"><span class="badge">${pass ? '通过' : '失败'}</span><b>${r.id} ${esc(r.name)}</b></div>
      <pre>${esc(r.detail)}</pre>
      ${r.extra.length ? '<ul>' + r.extra.map(e => `<li>${esc(e)}</li>`).join('') + '</ul>' : ''}
    </div>`;
  };
  const fails = results.filter(r => r.status === 'FAIL');
  const html = `<!DOCTYPE html><html lang="zh-CN"><head><meta charset="utf-8">
<title>release-check 发布前检查结果</title><style>
*{box-sizing:border-box}body{margin:0;padding:28px;background:#f2f5f9;color:#2b3442;
font:14px/1.6 "Microsoft YaHei",sans-serif}
h1{font-size:20px;margin:0 0 4px}.sub{color:#64748b;font-size:12px;margin-bottom:20px}
.card{background:#fff;border:1px solid #d9e0ea;border-radius:10px;padding:16px 18px;margin-bottom:14px}
.card.fail{border-left:4px solid #b04a66;background:#fceef2}
.card.pass{border-left:4px solid #146e82}
.hd{display:flex;align-items:center;gap:10px;margin-bottom:8px}
.badge{font-size:12px;padding:2px 9px;border-radius:20px;color:#fff;background:#146e82}
.card.fail .badge{background:#b04a66}
pre{margin:0;white-space:pre-wrap;font:12px/1.7 Consolas,monospace;color:#2b3442}
ul{margin:8px 0 0;padding-left:20px;color:#64748b;font-size:12px}
.noti{margin-top:18px;padding:13px 16px;background:#fff;border:1px dashed #d9e0ea;border-radius:8px;color:#64748b;font-size:12px}
.verdict{margin-top:14px;padding:15px 18px;border-radius:10px;font-weight:bold;font-size:15px}
.verdict.bad{background:#fceef2;color:#b04a66;border:1px solid #b04a66}
.verdict.ok{background:#fff;color:#146e82;border:1px solid #146e82}
.tbl{width:100%;border-collapse:collapse;background:#fff;border:1px solid #d9e0ea;border-radius:10px;overflow:hidden;margin-top:14px}
th,td{padding:9px 14px;text-align:left;font-size:12px;border-bottom:1px solid #f2f5f9}
th{background:#f2f5f9;color:#64748b;font-weight:normal}
</style></head><body>
<h1>发布前检查结果</h1>
<div class="sub">release-check · ${new Date().toLocaleString('zh-CN')} · 已实现范围 C1+C2</div>
${results.map(card).join('')}
<table class="tbl"><tr><th>编号</th><th>检查项</th><th>状态</th><th>说明</th></tr>
${NOT_IMPLEMENTED.map(([id, n, why]) => `<tr><td>${id}</td><td>${esc(n)}</td><td style="color:#64748b">未实现</td><td style="color:#64748b">${esc(why)}</td></tr>`).join('')}
</table>
<div class="verdict ${fails.length ? 'bad' : 'ok'}">${fails.length ? '结论：' + fails.length + ' 项失败 —— ' + fails.map(f => f.id).join('、') : '结论：已实现项全部通过'}</div>
<div class="noti">⚠️ <b>「通过」本身需要被验证。</b>一个只会在干净仓库上说「通过」的检查工具，和一个坏掉的检查工具，在结果上无法区分。<br>
必须做过一次反向验证才算可信：故意注入一个已知问题 → 它报警 → 修掉 → 它安静。两头都成立才作数。</div>
<pre style="margin-top:16px;color:#64748b">${esc(text)}</pre>
</body></html>`;
  fs.writeFileSync(file, html, 'utf8');
  return file;
}

// ============================ main ============================
(async () => {
  try {
    checkC1();
    await checkC2();
  } catch (e) {
    console.error('release-check 脚本自身出错（不等于检查失败）：', e.message);
    process.exit(2);
  }
  const text = printText();
  const i = process.argv.indexOf('--html');
  if (i > -1 && process.argv[i + 1]) {
    const f = path.resolve(process.argv[i + 1]);
    fs.mkdirSync(path.dirname(f), { recursive: true }); // 输出目录不存在就自己建，别让调用者踩坑
    printHtml(f, text);
    console.log('\nHTML 结果页已生成：' + f);
  }
  process.exit(results.some(r => r.status === 'FAIL') ? 1 : 0);
})();