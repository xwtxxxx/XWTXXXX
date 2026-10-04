// 故意犯的错：--allow 声明的是"路径"，判定却用了裸字符串前缀，
//   少了 '/' 边界 —— 同前缀的另一个目录（src2/）也被判合规。
// 正确写法应为：f === allow || f.startsWith(allow + '/')
const argv = process.argv.slice(2);
const i = argv.indexOf('--allow');
const allow = i >= 0 ? argv[i + 1] : null;
const files = argv.filter((_, idx) => idx !== i && idx !== i + 1);

if (!allow || files.length === 0) {
  console.error('用法: node p7-prefix-guard.mjs --allow <dir> <path>...');
  process.exit(2);
}

const bad = files.filter((f) => !f.startsWith(allow));   // ← 缺陷就在这里

if (bad.length > 0) {
  console.log(`FAIL 越界：${bad.join(', ')}`);
  process.exit(1);
}
console.log(`OK 全部在允许范围内（检查了 ${files.length} 个）：${files.join(', ')}`);
process.exit(0);
