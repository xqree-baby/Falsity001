// 制造 v1.1「故障版」：故意弄坏页面，用于 Day 26 回滚演练
// 用法: node make-bad.mjs <目标目录>
// ⚠️ 只往指定目录写，绝不碰 public/（v1.0 真身所在）
import fs from 'fs';
import path from 'path';

const dir = process.argv[2];
if (!dir) {
  console.error('用法: node make-bad.mjs <目标目录>');
  process.exit(2);
}

// 先从 public/ 复制一份干净基底，保证只相对 v1.0 改动
for (const f of fs.readdirSync('public')) {
  fs.copyFileSync(path.join('public', f), path.join(dir, f));
}

const idx = path.join(dir, 'index.html');
let s = fs.readFileSync(idx, 'utf8');
const origLen = s.length;

// 故障 1：接口地址指向不存在的域名
//   形态选「页面能渲染但数据全空」——这是真实事故里最常见、最难一眼看出的形态
const goodApi = 'https://falsity001-d1gowkogp40251a26-1499370664.ap-shanghai.app.tcloudbase.com/api';
const badApi = 'https://broken-api-day26.invalid/api';
const apiHits = s.split(goodApi).length - 1;
s = s.split(goodApi).join(badApi);

// 故障 2：站点主标题改坏（一眼可见，作为「坏真的上去了」的直观证据）
//   ⚠️ 真实写法是 <h1>项目 · 经验分享</h1>，不是「首页」——凭印象写替换会静默失败
s = s.replace('<h1>项目 · 经验分享</h1>', '<h1>【v1.1 故障演练】首页已损坏</h1>');

fs.writeFileSync(idx, s, 'utf8');

const after = fs.readFileSync(idx, 'utf8');
console.log(JSON.stringify({
  目标目录: dir,
  原大小: origLen,
  现大小: after.length,
  接口地址替换处数: apiHits,
  已含坏地址: after.includes(badApi),
  已含好地址: after.includes(goodApi),
  已含坏标题: after.includes('v1.1 故障演练'),
}, null, 2));