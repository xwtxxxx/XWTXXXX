// P3 装置：给新条目落款时"沿用文档里的日期"，从不现取当天日期。
// 运行：node toys/p3-stale-date.mjs
const DOC_LINE = '2026-09-30 换代到桌面端';              // 文档里那一行（当时的事实）
const reused = DOC_LINE.match(/\d{4}-\d{2}-\d{2}/)[0];   // 直接从文档抠日期当"今天"
const stamp = (id, text) => `### ${id} ${reused} ${text}`;

console.log(stamp('Q1', '新写的一条教训'));
console.log(stamp('Q2', '再写一条'));
console.log('落款来源: 文档（未现取时间）', '| verdict: OK');
