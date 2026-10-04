// P10 玩具装置：任务包自洽检查器（故意写错一个点）
// 错在哪：它核对「交付物是否与任务包同目录」，却从不核对包内那行声明的投递路径（打印了却不用）。
import { mkdirSync, writeFileSync, readFileSync, existsSync, rmSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const kit = join(here, '.tmp-p10');
rmSync(kit, { recursive: true, force: true });
const box = join(kit, '任务');                     // 搬家后的正确箱子：包与交付物都在这里
mkdirSync(box, { recursive: true });
mkdirSync(join(kit, '务'), { recursive: true });   // 包里写着的旧箱子（空）
writeFileSync(join(box, '交付说明.md'), '# 交付说明\n');
const pkg = join(box, '任务包.md');
writeFileSync(pkg, `# 任务包\n第七节 投递位置: ${join(kit, '务')}\n`);

const declared = readFileSync(pkg, 'utf8').match(/投递位置:\s*(.+)/)[1].trim();
console.log(`任务包内声明的投递位置: ${declared}`);
console.log(`任务包实际所在目录:     ${dirname(pkg)}`);
console.log(`声明目录里有交付物吗:   ${existsSync(join(declared, '交付说明.md'))}`);
if (!existsSync(join(dirname(pkg), '交付说明.md'))) { console.log('FAIL 交付物不在包所在目录'); process.exit(1); }
console.log('OK 任务包自洽');
process.exit(0);
