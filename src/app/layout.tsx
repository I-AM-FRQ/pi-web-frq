import type { Metadata } from "next";
import "./globals.css";
import { ThemeProvider } from "@/client/theme";
import { SettingsProvider } from "@/client/settings";
import { ErrorBoundary } from "@/components/error-boundary";
import { AuthGate } from "@/components/auth-gate";

export const metadata: Metadata = {
  title: "pi-web-frq",
  description: "A local multi-model coding agent workspace powered by pi",
};

// 在 hydration 前根据存储偏好或系统偏好设置主题，避免闪烁。
const THEME_BOOTSTRAP = `(function(){try{var stored=localStorage.getItem("pi-workbench-theme");var theme=(stored==="light"||stored==="dark")?stored:(window.matchMedia("(prefers-color-scheme: light)").matches?"light":"dark");document.documentElement.dataset.theme=theme;}catch(error){document.documentElement.dataset.theme="dark";}})();`;

// 动态视口：用 visualViewport 高度（键盘弹出、浏览器工具栏收起时变化）驱动界面高度，
// 同时测量物理安全区并把结果写入 CSS 变量，供所有布局使用。
const VIEWPORT_BOOTSTRAP = `(function(){
  function readSafeAreas(){
    var probe=document.createElement("div");
    probe.style.cssText="position:fixed;left:0;top:0;width:0;height:0;visibility:hidden;pointer-events:none;padding-top:env(safe-area-inset-top);padding-right:env(safe-area-inset-right);padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);";
    document.documentElement.appendChild(probe);
    var cs=window.getComputedStyle(probe);
    var map={};
    ["top","right","bottom","left"].forEach(function(side){
      var prop="padding"+side.charAt(0).toUpperCase()+side.slice(1);
      var value=parseFloat(cs.getPropertyValue(prop));
      map[side]=Number.isFinite(value)&&value>0?value:0;
    });
    probe.remove();
    return map;
  }
  var lastW=-1,lastH=-1,lastSafeW=-1,safeCache=null;
  function apply(){
    try{
      var w=window.innerWidth;
      var vv=window.visualViewport;
      var h=(vv&&vv.height>0)?vv.height:window.innerHeight;
      // 尺寸未变化直接返回：滚动等高频事件不会触发任何样式重算，避免卡顿。
      if(w===lastW&&h===lastH) return;
      lastW=w;
      lastH=h;
      // 安全区是静态的，只在宽度变化（旋转）时重新测量，其余复用缓存。
      if(!safeCache||w!==lastSafeW){
        safeCache=readSafeAreas();
        lastSafeW=w;
      }
      var safe=safeCache;
      var root=document.documentElement;
      root.style.setProperty("--app-w", w+"px");
      root.style.setProperty("--app-h", h+"px");
      root.style.setProperty("--safe-top", safe.top+"px");
      root.style.setProperty("--safe-right", safe.right+"px");
      root.style.setProperty("--safe-bottom", safe.bottom+"px");
      root.style.setProperty("--safe-left", safe.left+"px");
      root.dataset.landscape=w>h?"1":"0";
      root.dataset.mobile=(w<=680||(w<=980&&h<=520))?"1":"0";
    }catch(error){}
  }
  apply();
  var pending=null;
  function schedule(){
    if(pending) return;
    pending=requestAnimationFrame(function(){ pending=null; apply(); });
  }
  window.addEventListener("resize", schedule);
  window.addEventListener("orientationchange", schedule);
  // 只监听尺寸变化（resize）；不监听 scroll，滚动不改变布局尺寸。
  var vv=window.visualViewport;
  if(vv){
    vv.addEventListener("resize", schedule);
  }
})();`;

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" suppressHydrationWarning>
      <head>
        <script dangerouslySetInnerHTML={{ __html: THEME_BOOTSTRAP }} />
        <script dangerouslySetInnerHTML={{ __html: VIEWPORT_BOOTSTRAP }} />
      </head>
      <body>
        <ThemeProvider><SettingsProvider><ErrorBoundary><AuthGate>{children}</AuthGate></ErrorBoundary></SettingsProvider></ThemeProvider>
      </body>
    </html>
  );
}
