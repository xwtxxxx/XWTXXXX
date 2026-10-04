// P16 玩具：编号声明正则写死 P1 ⇒ 区间声明「P9–P99」既不判也不计数 ⇒ 静默 OK
// 跑法：node p16-hardcoded-p1-regex.mjs [--wide]      （--wide 只是同题对照，仍按正确判据）
const doc = [
  '# 交接书',
  '### P17 最新条目',
  '编号声明 P9–P99 已覆盖（该区间里 P16…P99 根本不存在，正确判据应当报警）',
  '正文……',
];
const exists = new Set(Array.from({ length: 17 }, (_, i) => i + 1));   // 真实存在 P1…P17
const NARROW = /^编号声明 P1[–-]P1/;                                   // ← 写死的 P1／M1
const WIDE = /^编号声明 P(\d+)[–-]P(\d+)/;

function check(re, label) {
  let hits = 0; const missing = [];
  for (const line of doc) {
    const m = line.match(re);
    if (!m) continue;
    hits++;
    if (re === WIDE) for (let n = +m[1]; n <= +m[2]; n++) if (!exists.has(n)) missing.push(n);
  }
  const why = missing.length ? `区间内 ${missing.length} 个编号不存在 (exit 1)` : 'OK (exit 0)';
  console.log(`${label}：命中编号声明 ${hits} 条 ⇒ ${why}`);
  return missing.length ? 1 : 0;
}

const wide = process.argv.includes('--wide');
process.exit(check(wide ? WIDE : NARROW, wide ? '放宽正则' : '本轮判定'));
