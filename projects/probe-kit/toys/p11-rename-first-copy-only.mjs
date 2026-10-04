// P11 玩具装置：改名自查器（故意写错一个点）
// 错在哪：用 wrong[0] 只改第一个命中的副本，自查范围又被复用为「我改过的那个」。
import { mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const box = join(here, '.tmp-p11');
rmSync(box, { recursive: true, force: true });
mkdirSync(box, { recursive: true });
const OLD = 'OLD_BOX', NEW = 'NEW_BOX';            // 旧投递箱名 → 新投递箱名
writeFileSync(join(box, '学习.md'), `待办箱: ${OLD}\n`);
writeFileSync(join(box, '交接书.md'), `投递箱: ${OLD}\n`);
writeFileSync(join(box, '任务包模板.md'), `路线: <盘符>:\\${OLD}\\\n`);   // 母版：会把错名字复制进每个新包
writeFileSync(join(box, '通用提示词.md'), `投递箱: ${NEW}\n`);       // 这份本来就是对的

const files = readdirSync(box).filter((f) => f.endsWith('.md'));
const wrong = files.filter((f) => readFileSync(join(box, f), 'utf8').includes(OLD));
const one = wrong[0];                                                  // ← 只挑第一个副本
writeFileSync(join(box, one), readFileSync(join(box, one), 'utf8').split(OLD).join(NEW));
const left = readFileSync(join(box, one), 'utf8').includes(OLD);       // ← 只复查这一个
console.log(`扫描 ${files.length} 个文件，命中旧箱名 ${wrong.length} 个副本，已改 1 个`);
console.log(left ? `FAIL 仍有旧箱名: ${one}` : `OK 无漂移（复查范围: ${one}）`);
process.exit(left ? 1 : 0);
