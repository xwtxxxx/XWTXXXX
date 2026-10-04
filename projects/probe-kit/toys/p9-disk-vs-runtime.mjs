// 故意犯的错：把"删掉磁盘上的记录"当成"清掉了运行时列表"。
//   磁盘目录删干净了（0 个），但当前会话内存里仍持有这些外部 agent ⇒
//   "列表还在、内容已经没了"的两层不一致，而装置按磁盘判据宣布"清理完成"、退出码 0。
import { mkdirSync, writeFileSync, rmSync, readdirSync } from 'node:fs';
import { join } from 'node:path';

const disk = new URL('./.p9-scratch/', import.meta.url).pathname.replace(/^\//, '');
rmSync(disk, { recursive: true, force: true });

const runtime = [];                     // ② 运行时注册表（当前会话内存 / 界面看到的那份）
for (let n = 1; n <= 3; n++) {
  const id = `agent-${n}`;
  runtime.push(id);                     // 注册在内存
  mkdirSync(join(disk, id), { recursive: true });
  writeFileSync(join(disk, id, 'session.json'), JSON.stringify({ id }));
}

for (const id of readdirSync(disk)) rmSync(join(disk, id), { recursive: true });   // ① 清磁盘
const onDisk = readdirSync(disk).length;

console.log(`删盘后磁盘剩余目录: ${onDisk} 个`);
console.log(`list_agents() 仍返回 children: ${runtime.length} 个 -> ${runtime.join(', ')}`);
console.log(onDisk === 0 ? '按磁盘判据：清理完成' : '按磁盘判据：清理失败');
rmSync(disk, { recursive: true, force: true });
process.exit(0);
