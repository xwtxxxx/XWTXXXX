#!/usr/bin/env node
// card-yaml-lint.mjs — 探针卡「卡面合法性」判据工具
//
// 判什么：一张卡的卡面能不能被当成 YAML 读出来。
// 具体查：**双引号标量内部**出现的 `\X`，若 `X` 不在 YAML 合法转义集内 ⇒ 违规。
//         （YAML 规定：双引号标量里的 `\` 是转义引导符；后跟非法字符时，
//           任何真解析器都会抛 `unknown escape sequence`。）
//
// 用法：node card-yaml-lint.mjs [--dir <卡片目录>] [--quiet] [--json] [--help]
//   默认目录 = 当前工作目录下的 cards
// 退出码：0 = 全部合法；1 = 有违规；2 = 用法/环境错误
//
// 零第三方依赖：检查逻辑自实现（不调用 js-yaml 等任何外部解析器）。

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// YAML 双引号标量合法转义的后继字符全集。
// 依据 YAML 1.1/1.2 规范（js-yaml 实测逐字符核对，见 报告 §判据-2 附录）：
//   单字符转义：0 a b t n v f r e 空格 " / \
//   需后续数字：x(2位) u(4位) U(8位)
//   特殊单字符：N(下一行) _(不换行空格) L(行分隔) P(段分隔)
export const LEGAL_ESCAPES = new Set([
  '0', 'a', 'b', 't', 'n', 'v', 'f', 'r', 'e', ' ',
  '"', '/', '\\', 'N', '_', 'L', 'P', 'x', 'u', 'U',
]);

// 「合法但会静默变形」的转义子集（严格档，--strict-escapes）：
//   控制字符类：\a \v \f \r \n \t \e \0；特殊字符类：\_ \N；以及「反斜杠＋空格」⇒ 普通空格。
//   ⚠️ 只报这一份清单，别自造：\\ \" \/ \xNN \uNNNN \UNNNNNNNN 与 \b \L \P 都**不在**此列（合法且不变形/不在规格内）。
export const DISTORTING_ESCAPES = new Set(['a', 'v', 'f', 'r', 'n', 't', 'e', '0', '_', 'N', ' ']);
const DISTORT_BECOMES = {
  a: 'BEL', v: 'VT', f: 'FF', r: 'CR', n: 'LF', t: 'TAB', e: 'ESC', '0': 'NUL',
  _: '不换行空格', N: '下一行', ' ': '普通空格',
};

