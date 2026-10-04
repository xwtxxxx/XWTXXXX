#!/usr/bin/env node
/**
 * card-contract-lint.mjs —— 探针卡「契约校验器」
 *
 * 依据：JUDGE.md v1.2 · §6「不合格的卡」12 条中**可机器判定**的 7 条。
 * 形态：零第三方依赖单文件。自写 YAML 子集读取（顶层键 / 块标量 / 行内标量 / 流式集合 / verify 嵌套序列）。
 * 退出码：0 = 无命中 ｜ 1 = 有命中（≥1 张卡不合格，含"读取异常"）｜ 2 = 用法／环境错误。
 *
 * ⚠ 诚实条款：本工具**不**等于"卡合格"。它只跑下面 7 项；
 *   §6-4／§6-6／§6-8／§6-9／§6-12 属语义判断，本工具**不检查**（运行报告的「未检查项」一节逐条列出）。
 *   "--cards 之外没有 --toys ⇒ 第 6 项的『装置存在性』没跑" 这件事**会显式打印**，
 *   绝不与"查过了没问题"混同（每项都带 status: ok | hit | skipped）。
 */

import fs from 'node:fs';
import path from 'node:path';

const TOOL = 'card-contract-lint';
const VERSION = '1.0.0';
const CONTRACT = 'JUDGE.md v1.2';

// ---------------------------------------------------------------------------
// 检查清单（id / 契约出处 / 标题 / 作用字段）
// ---------------------------------------------------------------------------
const CHECK_META = [
  { id: 1, rule: '§6-3',  title: '缺 verify，或 verify 写着"未实测"',                    scope: 'verify' },
  { id: 2, rule: '§6-2',  title: 'expect 不可判定（缺「报警／漏」两态）',                scope: 'expect' },
  { id: 3, rule: '§6-10', title: 'verify 只有一个标本，且未写"无对应装置"',              scope: 'verify' },
  { id: 4, rule: '§6-7',  title: 'evidence 里没有具体数字/命令',                        scope: 'evidence' },
  { id: 5, rule: '§6-5',  title: '要求联网／第三方依赖',                                scope: 'inject,run,deps' },
  { id: 6, rule: '§6-11', title: 'run 点名的 toys/ 装置不存在，或与 verify 中立标本对不上', scope: 'run,verify' },
  { id: 7, rule: '§6-1',  title: 'inject 只有描述、没有可跑步骤',                        scope: 'inject' },
];

// 本工具「声明不做」的语义条目（运行报告「未检查项」一节同步单列）
const NOT_DONE = [
  { rule: '§6-4', title: '只对本库有效（依赖 <repo>、两件套文件名、中文目录名）' },
  { rule: '§6-6', title: '只测"工具能不能跑"，不测"它会不会漏"' },
  { rule: '§6-8', title: 'inject 没有"自证注入生效"（＝空操作）' },
  { rule: '§6-9', title: 'expect 读的是被测装置自己打印出来的数字（须锚独立真值）' },
  { rule: '§6-12', title: 'limits 在"已知有平台/环境差异"时留空（这种卡最该写 limits）' },
];

// ---------------------------------------------------------------------------
// 自写 YAML 子集读取（不做完整 YAML 解析；只取本工具需要的字段）
// ---------------------------------------------------------------------------

/** 去掉 UTF-8 BOM */
function stripBom(s) {
  return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s;
}

/** 行内标量/流式集合：去掉最外层引号，仅为打印好看；匹配用原文 */
function unquote(s) {
  const t = s.trim();
  if (t.length >= 2 && t[0] === '"' && t[t.length - 1] === '"') return t.slice(1, -1);
  if (t.length >= 2 && t[0] === "'" && t[t.length - 1] === "'") return t.slice(1, -1);
  return t;
}

/**
 * 读一张卡：返回 { fields, flatLines }
 * fields[key] = { kind: 'block' | 'inline' | 'nested', text, line }
 */
