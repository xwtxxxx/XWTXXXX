// P16 玩具装置：逐行「历史段/示例段」状态机型漂移检查器（故意不识别代码围栏）
// 错在哪：状态机被「### 标题」而不是 ``` 围栏驱动 ⇒ 围栏里的 ### P1 示例被当真标题 ⇒
//         「在示例段内」从此恒真 ⇒ 其后的真实漂移被整段跳过 ⇒ 报 0 处、退出码 0（漏）。
// 跑法：node p16-fence-poisons-state.mjs [--fixed]   （--fixed＝识别围栏的正确版本，作对照）
const OLD = '<投递箱>';   // 旧箱名（漂移物证）：文档里出现即违规
const NEW = '任务箱';
const doc = [
  '说明文字',
  '```',
  `### P1 围栏示例（${OLD} 在围栏内，本就不该判）`,
  '```',
  `围栏外的真实漂移：${OLD}（应为 ${NEW}）`,
];
const fixed = process.argv.includes('--fixed');

let inFence = false;     // 正确版本：由 ``` 翻转
let inExample = false;   // 缺陷版本：由 ### 标题翻转
const hits = [];
doc.forEach((line, i) => {
  if (fixed && line.trimStart().startsWith('```')) inFence = !inFence;      // 理想实现：围栏内的行不判
  else if (!fixed && /^#{1,6}\s/.test(line)) inExample = !inExample;        // ← 状态泄漏：把标题当围栏边界
  if (fixed ? inFence : inExample) return;                                  // 围栏内/示例段内不参与判据
  if (line.includes(OLD)) hits.push(`[R1] 第 ${i + 1} 行：旧箱名 \`${OLD}\`（应为 \`${NEW}\`）`);
});
if (hits.length) { hits.forEach((h) => console.log(h)); console.log(`命中漂移 ${hits.length} 处 ⇒ 报警 (exit 1)`); process.exit(1); }
console.log('命中漂移 0 处 ⇒ OK (exit 0)');
