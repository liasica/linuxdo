# Linux.do 自动浏览助手 v2 2026

基于 Chrome MCP 研究分析的 Linux.do 论坛自动化浏览工具。

## v2.0 新特性

- **无限滚动支持** - 自动滚动加载更多内容
- **浏览记录管理** - 已浏览帖子标记，避免重复
- **完整回复浏览** - 滚动到底部浏览所有回复
- **自动循环** - 浏览完成后自动返回列表继续下一个
- **视觉标记** - 已浏览话题显示绿色勾号

## 项目结构

```
linuxdo/
├── README.md                              # 项目说明
├── docs/
│   ├── linux.do-analysis.md              # 网站结构分析报告
│   ├── implementation-plan.md            # 实现方案详细文档
│   └── usage-guide.md                    # 使用指南
└── src/
    ├── linuxdo-automation.user.js        # 油猴脚本 (主要功能)
    ├── hooks/                            # 调试Hook脚本
    │   ├── xhr-hook.js                   # XHR请求监控
    │   ├── fetch-hook.js                 # Fetch请求监控
    │   ├── cookie-hook.js                # Cookie读写监控
    │   ├── debugger-bypass.js            # 反调试绕过
    │   └── dom-observer.js               # DOM变化监控
    └── utils/                            # 工具脚本
        ├── discourse-api.js              # Discourse API封装
        └── page-analyzer.js              # 页面分析工具
```

## 功能特性

- **自动浏览话题列表** - 支持 /latest, /new, /unread, /top, /hot 等页面
- **无限滚动加载** - 自动滚动加载更多话题和回复
- **智能去重** - 已浏览帖子标记存储，避免重复浏览
- **完整回复浏览** - 帖子详情页滚动浏览所有回复直到底部
- **自动循环** - 浏览完成后自动返回列表继续下一个未浏览话题
- **随机点赞** - 按概率随机点赞，带间隔控制
- **可视化控制面板** - 实时显示状态和统计数据
- **视觉标记** - 已浏览话题显示绿色勾号，透明度降低
- **配置灵活** - 所有参数可调整

## 快速开始

