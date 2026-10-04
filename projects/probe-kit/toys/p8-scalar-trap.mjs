// 故意犯的错：把 `Sort-Object -Unique` 的结果当数组用。
//   只有 1 个元素时它返回**标量字符串**，`$times[0]` 取到的是**首字符** '1'，
//   于是 "全部同时创建" 的判据恒为 False ⇒ 走"不删除"分支；打印出来却完全正常，不报错。
// 真正的判定逻辑在 PowerShell 里，本文件只是启动器 + 现场布置。
import { execFileSync } from 'node:child_process';
import { rmSync } from 'node:fs';

const dir = new URL('./.p8-scratch', import.meta.url).pathname.replace(/^\//, '');
const script = `
$ErrorActionPreference = 'Stop'
$d = '${dir}'
Remove-Item -Recurse -Force $d -ErrorAction SilentlyContinue
1..3 | ForEach-Object { New-Item -ItemType Directory -Path (Join-Path $d "entry-$_") | Out-Null }
Get-ChildItem $d | ForEach-Object { $_.CreationTime = Get-Date '2026-10-01 10:39:13' }
$times = Get-ChildItem $d | ForEach-Object { $_.CreationTime.ToString('HH:mm:ss') } | Sort-Object -Unique
Write-Output "收集到的时间戳: $times"
Write-Output ("元素个数: " + $times.Count)
Write-Output ("取第 0 项得到的实际内容: '" + $times[0] + "'")
$same = ($times[0] -eq '10:39:13')
Write-Output "判据(所有条目同时创建): $same"
if ($same) { Remove-Item -Recurse -Force $d; Write-Output '判定: 满足 -> 已删除'; exit 0 }
Write-Output ("判定: 不满足 -> 未删除；目录下仍有 " + (Get-ChildItem $d).Count + " 项")
exit 0
`;

let out;
try {
  out = execFileSync('pwsh', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
} catch {
  out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8' });
}
process.stdout.write(out);
rmSync(dir, { recursive: true, force: true });
console.log('装置退出码 0（未报警）');
