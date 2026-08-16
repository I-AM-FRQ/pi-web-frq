"use client";

import { SubagentWidget } from "@/components/subagent-widget";

/**
 * 悬浮组件草稿页：独立画布调试组件样式与交互。
 * 组件与主应用共用同一实现与 globals.css，草稿页调满意 = 主应用同步生效。
 */
export default function WidgetPrototypePage() {
  return (
    <main className="widget-prototype-page">
      <div className="widget-prototype-hint">
        <h1>悬浮组件草稿页</h1>
        <p>此页独立于主应用，专门调试右上角悬浮组件（样式/动画/交互）。</p>
        <p>调整反馈直接提出；样式在 globals.css 中修改，主应用同步生效。</p>
      </div>
      <div className="widget-prototype-stage">
        <p className="widget-prototype-stage-label">组件演示区（组件固定在视窗右上方，与主应用位置规则一致）</p>
      </div>
      <SubagentWidget sessionId={null} />
    </main>
  );
}
