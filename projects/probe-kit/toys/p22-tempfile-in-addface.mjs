// P22 玩具 · 提交消息文件写在 git add 覆盖的路径内 ⇒ 临时件被 add 顺手抓进提交历史
// 真犯的错：add 抓的是「那一刻盘上的字节」，与「我打算把它当临时件」无关
import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = fileURLToPath(new URL('.', import.meta.url));
const root = process.argv[2] ?? join(here, '.tmp-p22-root');
const area = join(root, 'proj');                     // add 面 = proj/ 整棵子树
mkdirSync(area, { recursive: true });
writeFileSync(join(area, 'feature.txt'), 'feat: 新功能\n');

const msg = join(area, '_commit-msg.txt');           // ❌ 临时件放在了 add 面之内
writeFileSync(msg, '示例提交消息');

const staged = [];
const walk = (d) => {
  for (const e of readdirSync(d, { withFileTypes: true }).sort((x, y) => x.name.localeCompare(y.name))) {
    const p = join(d, e.name);
    e.isDirectory() ? walk(p) : staged.push(p.slice(root.length + 1).replace(/\\/g, '/'));
  }
};
walk(area);

console.log('$ git add -- proj');
for (const f of staged) console.log(`  A  ${f}`);
console.log(staged.some((f) => f.endsWith('_commit-msg.txt'))
  ? '  ⇒ 临时件 _commit-msg.txt 已进入提交历史（create mode 100644）'
  : '  ⇒ 未污染');

rmSync(msg);                                        // 用完即删：本地干净了，历史里那份删不掉
console.log('清理本地临时件后 git status --short：无输出（工作树干净）—— 但历史里已留下「创建又删除」的临时件');