function readCard(text) {
  const src = stripBom(text);
  const lines = src.split(/\r?\n/);
  const fields = {};
  let i = 0;

  while (i < lines.length) {
    const raw = lines[i];
    if (raw.trim() === '' || /^\s*#/.test(raw)) { i++; continue; }

    const m = /^([A-Za-z_][A-Za-z0-9_-]*):(.*)$/.exec(raw);
    if (!m) { i++; continue; } // 缩进行/非顶层行：顶层扫描阶段跳过

    const key = m[1];
    const rest = m[2];
    const startLine = i + 1;

    // ① 值在下一层（如 verify:）—— 收编后续所有缩进行
    if (rest.trim() === '') {
      const block = [];
      let j = i + 1;
      while (j < lines.length) {
        const l = lines[j];
        if (l.trim() === '' || /^\s/.test(l)) { block.push(l); j++; continue; }
        break;
      }
      while (block.length && block[block.length - 1].trim() === '') block.pop();
      fields[key] = { kind: 'nested', text: block.join('\n'), line: startLine };
      i = j;
      continue;
    }

    const t = rest.trim();

    // ② 块标量 `|` / `>`（含 chomping 指示符）
    if (/^[|>][+-]?[0-9]*$/.test(t)) {
      const block = [];
      let j = i + 1;
      let baseIndent = null;
      while (j < lines.length) {
        const l = lines[j];
        if (l.trim() === '') { block.push(''); j++; continue; }
        const ind = l.length - l.trimStart().length;
        if (ind === 0) break; // 回到顶层 ⇒ 块结束
        if (baseIndent === null) baseIndent = ind;
        block.push(ind >= baseIndent ? l.slice(baseIndent) : l.trimStart());
        j++;
      }
      while (block.length && block[block.length - 1].trim() === '') block.pop();
      fields[key] = { kind: 'block', text: block.join('\n'), line: startLine };
      i = j;
      continue;
    }

    // ③ 行内标量 / 流式集合
    fields[key] = { kind: 'inline', text: t, line: startLine };
    i++;
  }

  return { fields };
}

/** 取字段文本（block/nested/inline 统一成一个字符串） */
function fieldText(card, key) {
  const f = card.fields[key];
  return f ? f.text : '';
}

/** 解析 verify 的嵌套序列 → specimens[] */
function parseSpecimens(card) {
  const v = card.fields.verify;
  if (!v || v.kind !== 'nested') return [];
  const out = [];
  let cur = null;
  for (const l of v.text.split('\n')) {
    const m1 = /^\s*-\s+([A-Za-z_][A-Za-z0-9_-]*):(.*)$/.exec(l);
    if (m1) { if (cur) out.push(cur); cur = { __raw: l }; cur[m1[1]] = unquote(m1[2]); continue; }
    const m2 = /^\s+([A-Za-z_][A-Za-z0-9_-]*):(.*)$/.exec(l);
    if (m2 && cur) { cur[m2[1]] = unquote(m2[2]); continue; }
    if (cur && l.trim() !== '') cur.__raw += '\n' + l.trim();
  }
  if (cur) out.push(cur);
  return out;
}

/** 从一段文本里抽出所有 `toys/<文件名>` 的装置名 */
function toysNamesIn(text) {
  const names = [];
  for (const m of String(text).matchAll(/toys\/([A-Za-z0-9._-]+\.[A-Za-z0-9]+)/g)) names.push(m[1]);
  return [...new Set(names)];
}

// ---------------------------------------------------------------------------
// 7 项检查
// ---------------------------------------------------------------------------

/** §6-3 —— 缺 verify，或 verify 写着"未实测" */
function check1_verifyMissing(card) {
  const v = card.fields.verify;
  if (!v) return [{ field: 'verify', message: '缺 verify 字段' }];
  if (/未实测/.test(v.text)) return [{ field: 'verify', message: 'verify 写着"未实测"（＝这张卡不算完成）' }];
  if (v.kind !== 'nested' || v.text.trim() === '') {
    return [{ field: 'verify', message: 'verify 不是实测记录（无标本列表）' }];
  }
  return [];
}

/** §6-2 —— expect 不可判定：§4 要求同时写清"什么算报警、什么算漏" */
function check2_expectUndecidable(card) {
  const e = card.fields.expect;
  if (!e) return [{ field: 'expect', message: '缺 expect 字段' }];
  const t = e.text;
  const hasAlarm = /报警/.test(t);
  const hasMiss = /漏/.test(t);
  const hits = [];
  if (!hasAlarm && !hasMiss) hits.push({ field: 'expect', message: 'expect 没有「报警／漏」两态 ⇒ 第三方无法判定' });
  else if (!hasAlarm) hits.push({ field: 'expect', message: 'expect 缺「报警」态（只写了漏的形态）' });
  else if (!hasMiss) hits.push({ field: 'expect', message: 'expect 缺「漏」态（只写期望、不写漏的形态）' });
  return hits;
}

/** §6-10 ＋ §7 —— verify 只有一个标本，且没写"无对应装置" */
function check3_verifySingleSpecimen(card) {
  const v = card.fields.verify;
  if (!v || v.kind !== 'nested') return []; // 由第 1 项报
  const specs = parseSpecimens(card);
  if (specs.length >= 2) return [];
  if (/无对应装置|无对应本体|无对应/.test(v.text)) return []; // 已按 §6-10 声明
  return [{
    field: 'verify',
    message: `verify 只有 ${specs.length} 个标本（§7 要求 2 个：本库工具 ＋ 中立装置），且未写"无对应装置"`,
  }];
}

/** §6-7 —— evidence 里没有具体数字/命令 */
function check4_evidenceNoNumberOrCommand(card) {
  const e = card.fields.evidence;
  if (!e) return [{ field: 'evidence', message: '缺 evidence 字段' }];
  const t = e.text;
  const hasNum = /[0-9]/.test(t);
  const hasCmd = /(`|(^|[^\w])(node|npm|npx|git|python3?|pwsh|powershell|Get-[A-Za-z]+|chcp|wc|grep|ls|cat|head|tail|sed|awk|seq|icacls|exit)([^\w]|$)|\.mjs\b|\.ps1\b|\.py\b|--[A-Za-z])/.test(t);
  if (!hasNum && !hasCmd) return [{ field: 'evidence', message: 'evidence 里既没有具体数字、也没有命令 ⇒ 无法追溯' }];
  return [];
}

/** §6-5 —— 要求联网／第三方依赖（只扫可执行字段 inject/run/deps） */
const NETWORK_PATTERNS = [
  { re: /https?:\/\//i,                        what: 'URL（http/https）' },
  { re: /\bnpm\s+(?:i|install|add|ci)\b/,      what: 'npm 安装' },
  { re: /\b(?:yarn|pnpm)\s+(?:add|install)\b/, what: '包管理器安装' },
  { re: /\bpip3?\s+install\b/,                 what: 'pip 安装' },
  { re: /\b(?:apt|apt-get|brew|choco|scoop)\s+install\b/, what: '系统包安装' },
  { re: /\bgit\s+clone\b/,                     what: 'git clone（联网）' },
  { re: /(^|[^\w])curl\s/,                     what: 'curl（联网）' },
  { re: /(^|[^\w])wget\s/,                     what: 'wget（联网）' },
  { re: /\bgo\s+get\b/,                        what: 'go get' },
  { re: /\bcargo\s+add\b/,                     what: 'cargo add' },
];
function check5_needsNetworkOrThirdParty(card) {
  const hits = [];
  for (const key of ['inject', 'run', 'deps']) {
    const t = fieldText(card, key);
    if (!t) continue;
    for (const p of NETWORK_PATTERNS) {
      const m = p.re.exec(t);
      if (m) hits.push({ field: key, message: `${p.what}：${JSON.stringify(m[0].trim())}` });
    }
  }
  return hits;
}

/**
 * §6-11 ＋ §3.5 —— run 点名的 toys/ 装置不存在（接口对不上）
 * 可机器化的两小步：
 *   (a) 存在性：点名装置是否在 --toys 目录下存在（**未提供 --toys ⇒ 这一小步 skipped**）
 *   (b) 命名一致性：run「本库装置」点名的装置名 vs verify「中立」标本 ref 的装置名
 * 参数级接口（装置是否真接受该参数）＝ 语义，本工具不做（见 README）。
 */
function check6_toysDevice(card, ctx) {
  const hits = [];
  const all = [fieldText(card, 'inject'), fieldText(card, 'run'), fieldText(card, 'verify')].join('\n');
  const names = toysNamesIn(all);

  if (ctx.toysDir) {
    for (const n of names) {
      if (!deviceExists(ctx.toysDir, n)) {
        hits.push({ field: 'run', message: `点名的 toys 装置不存在：toys/${n}（--toys＝${ctx.toysDir}）` });
      }
    }
  }

  // (b) 命名一致性
  const runLine = /本库装置[：:]\s*([^\n]*)/.exec(fieldText(card, 'run'));
  const runNames = runLine ? toysNamesIn(runLine[1]) : [];
  const neutral = parseSpecimens(card).find((s) => /中立/.test(s.target || ''));
  const refNames = neutral ? toysNamesIn(neutral.ref || '') : [];
  if (runNames.length && refNames.length && runNames[0] !== refNames[0]) {
    hits.push({
      field: 'verify',
      message: `run 点名的本库装置（toys/${runNames[0]}）与 verify 中立标本 ref（toys/${refNames[0]}）不是同一个 ⇒ 卡内自相矛盾`,
    });
  }
  return hits;
}

/** 在 --toys 目录下找装置（先平铺、再递归一层） */
function deviceExists(dir, name) {
  try {
    if (fs.existsSync(path.join(dir, name))) return true;
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      if (e.isDirectory() && fs.existsSync(path.join(dir, e.name, name))) return true;
    }
  } catch { /* 目录不可读 ⇒ 视为不存在，并由调用方在报告里给出 --toys 路径 */ }
  return false;
}

/** §6-1 —— inject 只有描述、没有可跑步骤 */
const STEP_WORDS = /\b(node|npm|npx|bash|sh|python3?|pwsh|powershell|git|mkdir|printf|echo|cat|ls|cp|mv|rm|rmdir|grep|sed|awk|wc|head|tail|chmod|icacls|touch|seq|find|test|export|set|if|then|do|done|fi|true|false)\b|[>|]|\$\w/;
function check7_injectNoRunnableStep(card) {
  const inj = card.fields.inject;
  if (!inj) return [{ field: 'inject', message: '缺 inject 字段' }];
  const steps = inj.text
    .split('\n')
    .filter((l) => l.trim() !== '' && !/^\s*#/.test(l) && STEP_WORDS.test(l));
  if (steps.length === 0) {
    return [{ field: 'inject', message: 'inject 只有描述、没有可跑步骤（无任何命令行/脚本行）' }];
  }
  return [];
}

const CHECK_FN = {
  1: check1_verifyMissing,
  2: check2_expectUndecidable,
  3: check3_verifySingleSpecimen,
  4: check4_evidenceNoNumberOrCommand,
  5: check5_needsNetworkOrThirdParty,
  6: check6_toysDevice,
  7: check7_injectNoRunnableStep,
};

// ---------------------------------------------------------------------------
// 主流程
// ---------------------------------------------------------------------------

function usage() {
  return `探针卡「契约校验器」 ${TOOL} v${VERSION}（依据 ${CONTRACT} · §6 12 条中可机器判定 7 条）

用法:
  node ${TOOL}.mjs --cards <卡目录> [--toys <装置目录>] [--json] [--quiet]

选项:
  --cards <dir>   要检查的探针卡目录（必填；只读 *.yaml）
  --toys  <dir>   中立玩具装置目录。给了才做第 6 项的"装置存在性"；
                  不给 ⇒ 该项这一小步显式记 skipped（不静默放过）
  --json          只输出机器可读 JSON（可直接 JSON.parse）
  --quiet         只输出汇总，不打印命中明细
  -h, --help      本帮助

退出码:
  0  无命中
  1  有命中（≥1 张卡不合格；或出现"读取异常"）
  2  用法/环境错误（缺 --cards／目录不存在／目录内无 *.yaml／未知参数）

本工具检查（可机器判定）:
  1 §6-3   缺 verify，或 verify 写着"未实测"
  2 §6-2   expect 不可判定（缺「报警／漏」两态）
  3 §6-10  verify 只有一个标本，且未写"无对应装置"
  4 §6-7   evidence 里没有具体数字/命令
  5 §6-5   要求联网／第三方依赖
  6 §6-11  run 点名的 toys/ 装置不存在，或与 verify 中立标本对不上
  7 §6-1   inject 只有描述、没有可跑步骤

本工具【不】检查（语义判断，交人工；运行报告「未检查项」一节逐条列出）:
  §6-4 只对本库有效 ｜ §6-6 只测能跑不测会不会漏 ｜ §6-8 inject 没有自证 ｜ §6-9 expect 锚在被测装置自己的数字上 ｜ §6-12 limits 留空
`;
}

function parseArgs(argv) {
  const opt = { cards: null, toys: null, json: false, quiet: false, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '-h' || a === '--help') { opt.help = true; continue; }
    if (a === '--json') { opt.json = true; continue; }
    if (a === '--quiet') { opt.quiet = true; continue; }
    if (a === '--cards' || a === '--toys') {
      const v = argv[i + 1];
      if (v === undefined || v.startsWith('--')) return { error: `${a} 需要一个目录参数` };
      opt[a === '--cards' ? 'cards' : 'toys'] = v;
      i++;
      continue;
    }
    return { error: `未知参数：${a}` };
  }
  return opt;
}

function main(argv) {
  const opt = parseArgs(argv);
  if (opt.error) { process.stderr.write(`${TOOL}: 用法错误：${opt.error}\n\n${usage()}`); return 2; }
  if (opt.help) { process.stdout.write(usage()); return 0; }

  if (!opt.cards) { process.stderr.write(`${TOOL}: 用法错误：缺少 --cards <卡目录>\n\n${usage()}`); return 2; }

  const cardsDir = path.resolve(opt.cards);
  if (!fs.existsSync(cardsDir) || !fs.statSync(cardsDir).isDirectory()) {
    process.stderr.write(`${TOOL}: 环境错误：卡目录不存在或不是目录：${cardsDir}\n`);
    return 2;
  }
  const files = fs.readdirSync(cardsDir).filter((f) => f.toLowerCase().endsWith('.yaml')).sort();
  if (files.length === 0) {
    process.stderr.write(`${TOOL}: 环境错误：目录内没有 *.yaml：${cardsDir}\n`);
    return 2;
  }

  let toysDir = null;
  if (opt.toys) {
    toysDir = path.resolve(opt.toys);
    if (!fs.existsSync(toysDir) || !fs.statSync(toysDir).isDirectory()) {
      process.stderr.write(`${TOOL}: 环境错误：--toys 目录不存在或不是目录：${toysDir}\n`);
      return 2;
    }
  }
  const ctx = { toysDir };

  // 逐张读 + 跑 7 项
  const readErrors = [];
  const hits = [];
  const perCheck = new Map(CHECK_META.map((c) => [c.id, []]));
  let readCount = 0;

  for (const f of files) {
    const full = path.join(cardsDir, f);
    let card;
    try {
      card = readCard(fs.readFileSync(full, 'utf8'));
      if (Object.keys(card.fields).length === 0) throw new Error('没有任何顶层键');
      readCount++;
    } catch (e) {
      readErrors.push({ file: f, message: e && e.message ? e.message : String(e) });
      continue;
    }
    card.specimens = parseSpecimens(card);
    const id = card.fields.id ? unquote(card.fields.id.text) : '(无 id)';

    for (const meta of CHECK_META) {
      const list = CHECK_FN[meta.id](card, ctx) || [];
      for (const h of list) {
        const rec = { file: f, id, check: meta.id, rule: meta.rule, title: meta.title, field: h.field, message: h.message };
        hits.push(rec);
        perCheck.get(meta.id).push(rec);
      }
    }
  }

  // 第 6 项有两个小步，(a) 在没给 --toys 时是 skipped
  const check6SkippedPartA = !toysDir;

  const checks = CHECK_META.map((meta) => {
    const c = { id: meta.id, rule: meta.rule, title: meta.title, scope: meta.scope, hits: perCheck.get(meta.id).length };
    if (meta.id === 6) {
      c.parts = [
        { part: '存在性（--toys）', status: toysDir ? (perCheck.get(6).some((h) => /不存在/.test(h.message)) ? 'hit' : 'ok') : 'skipped',
          reason: toysDir ? '' : '未提供 --toys 目录 ⇒ 无法判定"点名的 toys 装置在不在"' },
        { part: '命名一致性（卡内）', status: 'ok' },
      ];
      c.status = c.parts[0].status === 'skipped' ? 'partial' : (c.hits > 0 ? 'hit' : 'ok');
    } else {
      c.status = c.hits > 0 ? 'hit' : 'ok';
    }
    return c;
  });

  const totalHits = hits.length + readErrors.length;
  const exitCode = totalHits > 0 ? 1 : 0;

  const result = {
    tool: TOOL,
    version: VERSION,
    contract: CONTRACT,
    cards_dir: cardsDir,
    toys_dir: toysDir,
    card_count: files.length,
    cards_read: readCount,
    read_errors: readErrors,
    checks,
    not_checked: NOT_DONE,
    hits,
    totals: {
      hits: hits.length,
      read_errors: readErrors.length,
      all: totalHits,
      checks_run: CHECK_META.length,
      checks_skipped: check6SkippedPartA ? 1 : 0,
    },
    exit_code: exitCode,
  };

  if (opt.json) {
    process.stdout.write(JSON.stringify(result, null, 2) + '\n');
    return exitCode;
  }

  const L = [];
  L.push(`${TOOL} v${VERSION} · 探针卡「契约校验器」`);
  L.push(`依据：${CONTRACT} · §6（12 条中可机器判定的 7 条）`);
  L.push(`扫描目录：${cardsDir}`);
  L.push(`装置目录：${toysDir || '（未提供 → 第 6 项"存在性"未检查）'}`);
  L.push('');
  L.push(`【扫了几张卡】${files.length} 张（成功读取 ${readCount} 张；读取异常 ${readErrors.length} 张）`);
  L.push('');
  L.push('【每项命中几处】');
  for (const c of checks) {
    const pad = c.rule.padEnd(7, ' ');
    let line = `[${c.id}] ${pad} ${c.title} ⇒ 命中 ${c.hits} 处`;
    if (c.id === 6) {
      line += `   （存在性：${c.parts[0].status === 'skipped' ? '⚠ 未检查' : c.parts[0].status === 'hit' ? '有命中' : '无命中'}；命名一致性：${c.parts[1].status === 'hit' ? '有命中' : '无命中'}）`;
    } else {
      line += `   （已检查 ${readCount}/${files.length} 张）`;
    }
    L.push(line);
  }
  L.push('');
  L.push('【未检查项 —— "没查到" ≠ "查过了没问题"】');
  if (check6SkippedPartA) L.push('⚠ [6-存在性] §6-11「run 点名的 toys/ 装置不存在」：未提供 --toys ⇒ 这一小步没跑（加 --toys <dir> 才跑）');
  for (const n of NOT_DONE) L.push(`⚠ [不做] ${n.rule} ${n.title}`);
  L.push('');
  L.push(`【命中清单】（${totalHits} 处）`);
  if (totalHits === 0) {
    L.push('（无）');
  } else {
    if (readErrors.length) {
      L.push(`—— 读取异常 ${readErrors.length} 张（无法判读，不等于合格）——`);
      for (const r of readErrors) L.push(`  ! ${r.file}：${r.message}`);
    }
    if (!opt.quiet) {
      for (const h of hits) {
        L.push(`  × [${h.check} ${h.rule}] ${h.file}  (id=${h.id})`);
        L.push(`      ${h.field}: ${h.message}`);
      }
    } else {
      L.push(`—— 命中 ${hits.length} 处（--quiet：明细略）——`);
    }
  }
  L.push('');
  L.push(`【退出码】${exitCode} —— ${exitCode === 0 ? '无命中' : '有命中（≥1 张卡不合格）'}`);

  process.stdout.write(L.join('\n') + '\n');
  return exitCode;
}

process.exit(main(process.argv.slice(2)));
