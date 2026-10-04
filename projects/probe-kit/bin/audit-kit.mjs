#!/usr/bin/env node
/**
 * audit-kit.mjs —— 审计档生成器 v0
 *
 * 用法：node audit-kit.mjs --plugin <插件包目录> [--out <输出目录>] [--json] [--stamp <yyyyMMdd-HHmmss>] [--help]
 *
 * 给它一个插件包目录，产出一份符合 VET-AUDIT_PROTOCOL（Step 5）的审计档：
 * - 文件名严格按协议构造：<去@并用-替/的插件名>-<版本原样>-<yyyyMMdd-HHmmss>.md
 *   （文件名不匹配 ⇒ vet 门禁照拦，档案等于白写 —— 本工具最要命的一处，规则逐字实现）
 * - 五段结构齐：# VET health record 表头 ＋ Static findings ＋ Agent investigation ＋
 *   Quality audit (step 4.5) ＋ Review trail (evidence)
 * - Recommendation 由结论矩阵机判切片给出：有 critical ⇒ reject；只有 suspicious ⇒ review
 *   （假阳性未经排除，机器不许替人升 approve）；全零 ⇒ review（机器永远不自动 approve，v0.1 起）
 * - 表头/正文里的插件名保留 @scope/name 原样（只有文件名做转义 —— 与真实档案一致）
 *
 * v0 边界（如实）：静态扫描＝本地 8 条规则（见 RULES），不是 vet 的 scan_plugin；
 *   Agent investigation 的深挖、Quality audit 的契约/质量通读属于协议 Step 2–4.5 的 agent 环节，
 *   本工具在对应段落如实标注「v0 未做」，产出的是一份**初稿**，不是替 agent 下最终结论。
 *
 * v0.2（假红修复，两处）：
 *   ① 「动态加载」在**剥除注释与字符串字面量内容**后的代码文本上判定（最严重的一类假红：注释里的
 *      `// never require():` 散文曾被当成动态加载 ⇒ 干净插件被 reject）。剥除只影响"是否命中"：
 *      行号与 snippet 一律取**原始行**；块注释跨行状态 MUST 保持；转义要认（"a\"b" 的引号不算结束）；
 *      模板串内 ${…} 插值按普通代码处理（插值里可以是真代码）；require()／import() **空参数不算命中**
 *      （无参 ≠ 参数是变量）。**已知边界（如实写明）**：正则字面量与除法不区分 ⇒ 正则里的 require(
 *      仍可能命中（宁可假红）；跨行模板串的**续行**按代码扫（宁可假红，不放走真红）；
 *      被审对象本身是扫描器时仍会自命中（规则表里写着那些模式）——已知且不改。
 *      其余 7 条规则仍按**原始行**匹配，一字不变（字符串里的 child_process／token 等照旧命中）。
 *   ② 「静默终止」按**文件角色**分级（次严重的一类假红：安装脚本的正常 process.exit 曾被判可疑）：
 *      install／cli／test ⇒ **info**（仍出现在报告三处、带〔角色=…〕标注、不计入 critical/suspicious
 *      计数 ⇒ 不改变 verdict），lib ⇒ suspicious（保持现状 —— 库内静默终止宿主才是问题）。
 *      角色只认四条硬线索（不许读文件内容猜角色，shebang 除外）：路径任一段 ∈ {test,tests,__tests__}
 *      或文件名 *.test.*／*.spec.* ⇒ test；文件名 (pre|post)?install.*／uninstall.* 或
 *      package.json 的 scripts.preinstall/install/postinstall 值含该文件名 ⇒ install；
 *      package.json 的 bin（字符串或对象值）指向该文件或首行 #! ⇒ cli；**其余（含不确定）⇒ lib**
 *      （宁可留假红，不可放走真红）。**角色分级只对「静默终止」生效** —— eval( 放进 install.mjs
 *      仍然 critical，角色不是放水通道。
 *
 * 输出：默认打到 stdout（首行 === 协议文件名 ===，便于直接复制）；
 *   --out <目录> ⇒ 真写出 <目录>/<协议文件名>（目录不存在则创建；同名已存在 ⇒ 拒写 exit 2）；
 *   --json ⇒ 机器可读（filename／plugin／version／recommendation／findings 等）。
 *
 * 退出码：0 达标 ｜ 1 自检失败（产出档缺必填段位／Recommendation 非法 —— 拦下不产出，不许静默出档）
 *   ｜ 2 用法或参数错（--plugin 缺失/不存在/无 package.json/无 name、未知 flag、--stamp 格式错、写出失败）。
 *
 * 零依赖：只用 node:fs／node:path／node:url；文件 UTF-8 无 BOM、LF。
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync, statSync, readdirSync } from 'node:fs';
import { join, dirname, resolve, relative, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const RECORD_TOOL = 'audit-kit.mjs v0';
const RULE_NAMES = '动态执行／子进程／出网／写盘／碰凭据／动态加载／混淆迹象／静默终止';
const MAX_FILE_BYTES = 2 * 1024 * 1024; // >2MB 的文件跳过（v0：防巨型产物拖垮扫描；如实计入 skipped）
// v0.1（2026-10-02 审查者改）：**只扫代码文件** —— 实测真插件上"碰凭据"266 条里大量来自审计协议文档／
// CHANGELOG.md（文档里"提到" token／child_process 就命中）⇒ 文档不是代码，扫它＝纯噪声。
const CODE_EXT = ['.js', '.mjs', '.cjs', '.jsx', '.ts', '.mts', '.cts', '.tsx'];
const SNIPPET_MAX = 120;                // finding 里引用源码行的截断长度（混淆行另加说明）

// ---------- 静态规则 v0（任务包 §七 8 条；词形按规则原文，\b 只加在有明显子串撞车的词上） ----------
// severity 定级：critical ＝ 按结论矩阵必须一票否决的类别（动态执行／动态加载／混淆／碰凭据）；
// suspicious ＝ 能力面信号（子进程／出网／写盘／静默终止），真伪要靠 agent 甄别 —— 机器不替人拍板。
// v0.2：「静默终止」的 severity 会被「文件角色」改判（install/cli/test ⇒ info，见 scanLine 与 classifyFileRole）；
//       RULES 表本身一字未动 —— 判级调整发生在命中装配处，且只对这一条生效。
const RULES = [
  { name: '动态执行', severity: 'critical', patterns: [/\beval\(/, /new Function\(/, /vm\.runIn/] },
  { name: '子进程', severity: 'suspicious', patterns: [/child_process/, /\bspawn\(/, /\bexec\(/] },
  { name: '出网', severity: 'suspicious', patterns: [/fetch\(/, /http\.request/, /https\.request/, /WebSocket/] },
  { name: '写盘', severity: 'suspicious', patterns: [/writeFile/, /appendFile/, /\brm\(/, /unlink/, /mkdir/] },
  // 碰凭据：**v0.1 降级为 suspicious** —— 原 v0 按我任务包写的「severity 取高」把它定成 critical，实测真插件上
  // 直接一票 reject（假红）—— 规格给错、执行者照做，假红就是这么产生的。
  { name: '碰凭据', severity: 'suspicious', patterns: [/\.credentials/, /\.env/, /apiKey/, /token/, /secret/] },
  { name: '动态加载', severity: 'critical', kind: 'dynamicRequire' },
  { name: '混淆迹象', severity: 'critical', kind: 'obfuscation' },
  { name: '静默终止', severity: 'suspicious', patterns: [/process\.exit\(/] },
];

// ---------- 公共 helper ----------
function stripBom(s) { return s.charCodeAt(0) === 0xfeff ? s.slice(1) : s; }

// 本地时钟时间戳 yyyyMMdd-HHmmss（日期与时间之间有短横 —— 协议 Step 5 第 4 条）
export function localStamp(d = new Date()) {
  const p = (n) => String(n).padStart(2, '0');
  return `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`;
}

// 协议 Step 5 第 1–3 条：去 scope 的 @；每个 / ⇒ -（点保留）。
// 文件路径型插件名（如 /home/x/y.mjs）同样被这条覆盖：前导 / 会变前导 -（与协议第 3 条一致）。
export function escapePluginName(name) {
  const s = name.startsWith('@') ? name.slice(1) : name;
  return s.split('/').join('-');
}

// 协议 Step 5：<escaped-name>-<版本原样>-<yyyyMMdd-HHmmss>.md（版本含 -rc.8 这类后缀时原样保留）
export function pickFilename(name, version, stamp) {
  return `${escapePluginName(name)}-${version}-${stamp}.md`;
}

// 结论矩阵的机判切片（v0.1 收紧；v0.2 口径微调）：
//   有 critical ⇒ reject（矩阵第 1 行：critical 直接否，无需深挖）；
//   有 suspicious ⇒ review；
//   其余（含"零命中"与"只有 info"）⇒ review —— 矩阵要求 clean 且 **质量（step 4.5）通过** 才可 approve，
//   而 v0 不做 4.5 ⇒ **机器不得自动 approve**；approve 只能由 agent 用 --recommendation 显式给（fail-closed）。
//   v0.2：**info 不计入** critical／suspicious 计数 ⇒ 角色降级不改变 verdict（但命中仍如实列出）。
export function recommendFromFindings(findings) {
  const critical = findings.filter((f) => f.severity === 'critical').length;
  const suspicious = findings.filter((f) => f.severity === 'suspicious').length; // v0.2：不再用 total−critical 推算（info 不许混入）
  const info = findings.filter((f) => f.severity === 'info').length;
  if (critical > 0) return { recommendation: 'reject', verdict: 'critical', emoji: '🔴', risk: 'high', critical, suspicious, info };
  if (suspicious > 0) return { recommendation: 'review', verdict: 'suspicious', emoji: '🟠', risk: 'medium', critical, suspicious, info };
  return { recommendation: 'review', verdict: 'clean', emoji: '🟢', risk: 'low', critical, suspicious, info, cleanButQualityAuditMissing: true };
}

// v0.1：机判 ＋（可选）agent 显式拍板 —— 唯一的 approve 通道
export function effectiveRecommendation(findings, override) {
  const v = recommendFromFindings(findings);
  const rec = override === null || override === undefined ? v.recommendation : override;
  return { ...v, recommendation: rec, overridden: rec !== v.recommendation };
}

// ---------- 静态扫描 v0 ----------
// 规则 6：require( / import( 的参数不是字面量（拼接／变量／模板串）⇒ 命中
// v0.2：入参是「剥除注释与字符串后的代码文本」；空参数（require()／import()）不算命中。
function dynamicRequireHits(line) {
  const hits = [];
  const re = /(?:require|import)\s*\(/g;
  let m;
  while ((m = re.exec(line)) !== null) {
    let depth = 1;
    let i = m.index + m[0].length;
    while (i < line.length && depth > 0) { // 同行内取括号体（v0 简化：跨行不算）
      const c = line[i];
      if (c === '(') depth++;
      else if (c === ')') depth--;
      i++;
    }
    const arg = line.slice(m.index + m[0].length, depth === 0 ? i - 1 : line.length).trim();
    if (arg === '') continue; // v0.2（空参判定）：require()／import() 空参数 ⇒ 无参 ≠ 参数是变量 ⇒ 不命中
    if (!/^(['"])([^'"\n]*)\1$/.test(arg)) hits.push(arg); // 单一引号字面量 ⇒ 放行（其内容由别的规则管）
  }
  return hits;
}

// 规则 7：单行 ≥2000 字符，且行内存在 ≥2000 字符的连续 token、其字符 ≥95% 落在 base64/hex 字母表
//（token 口径避免把长英文注释/中文文档误判成 base64；纯压缩 JS 因标点占比高也不会命中）
const B64ISH = /[A-Za-z0-9+/=_.-]/;
function obfuscationHit(line) {
  if (line.length < 2000) return false;
  for (const tok of line.split(/\s+/)) {
    if (tok.length < 2000) continue;
    let n = 0;
    for (const c of tok) if (B64ISH.test(c)) n++;
    if (n / tok.length >= 0.95) return true;
  }
  return false;
}

function snippet(line) {
  const s = line.trim();
  return s.length > SNIPPET_MAX ? s.slice(0, SNIPPET_MAX) + `…（本行共 ${s.length} 字符）` : s;
}

// ---------- v0.2（二·A）：同行预处理 —— 剥注释与字符串字面量 ----------
// 只服务「动态加载」规则：把**注释**与**字符串字面量的内容**从判定文本里去掉，只留"会执行的代码"。
//   - 行注释 //（不在字符串内）之后整段去掉；块注释 /* … */ 的跨行状态经 st = { inBlock } 保持，
//     中间的行整行不参与；同行 `/* x */ 代码` 在 */ 之后恢复为代码。
//   - 字符串 '…' "…" `…` 的内容去掉、**引号保留**（require('lit') ⇒ require('') 仍是字面量 ⇒ 放行）；
//     转义要认（"a\"b" 的引号不算结束）；模板串内 ${…} 插值按普通代码处理（插值里可以是真代码）。
//   - 已知边界（如实写明，别假装完美）：
//     ① 正则字面量与除法不区分 —— /require(x)/ 这类正则里的 require( 仍会命中（宁可假红）；
//     ② 跨行模板串的续行（第 2 行起）按代码扫 —— 模板散文可能假红（宁可假红，不放走真红）；
//     ③ 字符串以反斜杠收尾跨行续接的，续行同样按代码扫（同②）。
//     本函数不追求成为词法分析器：它只服务"剥注释"这一件事，误剥方向永远朝"多报"不朝"漏报"。
// 行号与 snippet 一律取**原始行**（本函数的返回值只决定"是否命中"，不出现在任何报告里）。
export function codeTextOf(line, st) {
  if (st.inBlock) {
    const end = line.indexOf('*/');
    if (end === -1) return '';      // 整行仍在块注释里
    line = line.slice(end + 2);     // */ 之后恢复为代码
    st.inBlock = false;
  }
  let out = '';
  const stack = [];                 // 'sq' | 'dq' | 'tpl' | '${'（插值可嵌套，用栈）
  let i = 0;
  while (i < line.length) {
    const c = line[i];
    const top = stack[stack.length - 1];
    if (top === 'sq' || top === 'dq') {
      if (c === '\\') { i += 2; continue; } // 转义：连反斜杠带后字符一起吃（"a\"b" 的引号不算结束）
      if ((top === 'sq' && c === "'") || (top === 'dq' && c === '"')) { out += c; stack.pop(); i++; continue; }
      i++; continue;                        // 串内容不参与匹配
    }
    if (top === 'tpl') {
      if (c === '\\') { i += 2; continue; }
      if (c === '`') { out += c; stack.pop(); i++; continue; }
      if (c === '$' && line[i + 1] === '{') { stack.push('${'); out += '${'; i += 2; continue; }
      i++; continue;                        // 模板串散文不参与匹配
    }
    // 代码模式（含 '${' 插值内部 —— 插值按普通代码处理）
    if (c === '/' && line[i + 1] === '/') break;               // 行注释：其后整段不参与
    if (c === '/' && line[i + 1] === '*') {                    // 块注释
      const end = line.indexOf('*/', i + 2);
      if (end === -1) { st.inBlock = true; break; }            // 开到行外 ⇒ 跨行状态置位
      i = end + 2; continue;                                   // 同行闭合 ⇒ */ 之后是代码
    }
    if (c === "'") { stack.push('sq'); out += c; i++; continue; }
    if (c === '"') { stack.push('dq'); out += c; i++; continue; }
    if (c === '`') { stack.push('tpl'); out += c; i++; continue; }
    if (c === '}' && top === '${') { stack.pop(); out += '}'; i++; continue; } // 插值闭合 ⇒ 回模板串
    out += c; i++;
  }
  return out;
}

