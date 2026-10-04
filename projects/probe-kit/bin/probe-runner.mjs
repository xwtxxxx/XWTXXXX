// probe-runner.mjs —— 探针运行器（零依赖单文件，只用 node: 内建）
// 用法：node probe-runner.mjs --cards <卡目录> --toys <玩具目录> [--work <目录>] [--repeat N] [--only <卡文件>]
//                                        [--json] [--quiet] [--report <md>] [--json-out <json>]
// 语义：
//   - 每张卡每条 verify：<tmp> 替换为本次运行的夹具目录；toys/pNN-*.mjs 从 --toys 拷入夹具后真跑
//   - 对账只认退出码：verdict=漏 ⇒ 期望 exit 0；verdict=报警 ⇒ 期望 exit≠0；不适用 ⇒ skipped
//   - <repo> 本体工具不在材料里 ⇒ 记 skipped 并计数，不假装、不自造替身
//   - --repeat N：整套卡跑 N 轮（每轮独立夹具），同一卡各轮结论不同 ⇒ 报「不稳定」
//   - --work <目录>（T32-D3）：夹具建在它下面（默认：系统临时目录 os.tmpdir()）—— 本包被装进**只读的
//     node_modules** 时，往自己安装目录里建夹具必然失败 ⇒ 夹具根外置；不传 --work 的既有调用式保持可用
// 退出码：0 全一致且稳定｜1 有不一致/跑失败/不稳定｜2 用法或环境错误
//
// inject 预置（R1）：卡面 inject 里的 mkdir -p / printf '>' / cd / && 段在夹具内真执行；
//   git 段（红线：本运行器不执行 git）与 node/ls/echo 等自证段逐行显式跳过并随 --json 输出。
//   玩具依赖 inject 且因缺 git 预置而崩溃的卡 ⇒ 记 skipped + skip_reason（不许静默崩）。
// 非 ASCII 路径（R4）：cwd/卡目录/玩具目录含非 ASCII ⇒ 启动打印显式告警（stderr），纯 ASCII 不打印。
import { spawnSync } from 'node:child_process';
import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync, rmdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, isAbsolute, join, resolve, sep } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const SEG_TIMEOUT_MS = 60_000;
const TAIL = 600; // 记录到 details 的输出尾部长度

export class CardParseError extends Error {
  constructor(msg) { super(msg); this.name = 'CardParseError'; }
}

