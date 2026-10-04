// P15 玩具：自测夹具建在「脚本所在目录之外」，且不预检夹具是否建得成
// 跑法：node p15-fixture-outside-scriptdir.mjs [夹具根]
//       不给参数 ⇒ 默认取脚本目录的上一级（脚本目录之外，但本机可写）
//       给不可写的 cwd 外路径 ⇒ 13 条用例全部"失败"
import { mkdirSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
// 正确做法是 join(here, '.tmp-...')；本装置故意取"脚本所在目录之外"
const root = resolve(process.argv[2] ?? join(here, '..', '.tmp-p15-fixture'));
let pass = 0, fail = 0;
try { mkdirSync(root, { recursive: true }); } catch { /* 建不成也不报 */ }   // ← 静默跳过预检

for (let i = 0; i < 13; i++) {
  try { writeFileSync(join(root, `case-${i}.txt`), 'x'); pass++; }
  catch { fail++; }                                        // ← 环境错被记成"用例失败"
}
pass++;                                                    // 第 14 条不依赖夹具

console.log(`夹具根: ${root}`);
console.log(`pass=${pass} fail=${fail}`);
if (root.endsWith('.tmp-p15-fixture')) { try { rmSync(root, { recursive: true, force: true }); } catch {} }
process.exit(fail === 0 ? 0 : 1);
