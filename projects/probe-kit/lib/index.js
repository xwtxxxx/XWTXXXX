/**
 * @xwtxxxx/probe-kit 宿主插件入口（**最小壳**）。
 *
 * 形态依据：dsh 生态里已发布插件的原件 —— 入口导出
 *   `Config` / `apply` / `inject` / `name`。
 *   本文件照该形态导出 `name` / `inject` / `apply` 三件。
 *
 * ⚠️ **诚实声明**：本包当前的价值在 `bin/` 的四个零依赖 CLI；
 *    宿主侧**尚未注册任何钩子**（`apply` 是空实现）——
 *    等我们读清宿主 API 再挂真东西，**不预先假装它拦得住什么**。
 */
export const name = 'probe-kit';
export const inject = [];

export function apply() {
  // 暂无宿主钩子：见上方"诚实声明"。
}