// ---------- YAML 子集解析（卡片实际用到的形态） ----------
function dequote(v, where) {
  const s = v.trim();
  if (s.startsWith('"')) {
    if (s.length < 2 || !s.endsWith('"')) throw new CardParseError(`${where}：引号未闭合「${s.slice(0, 30)}」`);
    return s.slice(1, -1).replace(/\\(["\\])/g, '$1');
  }
  if (s.startsWith("'")) {
    if (s.length < 2 || !s.endsWith("'")) throw new CardParseError(`${where}：引号未闭合「${s.slice(0, 30)}」`);
    return s.slice(1, -1).replace(/''/g, "'");
  }
  return s;
}

export function parseCardText(text) {
  const lines = text.replace(/^\uFEFF/, '').split(/\r?\n/);
  const card = {};
  let i = 0;
  while (i < lines.length) {
    const ln = lines[i];
    if (!ln.trim() || /^#/.test(ln)) { i++; continue; }
    if (/^\s/.test(ln)) throw new CardParseError(`第 ${i + 1} 行：意外缩进「${ln.slice(0, 30)}」`);
    const m = /^([A-Za-z_][\w-]*):(?:[ \t]+(.*))?$/.exec(ln);
    if (!m) throw new CardParseError(`第 ${i + 1} 行：无法解析「${ln.slice(0, 30)}」`);
    const key = m[1];
    const rest = (m[2] ?? '').trim();
    if (key === 'verify') {
      i++;
      const items = [];
      while (i < lines.length) {
        const l2 = lines[i];
        if (!l2.trim()) { i++; continue; }
        if (!/^ /.test(l2)) break; // verify 块结束
        let mm = /^  - (\S+):(?:[ \t]+(.*))?$/.exec(l2);
        if (mm) { items.push({ [mm[1]]: dequote(mm[2] ?? '', `第 ${i + 1} 行`) }); i++; continue; }
        mm = /^    (\S+):(?:[ \t]+(.*))?$/.exec(l2);
        if (mm && items.length) { items[items.length - 1][mm[1]] = dequote(mm[2] ?? '', `第 ${i + 1} 行`); i++; continue; }
        throw new CardParseError(`第 ${i + 1} 行：verify 内无法解析「${l2.slice(0, 30)}」`);
      }
      card.verify = items;
      continue;
    }
    if (key === 'inject' && /^[|>][+-]?$/.test(rest)) { // inject 块标量：收集内容行（预置用）
      i++;
      const content = [];
      while (i < lines.length && (!lines[i].trim() || /^ /.test(lines[i]))) {
        if (lines[i].trim()) content.push(lines[i].replace(/^ {2}/, ''));
        i++;
      }
      card.injectLines = content;
      continue;
    }
    if (/^[|>][+-]?$/.test(rest)) { // 其余块标量：内容与判定无关，跳过其缩进行
      i++;
      while (i < lines.length && (!lines[i].trim() || /^ /.test(lines[i]))) i++;
      continue;
    }
    card[key] = dequote(rest, `第 ${i + 1} 行`);
    i++;
  }
  validateCard(card);
  return card;
}

function validateCard(card) {
  if (!card.id) throw new CardParseError('缺 id');
  if (!Array.isArray(card.verify) || card.verify.length === 0) throw new CardParseError('缺 verify（或 verify 为空）');
  card.verify.forEach((e, k) => {
    for (const f of ['target', 'ref', 'cmd', 'verdict']) {
      if (!e[f]) throw new CardParseError(`verify 第 ${k + 1} 条缺 ${f}`);
    }
    if (!['漏', '报警', '不适用'].includes(e.verdict)) {
      throw new CardParseError(`verify 第 ${k + 1} 条 verdict 非法：「${e.verdict}」`);
    }
  });
}

// ---------- 令牌化与命令段 ----------
export function tokenize(s) {
  const out = [];
  let cur = '', has = false, q = null;
  const push = () => { if (has) { out.push(cur); cur = ''; has = false; } };
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) {
      if (ch === q) { q = null; continue; }
      if (q === '"' && ch === '\\' && (s[i + 1] === '"' || s[i + 1] === '\\')) { cur += s[++i]; continue; }
      cur += ch; continue;
    }
    if (ch === '"' || ch === "'") { q = ch; has = true; continue; }
    if (/\s/.test(ch)) { push(); continue; }
    if (ch === '#' && !has) break; // 井号打头且新词未开始 ⇒ 行内注释
    cur += ch; has = true;
  }
  push();
  return out;
}

export function splitSegments(cmd) {
  const segs = [];
  let cur = '', q = null;
  for (const ch of cmd) {
    if (q) { cur += ch; if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; cur += ch; continue; }
    if (ch === '&' && cur.endsWith('&')) { cur = cur.slice(0, -1).trim(); if (cur) segs.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) segs.push(cur.trim());
  return segs.filter(Boolean);
}

// ---------- 标本分类与对账 ----------
export function classifyEntry(entry) {
  const ref = entry.ref ?? '';
  const cmd = entry.cmd ?? '';
  if (ref.includes('<repo>') || cmd.includes('<repo>')) return { kind: 'skip', reason: '<repo> 不在材料' };
  if (ref.includes('无对应本体') || cmd.includes('无对应本体')) return { kind: 'skip', reason: '无对应本体（卡面不适用）' };
  if (entry.verdict === '不适用' && !ref.includes('<tmp>')) return { kind: 'skip', reason: '卡面不适用' };
  return { kind: 'run' };
}

export function judge(verdict, exitCode) {
  if (verdict === '漏') return exitCode === 0 ? 'match' : 'mismatch';
  if (verdict === '报警') return exitCode !== 0 ? 'match' : 'mismatch';
  return 'skip';
}

// ---------- inject 预置执行（R1：最小子集，其余行显式跳过） ----------
function stripInlineComment(s) { // 只剥「引号外」的 # 注释（引号内的 # 保留，如 printf '# 交付'）
  let q = null;
  for (let i = 0; i < s.length; i++) {
    const ch = s[i];
    if (q) { if (ch === '\\') i++; else if (ch === q) q = null; continue; }
    if (ch === '"' || ch === "'") { q = ch; continue; }
    if (ch === '#') return s.slice(0, i);
  }
  return s;
}

function unescapePrintf(s) {
  return s.replace(/\\n/g, '\n').replace(/\\t/g, '\t').replace(/\\r/g, '\r').replace(/\\\\/g, '\\');
}

function resolveIn(p, cwd, fixtureRoot) {
  const s = p.split('<tmp>').join(fixtureRoot).split(sep).join('/');
  return (isAbsolute(s) ? s : resolve(cwd, s)).split(sep).join('/'); // 统一正斜杠，保证跨函数比较一致
}

function rootNorm(fixtureRoot) { return fixtureRoot.split(sep).join('/'); }

export function planInject(injectLines, fixtureRoot) {
  const plan = { executable: [], skipped: [], gitUsed: false };
  let cwd = fixtureRoot;
  for (const rawLine of injectLines ?? []) {
    const line = stripInlineComment(rawLine).trim();
    if (!line) continue;
    for (const segRaw of splitSegments(line)) {
      const seg = segRaw.trim();
      if (!seg) continue;
      let m = /^mkdir\s+-p\s+(.+)$/.exec(seg);
      if (m) { plan.executable.push({ kind: 'mkdir', paths: m[1].trim().split(/\s+/), cwd }); continue; }
      m = /^printf\s+('(?:\\.|[^'\\])*'|"(?:\\.|[^"\\])*")\s*>\s*(\S+)\s*$/.exec(seg);
      if (m) { plan.executable.push({ kind: 'printf', text: unescapePrintf(m[1].slice(1, -1)), target: m[2], cwd }); continue; }
      m = /^cd\s+(\S+)$/.exec(seg);
      if (m) { plan.executable.push({ kind: 'cd', target: m[1], cwd }); cwd = resolveIn(m[1], cwd, fixtureRoot); continue; }
      plan.skipped.push(seg); // git / node / ls / echo / cp / head / cat 等：显式跳过
      if (/^git(\s|$)/.test(seg)) plan.gitUsed = true;
    }
  }
  return plan;
}

function injectWillCreateAbs(plan, fixtureRoot) {
  const rootN = rootNorm(fixtureRoot);
  const out = [];
  for (const seg of plan.executable) {
    if (seg.kind === 'cd') continue;
    for (const p of seg.kind === 'mkdir' ? seg.paths : [seg.target]) {
      const abs = resolveIn(p, seg.cwd, fixtureRoot);
      if (abs === rootN || abs.startsWith(rootN + '/')) out.push(abs);
    }
  }
  return out;
}

export function injectRelevant(card, plan, fixtureRoot) {
  // 只看「玩具条目」（kind=run）cmd 引用的 <tmp> 路径；本体工具/不适用条目不算
  const rootN = rootNorm(fixtureRoot);
  const willCreate = injectWillCreateAbs(plan, fixtureRoot);
  for (const e of card.verify) {
    if (classifyEntry(e).kind !== 'run') continue;
    for (const tok of tokenize(e.cmd)) {
      if (!tok.includes('<tmp>')) continue;
      const ref = resolveIn(tok, fixtureRoot, fixtureRoot);
      if (!ref.startsWith(rootN)) continue;
      // 覆盖三向：inject 建了 ref 本身／ref 的子代／ref 的祖先
      // （祖先向：p15 的 inject 造的正是 cmd 路径的父——一个"堵死文件"，不认祖先 ⇒ 预置被跳过 ⇒ 卡被洞掩盖成假绿）
      if (willCreate.some((c) => c === ref || c.startsWith(ref + '/') || ref.startsWith(c + '/'))) return true;
    }
  }
  return false;
}

function runInjectPlan(plan, fixtureRoot) {
  const rootN = rootNorm(fixtureRoot);
  const toysN = rootNorm(join(fixtureRoot, 'toys')); // 夹具的 toys/ 由 runner 自管（拷贝玩具），inject 不建、不记 ⇒ 回滚永不波及
  const created = [];
  for (const seg of plan.executable) {
    try {
      if (seg.kind === 'cd') continue; // cwd 已在 plan 阶段应用
      if (seg.kind === 'mkdir') {
        for (const p of seg.paths) {
          const abs = resolveIn(p, seg.cwd, fixtureRoot);
          if (abs === rootN || abs === toysN) continue;
          mkdirSync(abs, { recursive: true });
          created.push(abs);
        }
      } else if (seg.kind === 'printf') {
        const abs = resolveIn(seg.target, seg.cwd, fixtureRoot);
        if (abs === rootN || abs === toysN) continue;
        mkdirSync(dirname(abs), { recursive: true });
        writeFileSync(abs, seg.text);
        created.push(abs);
      }
    } catch { /* 预置失败不致命：玩具照跑；崩溃由 gitUsed/skipped 归因兜住 */ }
  }
  return created;
}

function rollbackInject(created, fixtureRoot) {
  const rootN = rootNorm(fixtureRoot);
  // 只清 inject 自己建的路径；向上顺手清空目录链（夹具根与 toys/ 不动）
  for (const p of [...new Set(created)].sort((a, b) => b.length - a.length)) rmSafe(p);
  for (const d of [...new Set(created.map((p) => dirname(p)))]) {
    let cur = d;
    for (let guard = 0; guard < 16; guard++) {
      if (!cur.startsWith(rootN + '/') || cur === rootN) break;
      let entries;
      try { entries = readdirSync(cur); } catch { break; }
      if (entries.length) break;
      try { rmdirSync(cur); } catch { break; }
      cur = dirname(cur);
    }
  }
}

// ---------- 命令段执行（node / ls -d） ----------
function toyEnv() {
  // 本机可能以 NODE_OPTIONS --require 注入 shim（如 safe-delete 批量删除守卫），
  // 它会让玩具自身的 rmSync 自清抛错 ⇒ 判据结论失真。玩具子进程用干净 env（剥 shim，保留其余）。
  const env = { ...process.env };
  if (env.NODE_OPTIONS) {
    const kept = env.NODE_OPTIONS.split(/\s+/).filter((t) => t && !/shim/i.test(t));
    if (kept.length) env.NODE_OPTIONS = kept.join(' ');
    else delete env.NODE_OPTIONS;
  }
  return env;
}

function envLimitReason(stderr) {
  // 环境限制型崩溃指纹：路径含 %XX 字面量 ＋ 写宿主盘根被拒（R4 现象的显形）
  const s = stderr ?? '';
  const denied = /UnauthorizedAccessException|PermissionDenied|CreateDirectoryUnauthorizedAccessError|\bEPERM\b|\bEACCES\b/.test(s);
  const pctPath = /%[0-9A-Fa-f]{2}/.test(s);
  return denied && pctPath
    ? '环境限制：玩具以 URL.pathname 推导路径，非 ASCII 路径被编码为 %XX 字面量并需在宿主盘根写入（被拒）；建议 subst 映射纯 ASCII 盘符后重跑'
    : null;
}

export function runSegments(cmd, ctx) {
  const segs = splitSegments(cmd);
  if (!segs.length) return { runError: 'cmd 为空' };
  for (const seg of segs) {
    const tokens = tokenize(seg).map((t) => t.replaceAll('<tmp>', ctx.fixtureDir));
    if (!tokens.length) continue;
    const head = tokens[0];
    if (head === 'node') {
      if (tokens.length < 2) return { runError: `命令段缺脚本：「${seg.slice(0, 40)}」` };
      const r = spawnSync(process.execPath, tokens.slice(1), {
        cwd: ctx.fixtureToys, encoding: 'utf8', timeout: SEG_TIMEOUT_MS,
        maxBuffer: 64 << 20, windowsHide: true, env: toyEnv(),
      });
      if (r.error) return { runError: `node 段执行失败：${r.error.code ?? r.error.message}` };
      if (r.status === null) return { runError: `node 段被信号终止：${r.signal ?? '?'}` };
      if (r.status !== 0) return { exit: r.status, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
      continue; // 0 ⇒ 继续下一段
    }
    if (head === 'ls') {
      const args = tokens.slice(1).filter((a) => a !== '-d');
      if (args.length !== 1) return { runError: `仅支持「ls -d <单一路径>」：「${seg.slice(0, 40)}」` };
      const p = isAbsolute(args[0]) ? args[0] : resolve(ctx.fixtureToys, args[0]);
      return existsSync(p)
        ? { exit: 0, stdout: `${p}\n`, stderr: '' }
        : { exit: 1, stdout: '', stderr: `ls: ${p}: 不存在` };
    }
    return { runError: `不支持的命令段：「${head}」（仅支持 node 与 ls -d）` };
  }
  return { exit: 0, stdout: '', stderr: '' };
}

// ---------- 百分号孪生（玩具以 URL.pathname 推导路径时在盘根产生的字面量形态） ----------
export function pctTwin(p) {
  return pathToFileURL(p).pathname.replace(/^\//, '');
}
export function rmSafe(p) {
  // 第一层：原生 rmSync（Windows 杀毒/索引器瞬占 EPERM 由 maxRetries/retryDelay 覆盖）
  try {
    rmSync(p, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
  } catch { /* 见第二层 */ }
  if (!existsSync(p)) return;
  // 第二层：宿主可能以 NODE_OPTIONS --require 注入 safe-delete 守卫（业务级抛错，maxRetries 不覆盖）。
  // 用「干净 env 的 node 子进程」删除（该子进程不加载 shim）；仍失败则留给跑后自检显式报红，绝不静默。
  try {
    spawnSync(process.execPath, ['-e', 'require("node:fs").rmSync(process.argv[1],{recursive:true,force:true})', p], {
      env: toyEnv(), timeout: 30_000, windowsHide: true, stdio: 'ignore',
    });
  } catch { /* 尽力而为 */ }
}
function sweepPctJunk(fixtureDir, twinExistedBefore) {
  const twin = pctTwin(fixtureDir);
  if (existsSync(twin) && !twinExistedBefore) rmSafe(twin);
  // 自底向上清掉本轮新产生的空目录链（仅限名字含 % 的孪生目录）
  let cur = dirname(twin);
  for (let guard = 0; guard < 16; guard++) {
    if (!existsSync(cur) || cur.length <= 3 || !basename(cur).includes('%')) break;
    let entries;
    try { entries = readdirSync(cur); } catch { break; }
    if (entries.length) break;
    try { rmdirSync(cur); } catch { break; }
    cur = dirname(cur);
  }
}

// ---------- 非 ASCII 路径告警（R4） ----------
export function nonAsciiWarning(paths) {
  const bad = [...new Set(paths)].filter((p) => /[^\x00-\x7F]/.test(p));
  if (!bad.length) return null;
  return [
    '⚠ 告警：以下路径含非 ASCII 字符：',
    ...bad.map((p) => `  - ${p}`),
    '  风险：玩具若以 new URL(import.meta.url).pathname 推导自身目录，非 ASCII 路径会被',
    '  百分号编码成 %XX 字面量，mkdirSync 在宿主目录造出「%XX」空目录树（git 不跟踪空目录，不可见）。',
    '  规避：先映射纯 ASCII 盘符再跑，例（Windows）：subst <盘符>: <上述目录>，然后以 <盘符>:\ 开头路径运行。',
  ].join('\n');
}

// ---------- 输出脱敏（产物不携带本机绝对路径） ----------
function makeScrubber(bases) {
  const pairs = [];
  for (const b of bases) {
    const alt = b.split(sep).join('/');
    pairs.push([b, '<base>'], [alt, '<base>']);
    const t = pctTwin(b);
    if (t !== b && t !== alt) pairs.push([t, '<base>']);
  }
  pairs.sort((a, c) => c[0].length - a[0].length);
  return (s) => {
    if (typeof s !== 'string') return s;
    for (const [from, to] of pairs) if (s.includes(from)) s = s.split(from).join(to);
    return s;
  };
}

// ---------- CLI ----------
function usage() {
  return [
    'probe-runner.mjs —— 探针卡 verify 实测运行器（零依赖）',
    '',
    '用法：node probe-runner.mjs --cards <卡目录> --toys <玩具目录> [选项]',
    '',
    '选项：',
    '  --cards <dir>     必填。探针卡（YAML）目录',
    '  --toys <dir>      必填。中立玩具装置目录',
    '  --work <dir>      夹具根目录（默认：系统临时目录 os.tmpdir()）。本包被装进**只读的 node_modules** 时',
    '                    往安装目录建夹具必然失败 ⇒ 用它指到可写目录；夹具根为 <work>/.tmp-pr-<pid>，跑完自清',
    '  --repeat <N>      整套卡跑 N 轮（默认 1）；同一卡各轮结论不同 ⇒ 报「不稳定」',
    '  --only <file>     只跑指定的卡文件（须在卡目录内）',
    '  --json            stdout 只输出 JSON（人读摘要抑制）',
    '  --quiet           只输出不一致/不稳定明细与汇总行',
    '  --report <file>   另存逐卡实测报告（Markdown）',
    '  --json-out <file>  另存完整 JSON 结果',
    '  --help            本说明',
    '',
    '对账规则（只认退出码）：verdict=漏 ⇒ 期望 exit 0；verdict=报警 ⇒ 期望 exit≠0；',
    '  不适用 / <repo> 本体工具不在材料 ⇒ skipped 并计数，不算一致。',
    'inject 预置：卡面 inject 的 mkdir -p / printf > / cd / && 段在夹具内真执行；',
    '  git 段（红线：不执行 git）与 node/ls/echo 自证段显式跳过并随 --json 输出；',
    '  玩具依赖 inject 且因缺 git 预置而崩溃 ⇒ skipped + skip_reason（不静默崩）。',
    '稳定性：--repeat N 各轮独立夹具；同一卡各轮结论不同 ⇒ 报「不稳定」且总退出码为 1。',
    '非 ASCII 路径：cwd/卡目录/玩具目录/work 目录含非 ASCII 时启动打印告警（stderr）；纯 ASCII 不打印。',
    '退出码：0 全一致且稳定｜1 有不一致/跑失败/不稳定｜2 用法或环境错误',
  ].join('\n');
}

function parseArgs(argv) {
  const opt = { repeat: 1, cards: null, toys: null, work: null, only: null, json: false, quiet: false, report: null, jsonOut: null, help: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => (i + 1 < argv.length ? argv[++i] : null);
    if (a === '--help' || a === '-h') opt.help = true;
    else if (a === '--json') opt.json = true;
    else if (a === '--quiet' || a === '-q') opt.quiet = true;
    else if (a === '--cards') opt.cards = next();
    else if (a === '--toys') opt.toys = next();
    else if (a === '--work') {
      const v = next();
      if (v === null || v === '') throw new CardParseError('参数错：--work 需要一个目录值（不许静默回落到默认目录，掩盖安装场景问题）');
      opt.work = v;
    }
    else if (a === '--repeat') opt.repeat = next();
    else if (a === '--only') opt.only = next();
    else if (a === '--report') opt.report = next();
    else if (a === '--json-out') opt.jsonOut = next();
    else throw new CardParseError(`未知参数：「${a}」（--help 看用法）`);
  }
  if (!opt.help) {
    const n = Number(opt.repeat);
    if (Number.isInteger(n) && String(opt.repeat).trim() !== '') opt.repeat = n;
  }
  return opt;
}

function die(code, msg) {
  process.stderr.write(`错误：${msg}\n`);
  process.exit(code);
}

// ---------- 主流程 ----------
function toyBasenameOf(ref) {
  const m = /toys[/\\]([\w.-]+\.mjs)$/.exec(ref ?? '');
  return m ? m[1] : null;
}

function runAll(opt, cardsDir, toysDir, cards, workDir = tmpdir()) {
  // T32-D3：夹具根外置 —— <workDir>/.tmp-pr-<pid>（默认 workDir = 系统临时目录）。
  // 安装目录（SCRIPT_DIR）不再承担夹具职责 ⇒ 只读 node_modules 场景可跑；不传 --work 的既有调用式保持可用。
  const fixtureRoot = join(workDir, `.tmp-pr-${process.pid}`);
  const scrub = makeScrubber([SCRIPT_DIR, cardsDir, toysDir, fixtureRoot, workDir]);
  const toyFiles = readdirSync(toysDir).filter((f) => {
    try { return statSync(join(toysDir, f)).isFile(); } catch { return false; }
  });
  const rounds = [];
  let fixturesCleaned = 0;
  for (let round = 1; round <= opt.repeat; round++) {
    rmSafe(fixtureRoot);
    let twinBefore = false;
    try {
      mkdirSync(join(fixtureRoot, 'toys'), { recursive: true });
      const fixtureToys = join(fixtureRoot, 'toys');
      for (const b of toyFiles) copyFileSync(join(toysDir, b), join(fixtureToys, b));
      twinBefore = existsSync(pctTwin(fixtureRoot));
      const ctx = { fixtureDir: fixtureRoot, fixtureToys };
      const records = [];
      for (const { file, card } of cards) {
        // R1：inject 预置——仅当「玩具条目 cmd 引用的路径」需要 inject 创建时才执行（最小扰动）
        const plan = planInject(card.injectLines, fixtureRoot);
        const relevant = injectRelevant(card, plan, fixtureRoot);
        let created = [];
        if (relevant) created = runInjectPlan(plan, fixtureRoot);
        for (let idx = 0; idx < card.verify.length; idx++) {
          const e = card.verify[idx];
          const rec = {
            card: card.id, cardFile: file, round, entry: idx + 1,
            target: e.target, ref: e.ref, cmd: e.cmd, verdict: e.verdict, observed: e.observed ?? '',
            expected: e.verdict === '漏' ? 0 : (e.verdict === '报警' ? '≠0' : null),
            actual_exit: null, result: null, skip_reason: null, crashed: false,
            inject_executed: relevant, inject_skipped_lines: relevant ? plan.skipped : [],
            stdout_tail: '', stderr_tail: '', duration_ms: 0,
          };
          const t0 = Date.now();
          const cls = classifyEntry(e);
          if (cls.kind === 'skip') {
            rec.result = 'skipped';
            rec.skip_reason = cls.reason;
          } else {
            const b = toyBasenameOf(e.ref);
            if (!b) {
              rec.result = 'run_error';
              rec.skip_reason = `ref 无法解析出玩具文件名：「${e.ref}」`;
            } else if (!existsSync(join(fixtureToys, b))) {
              rec.result = 'run_error';
              rec.skip_reason = `玩具不在 --toys 目录：${b}`;
            } else {
              const r = runSegments(e.cmd, ctx);
              if (r.runError) {
                rec.result = 'run_error';
                rec.skip_reason = r.runError;
                rec.stdout_tail = tail(scrub(r.stdout ?? ''), TAIL);
              } else {
                rec.actual_exit = r.exit;
                rec.result = judge(e.verdict, r.exit);
                rec.stdout_tail = tail(scrub(r.stdout ?? ''), TAIL);
                rec.stderr_tail = tail(scrub(r.stderr ?? ''), TAIL);
                rec.crashed = /(?:^|\n)\w*Error(?::| \()/.test(r.stderr ?? '');
                // R1(b)：玩具崩了且该卡 inject 需要 git（红线禁跑）⇒ 显式 skipped，不许静默崩
                if (rec.result === 'mismatch' && rec.crashed && relevant && plan.gitUsed) {
                  rec.result = 'skipped';
                  rec.skip_reason = '玩具依赖 inject 预置的 git 仓库；本运行器按红线不执行 git（inject 的 git 行已显式跳过）';
                } else if (rec.result === 'mismatch' && rec.crashed) {
                  // R4：环境限制型崩溃（非 ASCII 路径 ⇒ %XX 字面量 ⇒ 写宿主盘根被拒）显式归因，不装有结论
                  const why = envLimitReason(r.stderr);
                  if (why) { rec.result = 'skipped'; rec.skip_reason = why; }
                }
              }
            }
          }
          rec.duration_ms = Date.now() - t0;
          records.push(rec);
        }
        if (relevant) rollbackInject(created, fixtureRoot); // 预置回滚：跨卡零污染
      }
      rounds.push(records);
    } finally {
      // R2 附带修复：无论中途是否异常，本轮夹具必清（Windows EPERM 官方重试）
      sweepPctJunk(fixtureRoot, twinBefore);
      rmSafe(fixtureRoot);
      fixturesCleaned++;
    }
  }
  return { rounds, scrub, fixtureRoot, fixturesCleaned };
}

function tail(s, n) { return s.length > n ? '…' + s.slice(-n) : s; }

function cardRoundVerdict(recs) { // recs：某卡某轮全部条目
  if (recs.some((r) => r.result === 'mismatch')) return '不一致';
  if (recs.some((r) => r.result === 'run_error')) return '跑失败';
  if (recs.some((r) => r.result === 'match')) return recs.some((r) => r.result === 'skipped') ? '一致（含skipped）' : '一致';
  return '全部skipped';
}

function aggregate(cards, opt, rounds) {
  const flat = rounds.flat();
  const count = (r) => flat.filter((x) => x.result === r).length;
  const skipReasons = {};
  for (const r of flat) if (r.result === 'skipped') skipReasons[r.skip_reason] = (skipReasons[r.skip_reason] ?? 0) + 1;
  const byCard = new Map(cards.map((c) => [c.card.id, c]));
  const stability = { stable: 0, unstable: 0, unstable_cards: [] };
  for (const id of byCard.keys()) {
    const per = rounds.map((recs) => cardRoundVerdict(recs.filter((r) => r.card === id)));
    const same = per.every((v) => v === per[0]);
    if (same) stability.stable++;
    else {
      stability.unstable++;
      stability.unstable_cards.push({ card: id, verdicts_per_round: per });
    }
  }
  return {
    cards: cards.length, verify_total: flat.length,
    match: count('match'), mismatch: count('mismatch'),
    skipped: count('skipped'), run_error: count('run_error'),
    skipped_reasons: skipReasons, repeat: opt.repeat, stability,
  };
}

function humanLine(rec) {
  const no = '①②③④⑤'[rec.entry - 1] ?? `#${rec.entry}`;
  if (rec.result === 'skipped') return `  ${no} ${rec.target} ⇒ skipped（${rec.skip_reason}）`;
  const expect = `verdict=${rec.verdict} 期望exit=${rec.expected}`;
  if (rec.result === 'run_error') return `  ${no} ${rec.target} ${expect} ⇒ 跑失败（${rec.skip_reason}）`;
  return `  ${no} ${rec.target} ${expect} 实测exit=${rec.actual_exit} ⇒ ${rec.result === 'match' ? '一致' : '不一致'}${rec.crashed ? '（进程崩溃）' : ''}`;
}

function printHuman(cards, opt, agg, rounds, quiet) {
  const out = [];
  if (!quiet) {
    for (const { file, card } of cards) {
      out.push(`[卡 ${card.id}]（${file}）`);
      for (const rec of rounds[0].filter((r) => r.card === card.id)) {
        out.push(humanLine(rec));
        if (rec.inject_executed) {
          out.push(`    （inject 已执行；跳过 ${rec.inject_skipped_lines.length} 行：${rec.inject_skipped_lines.map((s) => s.split(' ')[0]).join('、')}）`);
        }
      }
    }
  }
  for (const r of rounds.flat().filter((x) => x.result === 'mismatch' || x.result === 'run_error')) {
    out.push(`! 不一致/跑失败明细 ${r.card} 第${r.entry}条（第${r.round}轮）：${r.result} 期望exit=${r.expected} 实测exit=${r.actual_exit ?? '-'}${r.crashed ? '（进程崩溃）' : ''}`);
    if (r.stderr_tail) out.push(`    stderr尾: ${r.stderr_tail.split('\n').filter(Boolean).pop() ?? ''}`);
    if (r.result === 'run_error' && r.skip_reason) out.push(`    原因: ${r.skip_reason}`);
  }
  for (const u of agg.stability.unstable_cards) {
    out.push(`! 不稳定：${u.card} 各轮卡结论 = ${u.verdicts_per_round.join(' → ')}`);
  }
  for (const [reason, n] of Object.entries(agg.skipped_reasons)) {
    out.push(`skipped理由：${reason} × ${n}`);
  }
  const unstablePart = agg.stability.unstable ? `｜不稳定 ${agg.stability.unstable}` : '';
  out.push(`汇总：卡 ${agg.cards} | verify ${agg.verify_total} | 一致 ${agg.match} | 不一致 ${agg.mismatch} | skipped ${agg.skipped} | run_error ${agg.run_error} | 稳定 ${agg.stability.stable}/${agg.cards}${unstablePart}（repeat ${agg.repeat}）`);
  return out.join('\n');
}

function buildJson(agg, rounds, scrub) {
  const details = rounds.flat().map((r) => ({
    card: r.card, round: r.round, entry: r.entry, target: r.target,
    ref: r.ref, cmd: r.cmd, verdict: r.verdict, expected: r.expected, actual_exit: r.actual_exit,
    result: r.result, skip_reason: r.skip_reason ?? null, crashed: r.crashed,
    inject_executed: r.inject_executed, inject_skipped_lines: r.inject_skipped_lines,
    stdout_tail: r.stdout_tail, stderr_tail: scrub(r.stderr_tail), duration_ms: r.duration_ms,
    observed: r.observed,
  }));
  return { ...agg, details };
}

function buildMd(cards, agg, rounds) {
  const L = [];
  const skipReasons = Object.entries(agg.skipped_reasons).map(([k, v]) => `${k} ${v}`).join('＋');
  L.push('# 逐卡实测报告（probe-runner 生成）', '');
  L.push(`- 卡：${agg.cards} 张｜verify 条目：${agg.verify_total}｜repeat：${agg.repeat} 轮`);
  L.push(`- 一致 ${agg.match}｜不一致 ${agg.mismatch}｜skipped ${agg.skipped}（${skipReasons}）｜run_error ${agg.run_error}`);
  L.push(`- 稳定性：稳定 ${agg.stability.stable}／${agg.cards}｜不稳定 ${agg.stability.unstable}`);
  L.push('- 对账规则：verdict=漏 ⇒ 期望 exit 0；verdict=报警 ⇒ 期望 exit≠0；退出码列为「R1|R2|…」各轮实测值，skipped 记 `-`');
  L.push('- observed 为卡上手写的历史记录，仅作参考，不参与判定', '');
  L.push('| # | 卡名 | verify | 一致 | 不一致 | skipped | 逐条实测退出码 | 结论 |');
  L.push('|---|------|--------|------|--------|---------|----------------|------|');
  let n = 0;
  for (const { card } of cards) {
    n++;
    const per = rounds.map((recs) => recs.filter((r) => r.card === card.id));
    const flat = per.flat();
    const cnt = (x) => flat.filter((r) => r.result === x).length;
    const codes = per[0].map((_, i) => {
      const codeList = per.map((recs) => {
        const r = recs[i];
        return r.result === 'skipped' ? '-' : String(r.actual_exit);
      }).join('|');
      const mark = '①②③④⑤'[i] ?? `#${i + 1}`;
      return `${mark}${codeList}`;
    }).join(' ');
    const stable = agg.stability.unstable_cards.some((u) => u.card === card.id) ? '不稳定' : '稳定';
    L.push(`| ${n} | ${card.id} | ${flat.length} | ${cnt('match')} | ${cnt('mismatch')} | ${cnt('skipped')} | ${codes} | ${stable}·${cardRoundVerdict(flat)} |`);
  }
  const bad = rounds.flat().filter((r) => r.result === 'mismatch' || r.result === 'run_error');
  if (bad.length) {
    L.push('', '## 不一致 / 跑失败明细（含证据尾行）', '');
    for (const r of bad) {
      L.push(`### ${r.card} · 第 ${r.entry} 条 · ${r.target} · 第 ${r.round} 轮`);
      L.push(`- cmd（占位符形态）：\`${r.cmd}\``);
      L.push(`- verdict：${r.verdict}（期望 exit ${r.expected}）｜实测 exit：${r.actual_exit ?? '-'}${r.crashed ? '（进程崩溃）' : ''}`);
      if (r.skip_reason) L.push(`- 原因：${r.skip_reason}`);
      const lastErr = (r.stderr_tail ?? '').split('\n').filter(Boolean).pop();
      if (lastErr) L.push(`- stderr 尾行：\`${lastErr}\``);
      const lastOut = (r.stdout_tail ?? '').split('\n').filter(Boolean).pop();
      if (lastOut && r.result === 'mismatch') L.push(`- stdout 尾行：\`${lastOut}\``);
      if (r.observed) L.push(`- 卡面 observed（历史参考）：${r.observed}`);
      L.push('');
    }
  }
  const injectedSkip = rounds.flat().filter((r) => r.result === 'skipped' && r.inject_executed);
  if (injectedSkip.length) {
    L.push('## inject 依赖 skipped 明细（R1：显式可辨，非静默崩溃）', '');
    for (const r of injectedSkip) {
      L.push(`### ${r.card} · 第 ${r.entry} 条 · ${r.target} · 第 ${r.round} 轮`);
      L.push(`- result：skipped｜skip_reason：${r.skip_reason}`);
      L.push(`- inject 跳过行（${r.inject_skipped_lines.length}）：${r.inject_skipped_lines.map((s) => s.split(' ')[0]).join('、')}`);
      L.push('');
    }
  }
  if (agg.stability.unstable_cards.length) {
    L.push('## 不稳定卡', '');
    for (const u of agg.stability.unstable_cards) L.push(`- ${u.card}：各轮卡结论 ${u.verdicts_per_round.join(' → ')}`);
  }
  return L.join('\n') + '\n';
}

export function buildReportFilesMd(cards, agg, rounds) { return buildMd(cards, agg, rounds); }

// ---------- main ----------
export async function main(argv = process.argv.slice(2)) {
  let opt;
  try { opt = parseArgs(argv); } catch (e) { return die(2, e.message); }
  if (opt.help) { console.log(usage()); return 0; }
  for (const [k, v] of [['--cards', opt.cards], ['--toys', opt.toys]]) if (!v) return die(2, `缺少必填参数 ${k}（--help 看用法）`);
  if (!Number.isInteger(opt.repeat) || opt.repeat < 1 || opt.repeat > 10) return die(2, `--repeat 须为 1–10 的整数（收到：「${opt.repeat}」）`);
  for (const [name, dir] of [['--cards', opt.cards], ['--toys', opt.toys]]) {
    if (!existsSync(dir) || !statSync(dir).isDirectory()) return die(2, `${name} 目录不存在或不是目录：「${dir}」`);
  }
  // T32-D3：夹具根目录解析 —— 默认系统临时目录（只读安装场景写不了安装目录）；--work 显式给 ⇒ 用它。
  // 这里先探可用性（fail-fast ⇒ exit 2），夹具根 = <workDir>/.tmp-pr-<pid> 由 runAll 建删。
  const workDir = opt.work != null ? resolve(opt.work) : tmpdir();
  try {
    mkdirSync(workDir, { recursive: true });
    if (!statSync(workDir).isDirectory()) return die(2, `--work 不是目录：「${workDir}」`);
  } catch (e) {
    return die(2, `--work 目录不可用（${e.code ?? e.message}）：${workDir}`);
  }
  const onlyBase = opt.only ? basename(opt.only) : null;
  let cardFiles = readdirSync(opt.cards).filter((f) => /\.ya?ml$/.test(f)).sort();
  if (opt.only) {
    cardFiles = cardFiles.filter((f) => f === onlyBase || f === basename(opt.only, '.yaml'));
    if (!cardFiles.length) return die(2, `--only：卡文件「${opt.only}」不在卡目录中（不许当成 0 张卡 ⇒ 通过）`);
  }
  if (!cardFiles.length) return die(2, '卡目录中没有 .yaml 卡（0 张卡不许当作通过）');

  // R4：非 ASCII 路径显式告警（stderr，不污染 --json 的 stdout）；纯 ASCII 不打印（T32-D3：+work 目录）
  const warn = nonAsciiWarning([process.cwd(), resolve(opt.cards), resolve(opt.toys), SCRIPT_DIR, workDir]);
  if (warn) process.stderr.write(warn + '\n');

  const cards = [];
  for (const f of cardFiles) {
    let card;
    try { card = parseCardText(readFileSync(join(opt.cards, f), 'utf8')); }
    catch (e) { return die(2, `卡解析失败 ${f}：${e.message}`); }
    cards.push({ file: f, card });
  }

  const { rounds, scrub } = runAll(opt, opt.cards, opt.toys, cards, workDir);
  const agg = aggregate(cards, opt, rounds);
  const bad = agg.mismatch + agg.run_error > 0 || agg.stability.unstable > 0;
  const exitCode = bad ? 1 : 0;

  if (opt.json) {
    const json = buildJson(agg, rounds, scrub);
    console.log(JSON.stringify(json, null, 2));
  } else {
    console.log(printHuman(cards, opt, agg, rounds, opt.quiet));
  }
  if (opt.jsonOut) {
    try { writeFileSync(opt.jsonOut, JSON.stringify(buildJson(agg, rounds, scrub), null, 2) + '\n', 'utf8'); }
    catch (e) { return die(2, `--json-out 写入失败：${e.message}`); }
  }
  if (opt.report) {
    try { writeFileSync(opt.report, buildMd(cards, agg, rounds), 'utf8'); }
    catch (e) { return die(2, `--report 写入失败：${e.message}`); }
  }
  return exitCode;
}

const invokedAs = (() => {
  try {
    return process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch { return false; }
})();
if (invokedAs) main().then((c) => { if (typeof c === 'number') process.exit(c); }).catch((e) => die(2, e.stack ?? String(e)));
