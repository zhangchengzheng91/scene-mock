# 代理与 scene-mock 流量链路总结

> 整理自 2026-10-14 的讨论：从「系统代理 vs dev server 拦截」的原理差异，到 Whistle 拦截 localhost 的实操，再到结合本项目（whistle.scene-mock 插件）源码的完整流量链路。

## 一、两种代理方式的区别

### 1. 系统代理（OS 层转发）

- 链路：`浏览器 → OS 代理设置 → 代理工具（Whistle/Charles）→ 目标服务器`
- 浏览器发出的**所有请求**先经操作系统配置的代理转发到代理工具，由其按规则决定转发、Mock 或替换。
- **全局生效**：任何走系统代理的进程（浏览器、curl、其他 App）都被接管。
- 可拦截**任意域名**（含线上 HTTPS），但 HTTPS 解密需**安装并信任代理工具根证书**。
- 适用：域名级劫持、抓包分析、Mock 线上接口。

### 2. 拦截 webpack dev server（应用层转发）

- 链路：`浏览器 → localhost dev server → devServer.proxy 按路径转发 → 后端`
- 通过 `devServer.proxy`（底层 http-proxy-middleware）只转发匹配路径（如 `/api/**`），其余返回本地打包资源。
- **作用域小**：只影响经过该 dev server 的请求，不碰系统其他流量。
- **无需证书**（Node 端直连目标，绕开浏览器证书校验），页面与接口同源，**天然解决跨域**。
- 适用：日常开发联调后端接口。

两者可叠加：浏览器走系统代理把域名指到本地，dev server 再把 `/api` 转发到真实后端。

## 二、为什么 dev server 流量默认不经过系统代理

不是"不会"，而是"默认不会"，两个独立机制叠加：

1. **浏览器 → dev server 段**：系统代理配置里有 bypass 白名单，macOS 默认包含 `127.0.0.1`、`localhost`、`*.local`，浏览器遵循该列表直连本地。这是**可配置的默认行为**——移除白名单后 localhost 一样会被代理截获（这也是开着 Charles 时本地 HMR 断连的原因：websocket 被拦走了）。
2. **dev server → 后端段**：`devServer.proxy` 的转发发生在 **Node.js 进程内部**，Node 的网络栈**完全不感知系统代理设置**（连 `HTTP_PROXY` 环境变量都不会自动遵守），除非显式传入 HTTP agent。这是架构使然，恒不经过。

## 三、Whistle 拦截 localhost 流量的方法

核心思路：绕开「localhost 默认 bypass」。

### 方法一（推荐）：换域名访问

1. Whistle Rules 加 hosts 规则：`local.test.com 127.0.0.1:8080`（端口换成 dev server 实际端口）。
2. 浏览器访问 `http://local.test.com`——非 localhost，bypass 不生效，请求正常进入 Whistle 再转回本地。
3. webpack 报 **Invalid Host header** 时配置 `devServer: { allowedHosts: 'all' }`。
4. 附带好处：可同时挂 mock 规则、随时开关，不动系统配置。

### 方法二：清空 bypass 白名单

- **SwitchyOmega / ZeroOmega**：把"不代理的地址列表"里默认的 `127.0.0.1 [::1] localhost` 删掉。
- **命令行启动独立 Chrome 实例**：
  ```bash
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    --proxy-server=127.0.0.1:8899 --proxy-bypass-list="" \
    --user-data-dir=/tmp/chrome-whistle
  ```
- **改系统代理**：macOS 系统设置 → 网络 → 代理，移除 bypass 列表中的 `127.0.0.1`、`localhost`。

注意：本地服务是 HTTPS 时需先安装并信任 Whistle 根证书；方式二可能导致 Whistle 管理页（localhost:8899）也经过代理，异常时改用局域网 IP 访问管理页。

## 四、换域名后静态资源与接口的转发分工

链路变为「浏览器 → Whistle → 本地 dev server →（可选）后端」，两种分工二选一：

### 方式 A：Whistle 只映射域名，接口由 devServer.proxy 转发

```
# Whistle Rules
local.test.com 127.0.0.1:8080
```

```js
// webpack.config.js
devServer: {
  allowedHosts: 'all',   // 允许非 localhost 的 Host 头
  proxy: {
    '/api': { target: 'https://test-api.example.com', changeOrigin: true },
  },
}
```

改动最小，但切换后端环境要改配置并重启。

### 方式 B：Whistle 统一接管（路径规则优先于纯域名规则）

```
# 接口直转后端，不经 dev server
local.test.com/api https://test-api.example.com
# 其余走本地 dev server
local.test.com 127.0.0.1:8080
```

切换环境、Mock 接口只改 Whistle 规则、即时生效，可删 `devServer.proxy`。

