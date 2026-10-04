// 故意犯的错：假设 git 输出的路径可以直接当文件路径用
//   —— 既没强制 `-c core.quotepath=false`，也没用 `-z`。
// 在该仓库（碰巧配了 core.quotepath=false）它看起来完全正常；
// 换到没配过的仓库（默认 quotepath=true），路径变成八进制转义串，它不报错、退出码 0。
import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';

const repo = process.argv[2];
if (!repo) { console.error('用法: node p6-quotepath-assume.mjs <repo>'); process.exit(2); }

const raw = execFileSync('git', ['-C', repo, 'ls-files'], { encoding: 'utf8', maxBuffer: 1 << 28 });
const paths = raw.split('\n').filter(Boolean);

let found = 0;
const missing = [];
for (const p of paths) {
  if (existsSync(join(repo, p))) found++; else missing.push(p);
}

console.log(`git ls-files 报告 ${paths.length} 个路径；按这些路径在磁盘上找到 ${found} 个`);
if (missing.length) console.log(`其中 ${missing.length} 个"找不到"，例：${missing[0]}`);
console.log(found === paths.length ? '结果：全部路径可用' : '结果：部分路径不可用（未报错，退出码仍为 0）');
process.exit(0);