// ---------- v0.2（二·B）：文件角色 ----------
// 只认四条硬线索（路径段／文件名／package.json 的 bin·scripts／shebang），**不许**读文件内容猜角色
//（shebang 是唯一例外，且只看首行两个字符）；不许按目录名联想（scripts/ 里未必是安装脚本）。
// 优先级 test > install > cli > lib，先匹配先赢；**不确定 ⇒ lib**（宁可留假红，不可放走真红）。
export function classifyFileRole(relPosix, basename, pkg, fileText) {
  const segs = relPosix.split('/');
  if (segs.slice(0, -1).some((s) => s === 'test' || s === 'tests' || s === '__tests__')
    || /\.(test|spec)\.[^.]+$/.test(basename)) return 'test';
  if (/^(preinstall|postinstall|install|uninstall)\./i.test(basename)) return 'install';
  const scripts = (pkg && pkg.scripts) || {};
  for (const k of ['preinstall', 'install', 'postinstall']) {
    if (typeof scripts[k] === 'string' && scripts[k].includes(basename)) return 'install';
  }
  const bin = pkg && pkg.bin;
  if (bin) {
    const vals = typeof bin === 'string' ? [bin] : (typeof bin === 'object' ? Object.values(bin) : []);
    for (const v of vals) {
      if (typeof v === 'string' && v.replace(/^\.\//, '').split('\\').join('/') === relPosix) return 'cli';
    }
  }
  if (typeof fileText === 'string' && fileText.startsWith('#!')) return 'cli';
  return 'lib';
}

// v0.2：scanLine 增加两个可选入参 —— code＝剥注释后的代码文本（只供「动态加载」），role＝文件角色
//（只影响「静默终止」的判级）。不给入参时行为与 v0.1 完全一致（code=line、role='lib'）。
export function scanLine(line, code = line, role = 'lib') {
  const hits = [];
  for (const rule of RULES) {
    if (rule.kind === 'dynamicRequire') {
      const args = dynamicRequireHits(code); // v0.2：剥注释/字符串后的代码文本；行号与 snippet 仍取原始行
      if (args.length > 0) hits.push({ rule: rule.name, severity: rule.severity, message: snippet(line), patterns: args.map((a) => `非字面量参数：${a}`) });
    } else if (rule.kind === 'obfuscation') {
      if (obfuscationHit(line)) hits.push({ rule: rule.name, severity: rule.severity, message: snippet(line), patterns: ['单行≥2000字符且base64/hex占比≥95%'] });
    } else {
      const matched = rule.patterns.filter((re) => re.test(line)).map((re) => re.source);
      if (matched.length > 0) {
        // v0.2（二·B）：「静默终止」按文件角色分级 —— install/cli/test ⇒ info（降级可见：仍列出、
        // 带〔角色=…〕标注、不计入 verdict 计数），lib ⇒ suspicious（现状）。**只对这一条生效**：
        // critical 类不受角色影响（角色不是放水通道）。
        let severity = rule.severity;
        let roleMark;
        if (rule.name === '静默终止' && role !== 'lib') { severity = 'info'; roleMark = role; }
        const h = { rule: rule.name, severity, message: snippet(line), patterns: matched };
        if (roleMark) h.role = roleMark;
        hits.push(h);
      }
    }
  }
  return hits;
}

// 递归扫描插件包目录（跳过 node_modules／.git、二进制与 >2MB 文件）；目录与文件均按名排序 ⇒ 输出确定
// v0.2：新增可选入参 pkg（package.json 的解析结果，供文件角色判定）；不传 ⇒ 角色只由路径/文件名/shebang 决定。
export function scanPluginDir(root, pkg = null) {
  const findings = [];
  let files = 0, lines = 0, skipped = 0;
  const walk = (dir) => {
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1));
    for (const ent of entries) {
      const p = join(dir, ent.name);
      if (ent.isDirectory()) {
        if (ent.name === 'node_modules' || ent.name === '.git') { skipped++; continue; }
        walk(p);
        continue;
      }
      if (!ent.isFile()) { skipped++; continue; }
      if (!CODE_EXT.some((e) => ent.name.endsWith(e))) { skipped++; continue; } // v0.1：非代码（文档／JSON／清单）不扫
      let buf;
      try { buf = readFileSync(p); } catch { skipped++; continue; }
      if (buf.length > MAX_FILE_BYTES || buf.indexOf(0) !== -1) { skipped++; continue; } // 二进制（含 NUL）跳过
      files++;
      const rel = relative(root, p).split('\\').join('/');
      const text = stripBom(buf.toString('utf8'));
      const arr = text.split('\n');
      lines += arr.length;
      const role = classifyFileRole(rel, ent.name, pkg, text); // v0.2：文件角色（只影响「静默终止」判级）
      const st = { inBlock: false };                           // v0.2：块注释跨行状态（按文件重置）
      for (let i = 0; i < arr.length; i++) {
        const raw = arr[i].replace(/\r$/, '');
        const code = codeTextOf(raw, st);                      // 只供「动态加载」；其余规则仍吃原始行
        for (const h of scanLine(raw, code, role)) {
          findings.push({ ...h, file: rel, line: i + 1 });
        }
      }
    }
  };
  walk(root);
  // v0.1 折行：**能力面信号**（suspicious）同 (规则, 文件) 只留首条，其余折成 extra —— 否则"一个文件里 50 次 token"刷 50 条；
  //           **一票否决类**（critical）逐条保留（每次 eval／非字面量 require 都要看得见）。
  // v0.2：**info 与 suspicious 同规则同文件折叠**（同一文件角色唯一 ⇒ 同一条规则的 info 命中必然同判级），
  //       6 处 process.exit 折成 1 条 info ＋ extra=5 —— 折行与角色降级互不吃掉。
  const seen = new Map();
  const kept = [];
  for (const f of findings) {
    if (f.severity === 'critical') { f.extra = 0; kept.push(f); continue; } // 一票否决类逐条留（每次调用都要看得见）
    const key = f.rule + '|' + f.file;
    const hit = seen.get(key);
    if (hit === undefined) { f.extra = 0; seen.set(key, f); kept.push(f); }
    else hit.extra++;
  }
  return { findings: kept, files, lines, skipped, rawHits: findings.length };
}

