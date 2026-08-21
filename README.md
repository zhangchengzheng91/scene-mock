# whistle.scene-mock

把 mock 数据从 Whistle Values 里拆出来，用「接口池 + Scene」管理。切换场景只改激活集合，不丢 JSON、不改用户 Rules。

## 能做什么

- 接口池集中注册 `method + URL`（支持 `:param`）
- Scene 组合接口与返回值；同一接口多份 variant，互不覆盖
- 多 Scene 并行激活；接口重合时整组二选一
- 命中 mock 直接返回；未命中默认回源，或打到 `proxyTarget`
- 管理面板写同一套 `mocks/` 文件，保存后热加载

## 开发环境（热更新）

先打开 **Whistle.app**，再开两个终端，都在项目根目录：

```sh
npm i

# 终端 1：编译 watch（改 src / web 后写出 dist）
npm run dev

# 终端 2：挂到 Whistle，编译产物变化后自动重载插件
npm run watch
```

`npm run watch` 即 `lack watch web/dist`。插件会出现在 Plugins 列表（名为 `scene-mock`），`console.log` 会打到终端 2。

改完后点插件顶栏「刷新」加载新 UI（`mocks/` 仍通过 SSE 热更新，无需整页刷新）。

```sh
npm test
npm run build
```

## 使用

1. 在 Whistle Plugins 打开 **scene-mock**
2. 配置页绑定工作区：填业务仓库根目录，或本仓库的 `fixtures` / `fixtures/mocks`
3. 若还没有 `mocks/`，点「初始化骨架」
4. 插件会按 `matchPatterns`（默认 `/api/`）写入 `rules.txt`：`/api/ scene-mock://`
5. 录入接口池 → 建 Scene → 打开激活开关
6. 业务 https 请求需在 Whistle 开启 HTTPS 抓包

示例数据在 `fixtures/mocks/`（正常下单 / 空数据联调 / 下单异常流）。

## 数据目录

```
mocks/
├── apis.json
├── config.json          # proxyTarget / activeScenes / matchPatterns
├── scenes/<scene-id>.json
└── data/<api-id>/<variant>.json
```

建议不要把个人的 `activeScenes` 提交进主干。
