// 中立玩具（P23）：平铺收件箱 + 同名必撞
// 故意犯：往平铺的「review」箱放产出前从不查同名，后一单静默顶替前一单
import { mkdirSync, writeFileSync, readdirSync, statSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const inbox = process.argv[2] ?? 'inbox';
mkdirSync(inbox, { recursive: true });

const orders = [
  { id: '前一单', test: '前一单 自测：' + 'x'.repeat(200), readme: '前一单 说明：' + 'a'.repeat(40) },
  { id: '后一单', test: '后一单 自测：' + 'y'.repeat(120), readme: '后一单 说明：' + 'b'.repeat(12) },
];
for (const o of orders) {
  writeFileSync(join(inbox, 'test.mjs'), o.test);
  writeFileSync(join(inbox, 'README.md'), o.readme);
  console.log(`${o.id} 交付 -> test.mjs ${Buffer.byteLength(o.test)} B ／ README.md ${Buffer.byteLength(o.readme)} B`);
}
console.log('--- 收件方现在看到的箱子 ---');
for (const f of readdirSync(inbox)) {
  const body = readFileSync(join(inbox, f), 'utf8');
  console.log(`${f}  ${statSync(join(inbox, f)).size} B  内容开头：${body.slice(0, 7)}`);
}
console.log('两单交付完成：无重名检查、无告警、exit 0');
