// P1 装置：把"文档里写的版本"当成现场版本，据此挑 API —— 从不探测现场。
// 运行：node toys/p1-assumed-version.mjs
const DOC_VERSION = 'v16.20.0';                 // 从文档抄来的"本机运行时版本"
const major = Number(DOC_VERSION.slice(1).split('.')[0]);
const hasStructuredClone = major >= 17;         // 假设 v16 ⇒ 认定现场没有 structuredClone

const clone = hasStructuredClone
  ? (v) => structuredClone(v)                   // 现场其实有这条，但按假设永不走到
  : (v) => JSON.parse(JSON.stringify(v));       // 真跑的降级路径

const src = { when: new Date('2026-10-01T00:00:00Z'), tags: new Set(['a']), n: 1, u: undefined };
const got = clone(src);
console.log('装置依据的版本:', DOC_VERSION, '（未检测现场）');
console.log('出参:', JSON.stringify(got));
console.log('字段类型: when=' + typeof got.when + ' tags=' + (got.tags instanceof Set ? 'Set' : typeof got.tags) + ' u键存在=' + ('u' in got));
console.log('verdict: OK');