// ---------- 记录组装 ----------
export function buildRecord({ name, version, filename, findings, files, lines, skipped, scannedAt, stamp, pluginRoot, rawHits, recOverride }) {
  const v = effectiveRecommendation(findings, recOverride);
  const rec = v.recommendation;
  const impact = v.recommendation === 'reject'
    ? `存在 ${v.critical} 条 critical 级静态命中 ⇒ 按结论矩阵直接 reject（critical 行无需深挖）`
    : v.recommendation === 'review'
      ? `存在 ${v.suspicious} 条 suspicious 级命中且假阳性未经排除 ⇒ 按结论矩阵取 review（人工甄别后才可升 approve）`
      : `本地 8 规则零命中 ⇒ 静态 clean；但协议 step 4.5（契约／质量核查）v0 未做 ⇒ **不给 approve，默认 review**（要 approve 必须由 agent 显式 --recommendation approve）`;
  // v0.2：info 命中带〔角色=…〕标注（降级必须可见 —— stdout／--out md／--json 三处都能看到）
  const findingLines = findings.map((f) => `- [${f.rule}] ${f.severity}: ${f.message} (${f.file}:${f.line})${f.role ? `〔角色=${f.role}〕` : ''}${f.extra > 0 ? `（另有 ${f.extra} 处）` : ''}`);
  if (findingLines.length === 0) findingLines.push('- （v0 本地 8 规则 0 命中）');

  return [
    `# VET health record: ${name}@${version}`,
    '',
    `- Scanned at: ${scannedAt}`,
    `- Static verdict: ${v.emoji} ${v.verdict} (static score n/a：v0 本地 8 规则口径，非 vet scan_plugin)`,
    '',
    '## Static findings',
    ...findingLines,
    '',
    '## Agent investigation',
    `- Risk: ${v.risk}（v0 由静态命中派生，待 agent 深挖修正）`,
    `- Recommendation: ${rec}`,
    // v0.2：Summary 里 info 单列 —— 降级命中不冒充 suspicious，也不消失
    `- Summary: v0 机读初稿：静态判定 ${v.verdict}（critical ${v.critical} 条／suspicious ${v.suspicious} 条${v.info ? `／info（角色降级）${v.info} 条` : ''}）；${impact} 深挖与逐条甄别（协议 Step 2–4）待 agent 补齐。`,
    '',
    '## Quality audit (step 4.5)',
    '- Contract: （v0 未核查 —— 本段属协议 Step 4.5 的 agent 通读环节）',
    '- Defect list: （v0 无人工缺陷清单）',
    `- Impact: ${impact}`,
    '',
    '## Review trail (evidence)',
    `- 生成器：${RECORD_TOOL} —— 静态规则 8 条（${RULE_NAMES}）；severity 定级与 Recommendation 映射见任务包 §七结论矩阵`,
    `- 扫描范围：${pluginRoot} —— ${files} 个文件 / ${lines} 行（跳过 node_modules、.git、二进制与 >2MB 文件共 ${skipped} 项）`,
    `- 生成时间戳：${stamp}（本地时钟）；文件名按协议 Step 5 构造：${filename}`,
    `- 扫描口径（v0.1）：**只扫代码文件**（${CODE_EXT.join('/')}）；能力面信号按 (规则, 文件) 折行后 ${findings.length} 条（原始命中 ${rawHits === undefined ? findings.length : rawHits} 条）`,
    `- 角色分级（v0.2）：「静默终止」按文件角色判级 install/cli/test ⇒ info、lib ⇒ suspicious；info 不计入 critical/suspicious 计数；「动态加载」在剥注释/字符串后的代码文本上判定`,
    recOverride === null || recOverride === undefined
      ? `- Recommendation 来源：v0.1 机判切片（critical⇒reject／其余⇒review；**approve 只能由 agent 显式给**）`
      : `- Recommendation 来源：**agent 显式指定 ${recOverride}**（机判默认 ${v.overridden ? recommendFromFindings(findings).recommendation : rec}）`,
    `- 段位如实声明：Agent investigation／Quality audit 属协议 Step 2–4.5 的 agent 环节，v0 未做 ⇒ 本档是**初稿**，不可当最终审查结论`,
    '',
  ].join('\n');
}

