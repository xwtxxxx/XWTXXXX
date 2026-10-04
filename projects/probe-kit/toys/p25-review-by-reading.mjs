// 中立玩具（P25）：作者自审 = 只读源码，从不真的跑一遍
// 故意犯：不做交付版 diff、不做探针实测，仅凭"读了源码"就宣布自审通过
const src = [
  'export const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length - 1; // 手滑多减了 1',
  'export const total = (xs) => xs.reduce((a, b) => a + b, 0);',
].join('\n');

console.log(`自审：读了目标源码 ${src.split('\n').length} 行`);
console.log('自审：静态扫描 TODO/FIXME/console.log => ' + (/TODO|FIXME|console\.log/.test(src) ? '发现可疑' : '干净'));
console.log('自审：函数签名齐全 => 是');
console.log('自审通过：无问题（以上结论未运行过任何一行目标代码）');

if (process.argv.includes('--execute')) {
  const avg = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length - 1;
  console.log(`--execute 探针实测：avg([1,2,3]) = ${avg([1, 2, 3])}（真值应为 2）`);
}