**必踩的坑**：
- `allowedHosts: 'all'` 必加；
- HMR 断连时显式指定 `client: { webSocketURL: 'ws://local.test.com/ws' }`；
- 页面与接口同为 `local.test.com`，跨域与 cookie SameSite 问题基本消失；
- **不要两边重复转发**同一批接口（Whistle 转走后请求到不了 dev server，proxy 规则"改了没反应"）；
- 方式 B 中后端 `Set-Cookie` 带 `Domain=` 会被浏览器拒收，需 `resHeaders://` 改写。

## 五、mock 优先、未命中兜底的规则写法

Whistle 精确路径规则优先命中，未命中落到域名兜底：

```
# Mock 层（精确路径，优先命中）
local.test.com/api/user resBody://{user-mock}
local.test.com/api/order/list resBody://{order-list-mock}

# 兜底层：其余全部走本地 dev server
local.test.com 127.0.0.1:8080
```

配套技巧：
- mock 数据放 **Values 面板**（`{user-mock}` 引用），或用文件路径 `resBody:///abs/path/user.json`，改数据不动规则；
- Rules 面板**取消勾选**即可临时放通某条 mock 到真实后端；多规则文件可按场景切换启用；
- 模拟异常：`statusCode://500`、`resDelay://3000`；
- 条件 mock（如按参数决定走 mock 还是透传）用 `reqScript://{mock-router}`，脚本里命中则设置响应，不命中则不干预、继续走兜底。

## 六、本项目（whistle.scene-mock）的实际流量链路

与通用模式的差异：本项目是 Whistle 插件，不是"换域名 + dev server"结构，核心是 **Whistle 规则分流 + 插件内部三级决策**。

### 第一层：请求进入 Whistle，规则引擎分流

```
浏览器（经系统代理，host 保持真实上游）
  → Whistle 规则引擎（读 rules.txt）
  → 命中 scene-mock 规则？─ 是 → 进入插件（pattern scene-mock://）
                            └ 否 → 不走插件：正常转发 / 其他规则
```

- 规则由插件写入：`matchPatterns`（默认 `/api/`）与 `config.hosts` 各生成一条，如 `/api/ scene-mock://`（src/rules.ts）。
- 特例：`localhost:Whistle端口` 的请求默认进管理页、规则不执行；路径加 `/_/` 或 `/-/` 前缀可强制走规则。

### 第二层：插件内部决策（src/server.ts → handleHttp）

```
进入 handleHttp（server.on('request')）
  ├ WS / CONNECT?            ─ 是 → passThrough（upgrade/connect 透传）
  ├ ready 且无冲突?           ─ 否 → passThrough（未 ready / pendingConflict）
  ├ 解析 method + 候选 pathname（inferHttpMethod / candidatePathnames）
  ├ 激活路由命中?             ─ 命中 → 返回 mock（delay + x-scene-mock 响应头）
  └ 未命中：
      ├ unmatched=404 且无 proxyTarget? ─ 是 → 404 JSON（error: not_mocked）
      ├ proxyTarget 非空?               ─ 是 → 转发 proxyTarget（改 host，30s 超时 → 502 proxy_failed）
      └ 否则 → passThrough（回原始 URL，带插件标记防循环）
```

源码要点：
- **路由匹配**（`store.routes.match`）：只看 `activeScenes`，要求该条已启用、variant 文件存在、method 相同、路径整段匹配（`:param` 只匹配一段）；多候选时**静态段多者优先**，相同则取 `apis.json` 中更靠前的。
- **method 推断**（`inferHttpMethod`）：Whistle 报 GET 但 body 是 JSON/表单时按 POST 匹配。
- **命中 mock**：先 drain 请求体 → 按 `response.delay` 延迟 → 返回，响应头带 `x-scene-mock: sceneId/apiId/variant`（便于确认命中来源）。
- **proxyTarget 转发**：`req.request` 交回 Whistle，URL 为 `proxyTarget.origin + pathname + query`，剥除 hop-by-hop 头、改写 host，30 秒超时返回 502 `proxy_failed`。
- **数据目录**：`mocks/` 下 `apis.json`（接口池）、`config.json`（proxyTarget / unmatched / hosts / activeScenes / matchPatterns）、`scenes/<id>.json`、`data/<api-id>/<variant>.json`，保存后热加载。

## 七、关键配置速查

| 场景 | 配置 |
| --- | --- |
| Whistle 拦 localhost | 换域名映射 `local.test.com 127.0.0.1:8080`，或清 bypass 白名单 |
| Invalid Host header | `devServer.allowedHosts: 'all'` |
| 后端校验 Host/Origin | `devServer.proxy` 里 `changeOrigin: true` |
| HMR 经代理断连 | `devServer.client.webSocketURL: 'ws://<域名>/ws'` |
| mock 优先兜底 | 精确路径 mock 规则在前，域名兜底规则在后 |
| HTTPS 抓包 | 安装并信任 Whistle 根证书 |
| 强制本地地址走规则 | 路径加 `/_/` 或 `/-/` 前缀 |
| 确认 mock 命中来源 | 看响应头 `x-scene-mock: sceneId/apiId/variant` |
| 未 mock 接口行为 | `config.json`：`unmatched: "passthrough" | "404"` + `proxyTarget` |
