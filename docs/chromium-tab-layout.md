# Chromium 标签布局对照

2026-11-08 根据用户指定的 Chromium 源码与参考截图调整。当前仍由 Vue 渲染标签栏，参考 Chromium 的几何与交互规则；并未切换为原生 Chromium TabStrip。

## 源码依据

本机参考目录为 `D:\electron\main\src`：

- `chrome/browser/ui/layout_constants.cc`：桌面标签轮廓高度为 34 + 1 DIP，标签栏额外顶部留白 6 DIP，图文间隔 8 DIP。
- `chrome/browser/ui/tabs/tab_style.cc`：标准标签主体宽度 232 DIP，上圆角 10 DIP，下方外扩圆角 12 DIP，分隔线 2×16 DIP。原生标签的完整宽度还包含外扩区，本项目使用 CSS 伪元素绘制外扩区。
- `chrome/browser/ui/views/tabs/common/horizontal_tab_style_views.cc`：背景轮廓、内容边距与分隔线分别布局，激活／悬停时处理相邻分隔线。
- `chrome/browser/ui/views/tabs/tab.cc`：站点图标 16 DIP，关闭按钮视觉范围与命中范围分离，标题占用扣除图标、按钮后的空间。
- `chrome/browser/ui/views/tabs/tab/tab_close_button.cc`：关闭图标与命中空间分别处理；本项目当前按参考图使用 16 DIP 图标、26 DIP 命中区域。
- `chrome/browser/ui/views/tabs/tab/tab_title.cc`：标题尾部淡出，保留完整文本与提示。
- `chrome/browser/ui/views/frame/horizontal_tab_strip_region_view.cc`：新建按钮与内容中心线对齐，独立计算上下留白。

## 本项目映射

`src/shared/tab-layout.ts` 集中提供布局参数，Vue 外壳生成对应 CSS 变量，原生标题栏按钮高度也引用同一参数。

标签栏高 41 DIP，标签轮廓高 35 DIP。按用户最新参考图做视觉微调：内容底部留白 3 DIP，与加号共用距标签栏顶部约 22 DIP 的中心线；上圆角 9 DIP、下方外扩圆角 10 DIP，轮廓仍连接下方工具栏。标题采用 13px 系统字体、正常字重和偏中性的深浅前景色，图标与文字间距 8 DIP。普通标签前后留白 12／4 DIP，声音图标按参考图放在标题之前；新标签页使用窗口式图标，网页缺失站点图标仍使用地球。关闭图标 16 DIP，命中区域维持 26 DIP。

用户参考图中的加号是悬停状态：本项目保持用户指定的 32×32 DIP 圆角方形、8 DIP 圆角，正常状态透明，悬停才显示较弱的前景混色底。加号使用单独的图形比例，避免通用工具栏图标的画布留白使它显得过小。图标中心与标签内容对齐，按钮底部留白为 3 DIP。

当前 Chromium 检出版本的 `TabStripControlButton` 默认提供 28×28 DIP 按钮，并可按特性选择圆形或其它轮廓；本项目明确以用户参考图及其“保留圆角方形”的要求为准。此前确认的最小标签宽度 40 DIP、固定标签宽度 42 DIP、激活标签至少 112 DIP 继续保留，以满足大量标签下的压缩需求。

## 标题遮罩

`TabTitle.vue` 监听元素尺寸与标题变化，通过实际 `scrollWidth/clientWidth` 判断是否溢出。仅长标题添加尾部 16px 渐隐遮罩，短标题不施加遮罩，不插入省略号，也不截断原始字符串。

在压缩标签悬停并出现关闭按钮时，预留关闭区域，让渐隐在按钮之前结束。缩放窗口、切换固定状态、声音状态变化或网页更新标题后会重新判断，离开时释放观察器。

## 验证

`smoke-tab-layout.ts` 在真实外壳中测量标签与图标尺寸、垂直中心、短标题无遮罩、长标题渐隐、缩小窗口与标题变化；通过浏览器调试接口强制新建按钮的 hover 状态，保存真实界面截图。

`smoke-chrome.ts` 继续覆盖按钮对齐、首标签与总览连接、圆角、菜单定位、主题和压缩布局。结果位于 `test-results/tab-layout.json` 与 `test-results/chromium-tab-layout.png`。

加号前的独立分隔线遵循相邻标签状态：末尾标签激活或悬停、加号自身悬停时隐藏，普通状态恢复。专项检查覆盖这些状态，避免末尾分隔线遗漏在标签间分隔线规则之外。

创建／关闭动效将背景与内容的运动分开：背景保持底部基线，宽度平滑展开或收拢；内部图标和文字从下方进入、向下退出。动效期间允许左右外扩圆角绘制，并在标签外 14px 处限定绘制范围，防止收拢时内容远溢。关闭的原激活标签保留背景用于淡出，但即时撤销焦点和交互。
