// P19 玩具 · 判据过宽：把「区间末尾号 == 全局最大号」当成对**任意**区间都成立的判据
// 真犯的错：局部区间引用 P9–P12 被判成「与实际最大号 P18 不符」⇒ 假红噪音（fail-safe 方向，但报错是错的）
import { readFileSync } from 'node:fs';

const SAMPLE = [
  '## 最近完成',
  '- P1–P18 全部完成（全集声明）',
  '- 当时抓到 P9–P12 的顺序问题（历史叙述，局部引用）',
  '- 当前最大号 P18',
].join('\n');

const text = process.argv[2] ? readFileSync(process.argv[2], 'utf8') : SAMPLE;
const max = Math.max(...[...text.matchAll(/P(\d+)/g)].map((m) => Number(m[1])));

let noise = 0;
for (const m of text.matchAll(/P(\d+)\s*[–—-]\s*P(\d+)/g)) {
  if (Number(m[2]) !== max) {
    noise++;
    console.log(`FAIL  doc-drift-check  [R3]  编号声明 ${m[0]} 与实际最大号 P${max} 不符`);
  }
}
console.log(noise ? `全部 1 条判据红（其中噪音 ${noise} 条，真问题 0 条）exit=1` : '全部 1 条判据绿 exit=0');
process.exit(noise ? 1 : 0);