const BLOCK_HEADER = /^[ \t]*(?:-[ \t]+|\?[ \t]+)?(?:[^\s#][^:]*?)?:[ \t]+[|>][+-]?[0-9]*[ \t]*(?:#.*)?$/;

/**
 * 扫一段 YAML 文本，返回双引号标量内部的非法转义位置。
 *
 * 只认「双引号标量内部」——以下四种位置一律**不算**违规（`\` 在那里没有转义语义）：
 *   1. 块标量（`key: |` / `key: >` 的内容行）
 *   2. 单引号标量（`'...'`，只把 `''` 当转义）
 *   3. 普通（plain）标量，例如 `核对"声明路径 vs 实际位置"的工具` 里夹带的引号
 *   4. 注释（`#` 之后到行尾）
 *
 * @param {string} text
 * @param {{strict?: boolean}} [opts]  strict＝严格档：在默认判据之上，额外报出双引号标量内
 *        「合法但会静默变形」的转义（\a \v \f \r \n \t \e \0 \_ \N 与 反斜杠＋空格），
 *        命中对象多带一个 `strict: true` 标记；不给 opts 时行为与旧版完全一致。
 * @returns {{hits: Array<{line:number,col:number,esc:string,text:string,strict?:boolean}>}}
 */
export function scanText(text, { strict = false } = {}) {
  const lines = String(text).split(/\r\n|\n|\r/);
  const hits = [];

  let inDQ = false;              // 跨行：是否处在双引号标量内
  let inSQ = false;              // 跨行：是否处在单引号标量内
  let blkParent = null;          // 块标量父行缩进（非 null = 正在块标量内）
  let blkContent = null;         // 块标量内容缩进（首个非空内容行确定）

  for (let li = 0; li < lines.length; li++) {
    const raw = lines[li];
    const lineNo = li + 1;

    // ---- 块标量续行：整行跳过，绝不当标量扫 ----
    if (blkParent !== null) {
      const ind = leadingWidth(raw);
      if (raw.trim() === '') continue;                       // 空行仍属块内容
      if (blkContent === null) {
        if (ind <= blkParent) { blkParent = null; }          // 块是空的，本行按普通行处理
        else { blkContent = ind; continue; }
      }
      if (blkParent !== null) {
        if (ind >= blkContent) continue;                     // 块内容行，跳过
        blkParent = null; blkContent = null;                 // 块到此结束，本行按普通行处理
      }
    }

    // ---- 块标量头：`key: |` / `key: >-` … ----
    if (!inDQ && !inSQ && BLOCK_HEADER.test(raw)) {
      blkParent = leadingWidth(raw);   // 父缩进 = 本行（`key:`）的缩进
      blkContent = null;               // 内容缩进由首个非空内容行确定
      continue;
    }

    // ---- 普通行：逐字符状态机 ----
    let plain = false;             // 当前 token 是否已进入 plain 标量
    for (let i = 0; i < raw.length; i++) {
      const ch = raw[i];

      if (inDQ) {
        if (ch === '\\') {
          const nx = i + 1 < raw.length ? raw[i + 1] : '';
          if (!LEGAL_ESCAPES.has(nx)) {
            hits.push({ line: lineNo, col: i + 1, esc: nx, text: raw });
          } else if (strict && DISTORTING_ESCAPES.has(nx)) {
            // 严格档：合法、能解析，但会静默变成控制字符/空格 —— 与非法转义分开计、分开报
            hits.push({ line: lineNo, col: i + 1, esc: nx, text: raw, strict: true });
          }
          i++;                       // 消费被转义的那个字符（含 \\ 与 \" ）
          continue;
        }
        if (ch === '"') inDQ = false; // 收尾：回到非引号区
        continue;
      }

      if (inSQ) {
        if (ch === "'") {
          if (raw[i + 1] === "'") { i++; continue; }   // '' = 转义的单引号
          inSQ = false;
        }
        continue;
      }

      // —— 非引号区 ——
      if (ch === '#' && (i === 0 || raw[i - 1] === ' ' || raw[i - 1] === '\t')) break; // 注释
      if (ch === ' ' || ch === '\t') continue;
      if (ch === '"') { if (!plain) inDQ = true; continue; }   // plain 里的 " 只是普通字符
      if (ch === "'") { if (!plain) inSQ = true; continue; }
      if (ch === '[' || ch === '{' || ch === ',' || ch === ']' || ch === '}') { plain = false; continue; }
      if (ch === ':' && (i + 1 === raw.length || raw[i + 1] === ' ' || raw[i + 1] === '\t')) { plain = false; continue; }
      if (ch === '-' && !plain && (i + 1 === raw.length || raw[i + 1] === ' ' || raw[i + 1] === '\t')) { plain = false; continue; }
      plain = true;               // 其余字符 ⇒ 一个 plain 标量已经开始了
    }
  }

  return { hits };
}

function leadingWidth(s) {
  const m = /^[ \t]*/.exec(s);
  return m ? m[0].replace(/\t/g, '    ').length : 0;
}

/** 目录内所有卡（*.yaml / *.yml）。 */
export function listCards(dir) {
  return fs.readdirSync(dir)
    .filter((f) => /\.ya?ml$/i.test(f))
    .sort((a, b) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true }));
}

/** 判据主流程：扫目录，返回结果对象（不打印、不退出）。strict＝严格档（见 scanText）。 */
export function lintDir(dir, { strict = false } = {}) {
  const files = listCards(dir);
  const perFile = [];
  let total = 0;
  let strictTotal = 0;
  for (const f of files) {
    const text = fs.readFileSync(path.join(dir, f), 'utf8');
    const { hits } = scanText(text, { strict });
    if (hits.length) {
      perFile.push({ file: f, hits });
      total += hits.length;
      strictTotal += hits.filter((h) => h.strict).length;
    }
  }
  return { dir, files: files.length, total, perFile, strictTotal };
}

