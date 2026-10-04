// P21 玩具 · 独立审查的局部视角：审查范围只有「工具本体」一个文件 ⇒ 看不到调用链
// 真犯的错：把「重复的判据」判成「结构性恒绿、拦不住任何东西」，结论与调用方事实相反
import { readFileSync } from 'node:fs';

const TOOL = [
  ' 1  // check-all.mjs（被审查的工具本体）',
  ' 5  function runAll() {',
  '12    const stage = checkStage();   // STAGE_GUARD',
  '20    for (const c of checks) run(c);',
  '34    git("add", "--", "./proj");  // GIT_ADD',
  '40  }',
].join('\n');
const CALLER = [
  '30  param($Files)',
  '34  git add -- $Files             // GIT_ADD',
  '39  if (Test-StageGuard) { throw } // STAGE_GUARD（调用方自己的独立门禁）',
].join('\n');

const scan = (src, key) => {
  const lines = src.split('\n');
  const l = lines.findIndex((x) => x.includes(key));
  return { line: Number(lines[l].trim().split(/\s+/)[0]), text: lines[l].trim().replace(/^\d+\s+/, '') };
};

const arg = process.argv.slice(2).find((x) => !x.startsWith('--'));
const tool = arg ? readFileSync(arg, 'utf8') : TOOL;
const g = scan(tool, 'STAGE_GUARD');
const a = scan(tool, 'GIT_ADD');
console.log(`审查范围：仅 1 个文件（工具本体${arg ? ` ${arg}` : ''}）；调用方未纳入`);
console.log(`  :${g.line}  ${g.text}`);
console.log(`  :${a.line}  ${a.text}`);
console.log(g.line < a.line
  ? '结论：FAIL 结构性问题 —— stage-guard 跑在 git add 之前 ⇒ 暂存区必然为空 ⇒ 该判据结构性恒绿，拦不住任何东西'
  : '结论：PASS');

if (process.argv.includes('--context')) {
  const cg = scan(CALLER, 'STAGE_GUARD');
  const ca = scan(CALLER, 'GIT_ADD');
  console.log(`[调用方事实] :${ca.line} git add → :${cg.line} 独立 stage-guard 门禁（在 add 之后执行）⇒ 防护真实有效，上面那条结论是误判`);
}
