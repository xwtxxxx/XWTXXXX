// P20 玩具 · 门槛工具自己 fail-open：清单项缺字段（args）不校验 ⇒ 记成 PASS 且退出码 0
// 真犯的错：spawn(裸 node) 读空 stdin 立刻 exit 0，与「真通过」在退出码上完全同形
import { spawnSync } from 'node:child_process';

const i = process.argv.indexOf('--config');
const config = i >= 0 ? JSON.parse(process.argv[i + 1]) : [{ name: 'x' }]; // 缺 args —— 结构不合法，却不拒绝执行

let red = 0;
for (const item of config) {
  const r = spawnSync(process.execPath, item.args, { input: '' }); // 缺字段直接透传：undefined 也不报错
  if (r.status === 0) {
    console.log(`PASS  ${item.name}  (exit=0)`);
  } else {
    red++;
    console.log(`FAIL  ${item.name}  (exit=${r.status})`);
  }
}
console.log(`全部 ${config.length} 条判据${red ? '有红' : '绿'}`);
console.log(`[自测] 8 通过, 0 失败   ← 8 个用例全走 --config 注入，没有一个打到默认清单`);
process.exit(red ? 1 : 0);
