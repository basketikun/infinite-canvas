"use client";

import type { CSSProperties } from "react";

// 顶栏右上角已经有一个跳 /changelog 的版本号链接，VersionReleaseModal 弹窗按钮
// 跟它重复（同一行同时显示两个 vX.X.X）。这里把组件先改成空渲染，文件保留备用，
// 后续如果要恢复"弹窗形态"再回滚这一处即可——不直接删除文件是为了避免类型变化
// 把不相关的导入处一起牵连。
type VersionReleaseModalProps = {
  // 保留原来的 props 签名，调用方无须改动
  currentVersion?: string;
  className?: string;
  style?: CSSProperties;
};

export function VersionReleaseModal(_props: VersionReleaseModalProps) {
  void _props;
  return null;
}
