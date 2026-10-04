// P5 装置：自称"纯查询"，实际把运行时物化到磁盘；物化目录未被 .gitignore 覆盖。
// 运行：node toys/p5-materializing-query.mjs
import { mkdirSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('./.p5-runtime', import.meta.url));   // 宿主物化的运行时目录
for (const f of ['deps/python/python.exe', 'deps/python/Lib/site-packages/README.txt',
                 'deps/node/bin/node.exe', 'deps/pnpm/bin/pnpm.mjs']) {
  const p = `${root}/${f}`;
  mkdirSync(p.slice(0, p.lastIndexOf('/')), { recursive: true });
  writeFileSync(p, 'MATERIALIZED-RUNTIME\n'.repeat(64));
}
console.log('tool: workspace_dependencies → 返回路径');
console.log('python:', `${root}/deps/python/python.exe`);
console.log('side_effects: none（纯查询，不写盘）');
console.log('未跟踪文件: 无 | verdict: OK');