// ---------- 自检守卫（C4）：装配完必须过这一关，不过 ⇒ exit 1 拦下，绝不静默出档 ----------
// 三类检查：表头首行逐字 ＋ 四个必填段标题各恰好一次 ＋「- Recommendation:」行恰好一次且取值合法。
// （字段值可能来自被审计包的 package.json —— 恶意/坏字段值污染档结构时，守在这里而不是发出去。）
export function validateRecord(text, { name, version }) {
  const errors = [];
  const ls = text.split('\n');
  const header = `# VET health record: ${name}@${version}`;
  if (ls[0] !== header) errors.push(`首行表头不符：期望「${header}」，实际「${ls[0]}」`);
  for (const h of ['## Static findings', '## Agent investigation', '## Quality audit (step 4.5)', '## Review trail (evidence)']) {
    const n = ls.filter((l) => l === h).length;
    if (n !== 1) errors.push(`必填段位「${h}」出现 ${n} 次（应恰好 1 次）`);
  }
  const recs = ls.filter((l) => /^- Recommendation: /.test(l));
  if (recs.length !== 1) errors.push(`「- Recommendation:」行出现 ${recs.length} 次（应恰好 1 次）`);
  else if (!/^- Recommendation: (approve|review|reject)\s*$/.test(recs[0])) {
    errors.push(`Recommendation 取值非法：「${recs[0]}」（只许 approve／review／reject）`);
  }
  return errors.length === 0 ? { ok: true } : { ok: false, errors };
}