function usage(stream) {
  stream.write([
    '用法: node card-yaml-lint.mjs [--dir <卡片目录>] [--strict-escapes] [--quiet] [--json] [--help]',
    '',
    '  检查卡片目录内每张卡「双引号标量内部」是否存在非法 YAML 转义。',
    '  --dir <path>       卡片目录（默认：./cards）',
    '  --strict-escapes   严格档：在默认判据之上，额外报出双引号标量内「合法但会静默变形」的转义',
    '                     （\\a \\v \\f \\r \\n \\t \\e \\0 \\_ \\N 与 反斜杠＋空格 ⇒ BEL/VT/FF/CR/LF/TAB/ESC/NUL/不换行空格/下一行/空格；',
    '                      默认档行为一字不变——不加开关就完全不报这一类）',
    '  --quiet            只输出汇总行',
    '  --json             以 JSON 输出（严格档下命中对象带 strict:true，顶层多一个 strict 计数）',
    '  --help             显示本用法',
    '',
    '  退出码: 0 = 全部合法 / 1 = 有违规 / 2 = 用法或环境错误',
    '',
  ].join('\n'));
}

function main(argv) {
  let dir = 'cards';
  let quiet = false;
  let json = false;
  let strict = false;

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help' || a === '-h') { usage(process.stdout); return 0; }
    else if (a === '--quiet') quiet = true;
    else if (a === '--json') json = true;
    else if (a === '--strict-escapes') strict = true;
    else if (a === '--dir' || a === '-d') {
      dir = argv[++i];
      if (dir === undefined) { process.stderr.write('错误: --dir 需要跟一个目录路径\n'); return 2; }
    } else if (a.startsWith('--dir=')) dir = a.slice(6);
    else { process.stderr.write(`错误: 未知参数 ${a}\n`); usage(process.stderr); return 2; }
  }

  const abs = path.resolve(dir);
  let st;
  try { st = fs.statSync(abs); }
  catch { process.stderr.write(`错误: 目录不存在或不可读: ${abs}\n`); return 2; }
  if (!st.isDirectory()) { process.stderr.write(`错误: 不是目录: ${abs}\n`); return 2; }

  const r = lintDir(abs, { strict });

  if (r.files === 0) {
    process.stderr.write(`错误: 目录内没有 .yaml/.yml 卡片: ${abs}\n`);
    return 2;
  }

  if (json) {
    // 默认档的 JSON 字段与旧版完全一致；严格档下命中对象多带 strict:true、顶层多一个 strict 计数
    const payload = { dir: abs, scanned: r.files, hits: r.total, files: r.perFile };
    if (strict) payload.strict = r.strictTotal;
    process.stdout.write(JSON.stringify(payload, null, 2) + '\n');
    return r.total === 0 ? 0 : 1;
  }

  const out = [];
  if (!quiet) {
    out.push(strict
      ? 'card-yaml-lint · 卡面合法性判据（双引号标量内的非法 YAML 转义 ＋ 严格档：合法但静默变形）'
      : 'card-yaml-lint · 卡面合法性判据（双引号标量内的非法 YAML 转义）');
    out.push(`目录: ${abs}`);
    out.push('');
    if (r.total === 0) {
      out.push('OK 无违规');
    } else {
      for (const { file, hits } of r.perFile) {
        for (const h of hits) {
          const shown = h.esc === '' ? '行尾' : h.esc === ' ' ? '空格' : h.esc;
          if (h.strict) out.push(`${file}:${h.line} 变形转义 \\${shown}（→ ${DISTORT_BECOMES[h.esc]}）`);
          else out.push(`${file}:${h.line} 非法转义 \\${shown}`);
        }
      }
      out.push('');
      out.push('按文件:');
      for (const { file, hits } of r.perFile) out.push(`  ${file}: ${hits.length} 处`);
    }
    out.push('');
  }
  out.push(`扫描 ${r.files} 张卡，命中 ${r.total} 处`);
  process.stdout.write(out.join('\n') + '\n');
  return r.total === 0 ? 0 : 1;
}

const isMain = (() => {
  try {
    const self = fileURLToPath(import.meta.url);
    const arg = process.argv[1] ? path.resolve(process.argv[1]) : '';
    return arg !== '' && path.resolve(self) === arg;
  } catch { return false; }
})();

if (isMain) process.exit(main(process.argv.slice(2)));