1. 安装 [Tampermonkey](https://www.tampermonkey.net/) 浏览器扩展
2. 创建新脚本，复制 `src/linuxdo-automation.user.js` 内容
3. 保存并启用脚本
4. 访问 https://linux.do 并登录
5. 页面右上角会出现紫色控制面板
6. 点击"开始自动浏览"

### 工作流程

```
启动 → 判断页面类型
         ↓
    ┌────┴────┐
    ↓         ↓
 话题列表    帖子详情
    ↓         ↓
 滚动加载   标记已浏览
 找未浏览   滚动看回复
 点击进入   随机点赞
    ↓         ↓
    └────┬────┘
         ↓
      循环继续
```

## 技术说明

### 网站分析

- **论坛系统**: Discourse (开源论坛软件)
- **认证方式**: Cookie + CSRF Token
- **API风格**: RESTful JSON API
- **实时通信**: Message Bus 长轮询

### 关键发现

| 功能 | 实现方式 |
|------|---------|
| 点赞 | 点击 `button[title="点赞此帖子"]` |
| 帖子识别 | `article[id^="post_"]` |
| CSRF Token | `meta[name="csrf-token"]` |
| 登录检测 | `#current-user` 元素存在 |

## 文档索引

- [网站分析报告](docs/linux.do-analysis.md) - 详细的页面结构和API分析
- [实现方案](docs/implementation-plan.md) - 代码架构和实现细节
- [使用指南](docs/usage-guide.md) - 安装配置和使用说明

## 注意事项

1. 仅供学习研究使用
2. 请遵守网站使用条款
3. 建议使用保守配置避免触发限制
4. 不得用于商业或恶意目的

## 调试工具使用

项目包含多个调试工具，可在浏览器控制台中使用：

### Hook脚本

```javascript
// 1. XHR监控 - 监控所有XMLHttpRequest请求
// 复制 src/hooks/xhr-hook.js 内容到控制台执行
getXhrLog()      // 查看请求日志
clearXhrLog()    // 清除日志

// 2. Fetch监控 - 监控所有Fetch API请求
// 复制 src/hooks/fetch-hook.js 内容到控制台执行
getFetchLog()    // 查看请求日志
clearFetchLog()  // 清除日志

// 3. Cookie监控 - 监控Cookie读写
// 复制 src/hooks/cookie-hook.js 内容到控制台执行
getCookieLog()   // 查看Cookie操作日志
parseCookies()   // 解析当前所有Cookie

// 4. DOM监控 - 监控页面DOM变化
// 复制 src/hooks/dom-observer.js 内容到控制台执行
startDomObserver('#topic')  // 开始观察指定元素
stopDomObserver()           // 停止观察
getDomLog()                 // 查看变化日志
```

### 工具脚本

```javascript
// 1. Discourse API工具
// 复制 src/utils/discourse-api.js 内容到控制台执行
await discourseAPI.getLatestTopics()     // 获取最新话题
await discourseAPI.getTopic(123456)      // 获取话题详情
await discourseAPI.likePost(789)         // 点赞帖子
await discourseAPI.getCurrentUser()      // 获取当前用户信息
await discourseAPI.search('关键词')       // 搜索

// 2. 页面分析工具
// 复制 src/utils/page-analyzer.js 内容到控制台执行
pageAnalyzer.printReport()       // 打印完整分析报告
pageAnalyzer.getPageInfo()       // 获取页面基本信息
pageAnalyzer.analyzeTopicPage()  // 分析帖子页面
pageAnalyzer.findLikeButtons()   // 查找所有点赞按钮
pageAnalyzer.getScrollInfo()     // 获取滚动状态
```

## 开发说明

### 技术栈

- **目标平台**: Discourse 论坛系统
- **实现方式**: Tampermonkey 用户脚本
- **API风格**: RESTful JSON
- **认证方式**: Cookie + CSRF Token

### 关键选择器

| 元素 | 选择器 |
|------|--------|
| 点赞按钮 | `button[title="点赞此帖子"]` |
| 帖子容器 | `article[id^="post_"]` |
| 话题链接 | `a[href*="/t/topic/"]` |
| 话题行 | `.topic-list-item, tr[data-topic-id]` |
| CSRF Token | `meta[name="csrf-token"]` |
| 登录状态 | `#current-user` |

### 数据存储

脚本使用 localStorage 存储以下数据：

| Key | 说明 |
|-----|------|
| `linuxdo_viewed_topics` | 已浏览话题ID列表 (JSON数组) |
| `linuxdo_liked_posts` | 已点赞帖子ID列表 (JSON数组) |
| `linuxdo_auto_running` | 自动运行状态 (用于页面跳转后恢复) |

### 扩展开发

如需添加新功能，可参考以下步骤：

1. 使用 Hook 脚本分析目标功能的网络请求
2. 使用页面分析工具定位 DOM 元素
3. 参考 `discourse-api.js` 封装新的 API 调用
4. 在主脚本中添加新功能模块

## 已知限制

1. 网站可能更新页面结构，导致选择器失效
2. 频繁操作可能触发速率限制 (429 错误)
3. 长时间运行可能被检测为异常行为
4. 部分功能需要特定用户等级权限

## 更新日志

### v2.0.0 (2026-01-30)
- **重构** - 完全重写滚动和浏览逻辑
- **新增** - 无限滚动支持，自动加载更多内容
- **新增** - 浏览记录管理，避免重复浏览
- **新增** - 完整回复浏览，滚动到底部加载所有回复
- **新增** - 自动返回列表继续下一个话题
- **新增** - 视觉标记（已浏览话题显示绿色勾号）
- **新增** - 清除浏览记录功能
- **优化** - 更智能的内容加载检测
- **优化** - 控制面板显示更多统计信息

### v1.0.0 (2026-01-30)
- 初始版本
- 实现自动浏览话题列表
- 实现帖子页面自动滚动
- 实现随机点赞功能
- 添加可视化控制面板
- 添加调试工具集

## License

MIT License - 仅供学习研究