// ---------- 参数 ----------
function usage() {
  return [
    'audit-kit.mjs —— 从插件包目录产出一份「门禁认得上」的 VET 审计档（v0）',
    '',
    '用法：node audit-kit.mjs --plugin <插件包目录> [--out <输出目录>] [--json] [--stamp <yyyyMMdd-HHmmss>] [--recommendation <approve|review|reject>] [--help]',
    '  --plugin  插件包目录（必填；须含 package.json，读 name／version）',
    '  --out     写出 <目录>/<协议文件名>（目录不存在则创建；同名已存在 ⇒ 拒写 exit 2）；不给则打到 stdout（首行 === 文件名 ===）',
    '  --json    机器可读输出（filename／plugin／version／recommendation／verdict／findings／scanned）',
    '  --stamp   固定时间戳 yyyyMMdd-HHmmss（不给则取本地时钟；供复现/自测逐字断言文件名）',
    '  --recommendation  agent 显式拍板的结论 —— **approve 只能这么给**（v0.1 机判默认 review：零命中也不自动 approve）',
    '  --help    本说明',
    '',
    '规则口径（v0.2 · 假红修复）：',
    '  「动态加载」在剥除注释与字符串字面量内容后的代码文本上判定（行号/摘录仍取原始行）；',
    '    require()／import() 空参数不算命中；require(x)／require(\'a\'+b)／import(name) 仍命中 critical。',
    '  「静默终止」按文件角色分级：install/cli/test ⇒ info（仍列出、带〔角色=…〕标注、不计入 verdict），lib ⇒ suspicious；',
    '    角色只认 路径段 test/tests/__tests__、*.test.*/*.spec.*、(pre|post)?install.*/uninstall.* 文件名、',
    '    scripts.(pre|post)?install 值、bin 指向、首行 #!；不确定 ⇒ lib（宁可留假红）。',
    '  已知边界：正则字面量与除法不区分（可能假红）；跨行模板串续行按代码扫（宁假红不放走真红）；',
    '    被审对象本身是扫描器时仍会自命中（已知且不改）。',
    '',
    '文件名规则（VET-AUDIT_PROTOCOL Step 5）：<去@并用-替/的插件名>-<版本原样>-<yyyyMMdd-HHmmss>.md',
    '退出码：0 达标 ｜ 1 自检失败（缺必填段位／Recommendation 非法 ⇒ 拦下不产出）｜ 2 用法或参数错',
  ].join('\n');
}

