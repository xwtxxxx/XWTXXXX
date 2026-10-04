// 中立玩具（P24）：只认顶层 test.mjs 的验收器
// 故意犯：输入长得不像预期（自测在子目录）时静默跳过该检查，仍然报通过、退出 0
import { existsSync, readdirSync, statSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const dir = resolve(process.argv[2] ?? '.');
const subs = readdirSync(dir).filter((n) => statSync(join(dir, n)).isDirectory());
if (!existsSync(join(dir, 'test.mjs'))) {
  console.log('自测  未找到 test.mjs');            // ← 没查到，被当成"没事"
} else {
  console.log('自测  运行 ' + join(dir, 'test.mjs'));
  await import(pathToFileURL(join(dir, 'test.mjs')).href);
}
console.log(`扫描面：${dir}（子目录 ${subs.length} 个：${subs.join(',') || '无'}）`);
console.log(process.exitCode ? `自测失败：exit ${process.exitCode}` : '验收通过：exit 0');
