# 变更记录

本项目的版本号遵循[语义化版本](https://semver.org/lang/zh-CN/)。

## 0.2.0 — 2026-10-04

### 新增

- **`probe-runner --work <目录>`**：夹具根目录可外置（默认系统临时目录）⇒ 本包被装进**只读的 `node_modules`** 后也能正常运行（此前必然失败）。**不传 `--work` 的既有调用式保持可用**；`--work` 缺值会显式报错（退出码 `2`），不静默回落到默认目录。
- **`audit-kit` 补充 Node 真实 API 词形**（减少漏报）：
  - 子进程面：`fork(`
  - 写盘面：`copyFile(Sync)?(`／`rename(Sync)?(`／`truncate(Sync)?(`／`createWriteStream`
  - 出网面：**只 `import` 不直接调**的写法（`import { request } from 'node:http'` 形态）
- **审计档标题带上原始命中数**：`## Static findings（原始命中 N 条，折行后 M 条）` —— 正文是按 (规则, 文件) 折行后的条数，**N 才是真实工作量**。
- **README 新增「门禁怎么接」示例**（可整行复制，见 `README.md` §三③）。

### 变更

- **退出码语义澄清**：`0` ＝ 已产出有效审计档且结论**不是** `reject`｜`1` ＝ 自检失败（拦下不产出）｜`2` ＝ 用法或参数错｜`3` ＝ **审计结论为 `reject`**（审计档已产出）。**结论请以 `recommendation` 字段为准** —— `… || exit 1` 能拦住 `reject`，但它**分不出**「结论 reject（`3`）」与「自检失败（`1`）／用法错（`2`）」。
- **`audit-kit` 收窄两条假红**：
  - `re.exec(line)` 这类 `RegExp.prototype.exec` **不再**被判为「子进程」；
  - `process.env.X` **不再**被判为「碰凭据」（改为只认引号包裹的路径字面量，故 `fs.readFileSync('.env')`／`require('./a.env')` **仍报**）。
  - ⚠️ **如实声明代价**：本工具是静态口径，无法区分 receiver 是正则对象还是 `child_process` 实例 ⇒ `cp.exec(…)` 这类「某对象的方法调用」形态会一并被静默。

### 修复

- **审计档自检与标题同步**：段位校验按新标题形态核对，**旧形态的裸标题 `## Static findings` 会被拦下**（显式报错，不静默放过）。
- 一处已知文案瑕疵（`probe-runner` 的非 ASCII 路径告警里有一个无效转义，导致该行少显示一个反斜杠）**不影响功能**，留待后续版本修。

## 0.1.0 — 2026-10-04

首个公开版本：**27 张探针卡**（每条对应一次真实事故）＋ **28 个中立标本装置** ＋ **4 个零依赖 CLI**（`card-yaml-lint`／`card-contract-lint`／`audit-kit`／`probe-runner`）＋ 契约 `docs/JUDGE.md` ＋ 成文 `docs/27-ways-ai-fakes-done.md`。