function parseArgs(argv) {
  const opts = { plugin: null, out: null, json: false, stamp: null, rec: null };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--help') { console.log(usage()); process.exitCode = 0; return null; }
    if (a === '--json') { opts.json = true; continue; }
    if (a === '--plugin' || a === '--out' || a === '--stamp' || a === '--recommendation') {
      const v = argv[i + 1];
      if (v === undefined || v === '') { console.error(`参数错：${a} 缺少值`); console.error(usage()); process.exitCode = 2; return null; }
      opts[a === '--recommendation' ? 'rec' : a.slice(2)] = v;
      i++;
    } else {
      console.error(`参数错：未知参数「${a}」（可用：--plugin／--out／--json／--stamp／--help）`);
      console.error(usage());
      process.exitCode = 2;
      return null;
    }
  }
  if (opts.plugin === null) {
    console.error('参数错：--plugin 必填（指向含 package.json 的插件包目录）');
    console.error(usage());
    process.exitCode = 2;
    return null;
  }
  if (opts.stamp !== null && !/^\d{8}-\d{6}$/.test(opts.stamp)) {
    console.error(`参数错：--stamp 格式应为 yyyyMMdd-HHmmss（收到「${opts.stamp}」）`);
    process.exitCode = 2;
    return null;
  }
  if (opts.rec !== null && !['approve', 'review', 'reject'].includes(opts.rec)) {
    console.error(`参数错：--recommendation 只许 approve／review／reject，收到「${opts.rec}」`);
    process.exitCode = 2;
    return null;
  }
  return opts;
}

