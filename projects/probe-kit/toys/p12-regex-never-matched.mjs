// P12 玩具装置：编号声明自查器（故意写错一个点）
// 错在哪：正则写死「P1」单条声明 ⇒ 「P1–P8」这类区间一条也不匹配 ⇒ 静默通过；
//         且输出没有任何可观测计数，与「全都对」长得一模一样。
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const mode = process.argv[2] === 'bad' ? 'bad' : 'good';
const here = dirname(fileURLToPath(import.meta.url));
const box = join(here, '.tmp-p12');
rmSync(box, { recursive: true, force: true });
mkdirSync(box, { recursive: true });
writeFileSync(join(box, '学习.md'), '### P8 ...\n### P9 ...\n### P10 ...\n');   // 真值：最新编号 P10
writeFileSync(join(box, '交接书.md'), `见学习.md 的 P1–P${mode === 'bad' ? 8 : 10} 段\n`);

const text = readFileSync(join(box, '交接书.md'), 'utf8');
const decl = /^见学习\.md 的 (P1)(?=\s|$)/m.exec(text);   // ← 写死的「P1」，区间声明匹配不到
if (!decl) { console.log('OK 无漂移'); process.exit(0); }
console.log(`查到声明 ${decl[1]}（基准 学习.md 最新编号 P10）`);
console.log('OK 无漂移');
process.exit(0);
