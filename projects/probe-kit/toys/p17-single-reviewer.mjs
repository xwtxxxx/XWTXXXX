// P17 玩具：只跑"一家口径"的审查 ⇒ 漏掉另一家的独有发现
// 跑法：node p17-single-reviewer.mjs [--both]
//       默认只跑甲口径（只看 ### 级历史段标题）；--both 再叠加乙口径（看 ##..#### 级）
const doc = [
  '# 交接书',
  '#### M4 历史段',                 // 只有乙口径认它是历史段边界
  '旧箱名: <投递箱>',          // 该段内的漂移 —— 甲口径根本不会检查到这里
  '### P17 现状',
];

function review(pat) {               // pat 例：'^### ' 或 '^#{2,4} '
  const re = new RegExp(pat);
  let inHist = false, drift = 0;
  for (const line of doc) {
    if (re.test(line)) inHist = true;
    else if (inHist && line.includes('<投递箱>')) drift++;
  }
  return drift;
}

const a = review('^### ');           // 甲口径（只认 ###）
const b = review('^#{2,4} ');        // 乙口径（认 ####）
console.log(`甲口径(只认 ###)：漂移 ${a} 处`);
const both = process.argv.includes('--both');
if (both) console.log(`乙口径(认 ##..####)：漂移 ${b} 处`);
const used = both ? a + b : a;
console.log(`本次审查结论：漂移 ${used} 处 ⇒ ${used ? '不通过 (exit 1)' : '审查通过 (exit 0)'}`);
process.exit(used ? 1 : 0);
