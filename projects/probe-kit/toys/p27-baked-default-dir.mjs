// 中立玩具（P27）：默认值 = 某一台机器的现场（写死的绝对路径）
// 故意犯：无参数时对该写死路径直接做 existsSync 探测，查不到就报"全部合规"、退出 0
import { existsSync, readdirSync } from 'node:fs';

const BAKED = '<外部路径>'; // ← 把某一台真实机器的现场焊进默认值
const dir = process.argv[2] ?? BAKED;
console.log(`清单来源：${process.argv[2] ? '命令行显式传入' : '默认值（作者现场，写死）'}`);
console.log(`检查目录：${dir}`);
console.log(`探测：existsSync(${dir}) = ${existsSync(dir)}`);
const items = existsSync(dir) ? readdirSync(dir) : [];
console.log(`检查了 ${items.length} 项交付件`);
console.log(items.length === 0 ? '未发现交付件 ⇒ 全部合规' : `全部合规（${items.join(', ')}）`);
