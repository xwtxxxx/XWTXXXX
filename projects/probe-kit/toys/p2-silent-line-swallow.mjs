// P2 装置：按"系统默认代码页"（936 式双字节）的字节配对规则解码 UTF-8 LF-only 文件。
// 老式 DBCS 解码把 >=0x81 的字节当前导字节，无条件吞掉后一字节；若后一字节是 LF(0x0A)，
// 这一行的换行就被吞掉 —— 不报错、行数静默变少。行尾若是 0x0D(CRLF)，CR 替 LF 被吞，LF 幸存。
// 运行：node toys/p2-silent-line-swallow.mjs [文件]   （不给文件则用内置 85 行 LF-only 样本）
import fs from 'node:fs';

const fixture = () => {                         // 85 行：47 行汉字结尾（吞 LF）＋38 行 ASCII 结尾
  const ls = [];
  for (let i = 1; i <= 85; i++) ls.push(i <= 47 ? `第 ${i} 条` : `entry ${i}`);
  return Buffer.from(ls.join('\n') + '\n', 'utf8');
};
const buf = process.argv[2] ? fs.readFileSync(process.argv[2]) : fixture();

const lfBytes = (b) => b.filter((x) => x === 10).length;          // 真值：数 LF，不依赖解码
function defaultCodepageRead(b) {                                 // 老式双字节读取器
  let lines = 0;
  for (let i = 0; i < b.length; i++) {
    if (b[i] >= 0x81 && i + 1 < b.length) { i++; continue; }      // 前导字节吞掉后一字节
    if (b[i] === 10) lines++;
  }
  return lines;
}
const crlf = Buffer.from(buf.toString('utf8').replace(/\r?\n/g, '\r\n'), 'utf8');
console.log('真值(LF 字节数):', lfBytes(buf));
console.log('默认代码页读到:', defaultCodepageRead(buf), '行');
console.log('同内容转 CRLF 后默认代码页读到:', defaultCodepageRead(crlf), '行');
