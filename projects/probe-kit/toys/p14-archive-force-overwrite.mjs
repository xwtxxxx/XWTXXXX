// P14 玩具：往「平铺」的done目录归档时用无检查覆盖（Move-Item -Force 的等价物）
// 跑法：node p14-archive-force-overwrite.mjs [盒目录]
import { mkdirSync, writeFileSync, copyFileSync, readFileSync, statSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const box = process.argv[2] ?? join(here, '.tmp-p14');
const done = join(box, 'done-flat');           // 平铺：所有任务共用同一个目录
rmSync(box, { recursive: true, force: true });
mkdirSync(done, { recursive: true });

// 上一单的产出早已躺在平铺目录里 —— 每个任务都产出同名 README.md
const prev = join(box, '前一单-README.md');
writeFileSync(prev, '前一版 README —— 上一单的正文，说明文字很长……\n');
copyFileSync(prev, join(done, 'README.md'));

// 本单的产出，文件名与上一单完全相同
const cur = join(box, '后一单-README.md');
writeFileSync(cur, '后一版\n');
const dst = join(done, 'README.md');
const b = { size: statSync(dst).size, head: readFileSync(dst, 'utf8').split('\n')[0] };
copyFileSync(cur, dst);                         // ← 不检查目标是否已存在，直接覆盖
const a = { size: statSync(dst).size, head: readFileSync(dst, 'utf8').split('\n')[0] };

console.log(`归档前 done-flat/README.md = ${b.size} B ｜ 首行「${b.head}」`);
console.log(`归档后 done-flat/README.md = ${a.size} B ｜ 首行「${a.head}」`);
console.log('归档完成：1 个文件，0 个冲突，退出码 0');
if (box.endsWith('.tmp-p14')) { try { rmSync(box, { recursive: true, force: true }); } catch {} }
process.exit(0);
