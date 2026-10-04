// 中立玩具（P26）：抽查「某输入被忽略」，却不带应当报红的对照
// 故意犯：只喂一种输入形态就下结论 —— "真失明"与"正常识别"在输出上不可区分
const doc4 = ['### P24 说明', '### P25 说明', '#### P99 不该存在的编号'].join('\n');
const doc3 = ['### P24 说明', '### P25 说明', '### P99 不该存在的编号'].join('\n');

const scan = (doc) => {
  const ids = [...doc.matchAll(/^### P(\d+)/gm)].map((m) => Number(m[1])); // ← 只认 3 级标题
  const i = ids.findIndex((n, k) => k > 0 && n !== ids[k - 1] + 1);
  return i < 0
    ? `OK：未发现违规（识别到 P×${ids.length}：${ids.join(',')}）`
    : `P 编号跳号：${ids[i - 1]} 之后是 ${ids[i]}`;
};
const cases = [['#### P99（4 级）', doc4]];
if (process.argv.includes('--control')) cases.push(['### P99（3 级，对照）', doc3]);
for (const [label, doc] of cases) {
  const r = scan(doc);
  console.log(`夹具 ${label} => ${r}`);
  if (r.startsWith('P 编号跳号')) process.exitCode = 1;
}
