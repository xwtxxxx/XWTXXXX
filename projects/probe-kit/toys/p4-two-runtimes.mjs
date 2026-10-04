// P4 装置：把"文档写的路径"当成当次权威，从不现取 —— 现场其实另有一套在跑。
// 运行：node toys/p4-two-runtimes.mjs
import { existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const DOC_TOOL = fileURLToPath(new URL('./vendor/python/python.exe', import.meta.url)); // 文档写的那套
const answer = DOC_TOOL;                        // 装置对「工具在哪」只给文档这一个答案
let reallyRan;
try {
  reallyRan = execFileSync(answer, ['--version'], { encoding: 'utf8' }).trim();  // 照文档那套启动
} catch {
  reallyRan = execFileSync(process.execPath, ['--version'], { encoding: 'utf8' }).trim(); // 静默换掉
}
console.log('装置回答「工具在哪」:', answer);
console.log('文档路径存在:', existsSync(answer));
console.log('实际跑起来的那套:', reallyRan);
console.log('报告口径: 使用文档那套 | verdict: OK');
