// P18 玩具：提交门槛只挂第一个判据 ⇒ 另一个判据报红照样提交
// 跑法：node p18-gate-only-first-check.mjs
import { spawnSync } from 'node:child_process';

const checks = [
  ['stage-guard', 'console.log("14/14 通过"); process.exit(0);'],
  ['doc-drift-check', 'console.log("漂移 2 处：编号声明 P1–P16 与实际最大号 P17 不符"); process.exit(1);'],
];

const codes = checks.map(([name, src]) => {
  const r = spawnSync(process.execPath, ['-e', src], { encoding: 'utf8' });
  console.log(`${name}  exit=${r.status}  |  ${String(r.stdout).trim()}`);
  return r.status;
});

if (codes[0] !== 0) { console.log('门槛红 ⇒ 不提交'); process.exit(1); }
console.log(`门槛只取 ${checks[0][0]} 的退出码（=0）⇒ git add . && git commit -m "..." ⇒ 提交成功`);
process.exit(0);