// ---------- 主流程 ----------
function main(opts) {
  const root = isAbsolute(opts.plugin) ? opts.plugin : resolve(opts.plugin);
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    console.error(`--plugin 不是存在的目录：${root}`);
    process.exitCode = 2;
    return;
  }
  const pkgPath = join(root, 'package.json');
  if (!existsSync(pkgPath)) {
    console.error(`--plugin 目录里没有 package.json（v0 需要它取 name／version）：${root}`);
    process.exitCode = 2;
    return;
  }
  let pkg;
  try {
    pkg = JSON.parse(stripBom(readFileSync(pkgPath, 'utf8')));
  } catch (e) {
    console.error(`package.json 解析失败（${e.message}）：${pkgPath}`);
    process.exitCode = 2;
    return;
  }
  if (pkg === null || typeof pkg !== 'object' || typeof pkg.name !== 'string' || pkg.name.trim() === '') {
    console.error(`package.json 缺少非空 name 字段（v0 需要它构造档案名）：${pkgPath}`);
    process.exitCode = 2;
    return;
  }
  const name = pkg.name;
  // 协议 Step 5 第 5 条：无声明版本的文件路径型插件用 1.0.0；有则版本原样（含 -rc.8 后缀）
  const version = typeof pkg.version === 'string' && pkg.version.trim() !== '' ? pkg.version : '1.0.0';

  const { findings, files, lines, skipped, rawHits } = scanPluginDir(root, pkg); // v0.2：pkg 传入供文件角色判定
  const scannedAt = new Date().toISOString();
  const stamp = opts.stamp !== null ? opts.stamp : localStamp();
  const filename = pickFilename(name, version, stamp);
  const recFinal = effectiveRecommendation(findings, opts.rec).recommendation;
      const record = buildRecord({ name, version, filename, findings, files, lines, skipped, scannedAt, stamp, pluginRoot: root, rawHits, recOverride: opts.rec });

  // C4：先过自检守卫，再谈产出 —— 不过 ⇒ exit 1，stdout 零输出、盘上零落档
  const check = validateRecord(record, { name, version });
  if (!check.ok) {
    for (const e of check.errors) console.error(`自检失败：${e}`);
    console.error('已拦截：不产出审计档（不许静默出档）—— 请检查该包的 package.json 字段是否含有换行等污染字符');
    process.exitCode = 1;
    return;
  }

  let outPath = null;
  if (opts.out !== null) {
    const outDir = isAbsolute(opts.out) ? opts.out : resolve(opts.out);
    const target = join(outDir, filename);
    if (existsSync(target)) {
      console.error(`输出文件已存在，拒写（时间戳精度为秒；请删除后重试或等下一秒）：${target}`);
      process.exitCode = 2;
      return;
    }
    try {
      mkdirSync(outDir, { recursive: true });
      writeFileSync(target, record, 'utf8');
    } catch (e) {
      console.error(`写出失败（${e.code || e.message}）：${target}`);
      process.exitCode = 2;
      return;
    }
    outPath = target;
  }

  if (opts.json) {
    const v = recommendFromFindings(findings);
    console.log(JSON.stringify({
      tool: 'audit-kit',
      filename,
      plugin: name,
      version,
      recommendation: recFinal,
      verdict: v.verdict,
      findings,
      scanned: { files, lines, skipped },
      scannedAt,
      outPath,
    }, null, 2));
  } else if (outPath !== null) {
    console.log(`已写出审计档：${outPath}`);
  } else {
    console.log(`=== ${filename} ===`);
    console.log('');
    process.stdout.write(record);
  }
  process.exitCode = 0;
}

const invokedDirectly = process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  const opts = parseArgs(process.argv.slice(2));
  if (opts !== null && process.exitCode !== 2) main(opts);
}
