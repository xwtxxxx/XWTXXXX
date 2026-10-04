// P13 玩具装置：路径判据（退修「改松」版）（故意写错一个点）
// 错在哪：为消掉两处假阳性，把所有含 .. 的相对路径整类跳过 —— 该报的也跟着不报了。
import { mkdirSync, writeFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const box = join(here, '.tmp-p13', 'box');
rmSync(join(here, '.tmp-p13'), { recursive: true, force: true });
mkdirSync(box, { recursive: true });
writeFileSync(join(box, '真存在.md'), 'x');
const items = [
  ['.tmp-p13/box/真存在.md', '真存在'],
  ['<repo>/proj/x.mjs', '占位符'],
  ['.tmp-p13/box/__no_such__/', '真不存在'],
  ['.tmp-p13/box/../box/真存在.md', '相对存在'],
  ['.tmp-p13/box/../box/__no_such_x__.md', '相对不存在'],
];
let bad = 0;
for (const [p, kind] of items) {
  if (p.includes('<')) continue;                     // 占位符本就该跳过
  if (process.argv[2] !== 'strict' && p.includes('..')) continue;   // ← 改松：整类跳过
  if (!existsSync(join(here, p))) { console.log(`FAIL 不存在: ${p}  (${kind})`); bad++; }
}
console.log(`路径判据：报出 ${bad} 处 / 共 ${items.length} 项`);
process.exit(bad ? 1 : 0);
