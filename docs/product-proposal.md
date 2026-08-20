# scene-mock

基于 Scene（接口集合）的 Mock 接口代理管理方案

把 mock 数据从 whistle values 中剥离，用「接口池 + Scene」结构化管理，切换场景不丢数据。

## 目录

1. [背景、用户与痛点](#1-背景用户与痛点)
2. [解决思路](#2-解决思路)
3. [概念模型](#3-概念模型)
4. [产品形态与架构](#4-产品形态与架构)
5. [接口池与 Scene 的维护方式](#5-接口池与-scene-的维护方式)
6. [Mock 数据的 JSON 维护](#6-mock-数据的-json-维护)
7. [匹配、透传与激活](#7-匹配透传与激活)
8. [与 whistle 的集成](#8-与-whistle-的集成)
9. [Web 管理面板](#9-web-管理面板)
10. [典型工作流](#10-典型工作流)
11. [功能范围、优先级与价值](#11-功能范围优先级与价值)
12. [方案边界、风险与后续演进](#12-方案边界风险与后续演进)

---

## 1. 背景、用户与痛点

前端日常联调常借助 whistle 做代理并 mock 接口返回。随着接口数量增长、同一接口的返回场景变多，「在 whistle values 里维护所有变量」的模式暴露出两个核心痛点。

### 1.1 目标用户与使用场景

| 角色 | 说明 |
| --- | --- |
| **主用户 · 前端开发** | 本地联调、后端未就绪时独立开发、验证空列表 / 异常 / 慢接口。一天内会在多种返回之间反复切换。 |
| **次用户 · 测试 / QA** | 用预制 Scene 复现固定数据态（缺货、支付失败、空购物车），减少口头对数据、反复改 mock。 |
| **非目标** | 不替代 YApi / Apifox / Postman 做接口文档与全量测试；不做团队权限、云端托管、契约测试平台。 |

典型场景：

- **异常流联调**：同一套下单接口，在「正常」「库存不足」「支付超时」之间来回切，测完要能立刻回到正常数据。
- **部分真实、部分 mock**：只 mock 尚未就绪或需要造数的接口，其余走真实环境。
- **团队复用**：把「空数据联调」「下单异常流」提交到 git，新成员 clone 即可用，不必每人重写一份 values。

### 1.2 核心痛点

**痛点 ① · 接口多，values 维护繁琐**

所有接口的 mock 数据都堆在 whistle 的 values 变量里。接口一多，变量列表臃肿、命名混乱、查找困难；接口增删改没有结构化管理，全靠手动在规则和 values 之间来回切换，极易出错且难以沉淀。

**痛点 ② · 多返回值场景改数据易丢失**

同一个接口往往有多种返回场景（正常 / 空列表 / 异常 / 慢接口）。在 whistle 里改 mock 数据时，**新场景覆盖旧场景**——想回到上次的返回值得重新编辑，上一次的 mock 数据无声丢失。联调异常流时尤其痛苦：改完异常数据还得手动改回正常数据，频繁切换、容易忘切回。

---

## 2. 解决思路

两个痛点的根因相同：**whistle 既承担「请求转发」又承担「数据存储」，职责过载，且数据扁平堆叠、缺乏「场景」这一层抽象**。

> **核心理念：mock 数据与代理解耦**
>
> 把 mock 数据从 whistle 的 values 中完全剥离，由独立的 mock 服务统一管理；whistle 退回到单一职责——**只负责把请求转发到 mock 服务**。数据管理与请求代理各司其职。

基于此理念，建立两个基础对象来分别击破两个痛点：

| 对象 | 说明 |
| --- | --- |
| **接口池（API Pool）** | 全局接口注册表，集中管理所有接口定义（`method + URL 模式`，支持 `:param` 路径参数）。结构化、可检索，告别 values 里的扁平堆叠。→ 解决痛点① |
| **Scene（场景）** | 一组接口的集合 + 每个接口在该场景下的返回值。启动一个 Scene 即同时激活其下所有接口的代理。同一接口可在多个 Scene 中有不同返回值，互不覆盖。→ 解决痛点② |

---

## 3. 概念模型

### 3.1 两个基础对象

| 对象 | 职责 | 示例 | 解决 |
| --- | --- | --- | --- |
| **接口池** | 接口定义的全局注册表（method + URL 模式 + 描述） | `GET /api/users/:id` | 痛点① |
| **Scene** | 一组「接口 + 各自返回值」的组合，可命名、可启动 | 正常下单 / 下单异常流 / 空数据联调 | 痛点② |

明确不做第三层（如 Profile / 场景组合快照）：**Scene 本身就是可激活的接口集合**。需要并行覆盖多条业务线时，同时激活多个 Scene，而不是再套一层容器。

### 3.2 Scene 的组成单元

每个 Scene 由若干**接口条目**构成，一条 = `{ 接口引用, HTTP 语义, data 引用 }`：

- **接口引用**：指向接口池中的某个接口（同一接口可被多个 Scene 引用复用）
- **HTTP 语义**：该条目的 `status` / `delay` / `headers`，写在 Scene JSON 里
- **data 引用**：指向 `data/<api-id>/<variant>.json` 中的一份业务 body。同一接口可以有多份 variant（`list` / `empty` / `server-error`），不同 Scene 指向不同 variant 即互不覆盖；也可显式共用同一份

关键点：**同一接口在不同 Scene 里可以指向不同返回值，互不影响**。例如 `GET /api/orders` 在「正常下单」指向 `data/get-orders/list.json`，在「空数据联调」指向 `data/get-orders/empty.json`——切换 Scene 不删文件，上一次的 mock 数据完整保留。

### 3.3 运行时状态

对象之外，系统还维护一份运行时状态，决定「此刻哪些返回值真正对外生效」：

| 状态 | 说明 |
| --- | --- |
| **激活 Scene 集合** | 同一时刻可激活 0～N 个无接口重合的 Scene；持久化在 `config.json`，服务重启后恢复 |
| **生效路由表** | 由当前激活 Scene 的接口条目实时合成，供请求匹配使用 |
| **透传目标** | `proxyTarget`。未命中生效路由的请求转发到真实环境，实现混合联调 |

---

## 4. 产品形态与架构

scene-mock 是跑在开发者本机的轻量工具，不是云端平台。产品由四部分组成，其中 mock 服务是唯一运行时。

| 层级 | 说明 |
| --- | --- |
| ① 数据层 · `mocks/` | 纯 JSON 文件。接口池、Scene 定义、`data/` 返回值、激活状态全部落盘，可 git 管理、可手改、可 diff。 |
| ② 服务层 · mock 服务 | 零依赖（或极少依赖）Node 进程。负责请求匹配、返回 mock、未命中透传、文件热加载、管理 API。 |
| ③ 交互层 · Web 面板 | 主操作入口。管理接口池 / Scene / 返回值 / 激活与冲突。与手改 JSON 双通道，写同一套文件。 |
| ④ 接入层 · whistle | 只做前缀转发，不存任何 mock 数据。切换 Scene 不改规则、不重启 whistle。 |

### 4.1 请求路径

```
浏览器 / App
    │
    ▼
whistle                    # 一条前缀规则，例如 /api/ → http://127.0.0.1:3456
    │
    ▼
scene-mock :3456
    ├─ 命中激活 Scene 的接口  →  返回该 Scene 下的 JSON（status / delay / headers / body）
    └─ 未命中                 →  透传到 proxyTarget（真实环境）

管理面板 http://127.0.0.1:3456/ 与 mock 同端口
管理 API 挂在 /__admin/* ，与业务 path 隔离
```

### 4.2 端口与进程约定

- 默认监听 `127.0.0.1:3456`，仅本机可访问，不对外暴露。
- 管理面板与 mock 共用同一端口：页面在 `/`，管理 API 在 `/__admin/*`，业务接口按原 path 匹配。接口池禁止注册 `/__admin` 前缀。
- 启动方式：`npx scene-mock` 或 `node bin/scene-mock.js`，工作目录下读取 `mocks/`。
- 端口占用时直接报错退出，不静默改端口（避免 whistle 规则指向空服务）。

---

## 5. 接口池与 Scene 的维护方式

### 5.1 接口池

接口池是全局唯一的接口定义注册表。Scene 只引用接口 id，不复制 method / URL。改 URL 模式只需改一处，所有引用该接口的 Scene 自动跟上。

| 操作 | 说明 |
| --- | --- |
| **注册接口** | 填写 method、URL 模式、描述，生成稳定 `id`（可手改，全局唯一）。支持 `:param` 路径参数，如 `/api/users/:id` |
| **编辑接口** | 可改 method / URL / 描述；`id` 一旦被 Scene 引用，改 id 视为重命名，需同步改各 Scene 的引用与 `data/<api-id>/` 目录名 |
| **查看引用** | 列出引用该接口的全部 Scene，删除前可感知影响面 |
| **删除接口** | 从接口池移除；若仍被 Scene 引用，先告警并列出 Scene 清单，确认后一并清理引用和 `data/<api-id>/` 目录 |

接口 `id` 建议用稳定语义名（`get-orders`），不要用 URL 原文——URL 常变，id 一变 `data/` 目录和所有 Scene 引用都要跟着改。

### 5.2 Scene

Scene 是「接口 + 返回值」的组合容器，对它的增删改不污染接口池，也不影响其它 Scene。

| 操作 | 说明 |
| --- | --- |
| **新建 Scene** | 起名 + 归属业务流程（如「下单异常流」「空数据联调」），得到一个空容器。文件名即 Scene ID（`scenes/<id>.json`） |
| **添加接口条目** | 从接口池选一个接口 → 设定 HTTP 语义，并新建一份 data variant（或复制其它 Scene 的 variant 为新文件） |
| **设定/修改返回值** | 改本条目的 status / delay / headers，以及它所引用的 data 文件。默认不动其它 Scene；若该 variant 被多个 Scene 共享，保存时先 fork |
| **复用接口** | 同一接口可被加进任意多个 Scene；每个 Scene 默认指向独立 variant，也可显式共用同一份 |
| **编辑** | 增删条目、调返回值、改 Scene 名与描述 |
| **删除 Scene** | 只删这个 Scene JSON；接口池、其它 Scene、以及仍被引用的 data 文件都保留 |

---

## 6. Mock 数据的 JSON 维护

Scene 概念确定后，返回值以 JSON 文件方式维护在本地 `mocks/` 目录。核心设计原则：**一个 Scene = 一个 JSON 文件；一份业务 body = `data/` 下的一个 variant 文件；Scene 通过引用把两者组合起来**。同接口的多种返回作为独立 variant 并存，切换 Scene 不删文件、互不覆盖。

Web 面板与手改文件是同一数据源：面板写文件，文件变更由服务热加载。不引入独立数据库。

### 6.1 目录结构

整个 `mocks/` 目录由四类文件组成，各司其职：

```
mocks/
├── apis.json                        # 接口池：全局接口定义注册表
├── config.json                      # 全局配置：端口、proxyTarget、激活中的 Scene
├── scenes/                          # 每个 Scene 一个 JSON，不再套目录
│   ├── normal-order.json            # Scene A：正常下单
│   ├── empty-data.json              # Scene B：空数据联调
│   └── order-error.json             # Scene C：下单异常流
└── data/                            # 所有接口返回值（业务 body），按 api-id 分组
    ├── get-orders/
    │   ├── list.json                # 正常列表
    │   ├── empty.json               # 空列表
    │   └── server-error.json        # 500 对应的 body
    └── create-order/
        ├── success.json             # 创建成功
        └── validation-error.json    # 参数校验失败
```

> **文件即 Scene，variant 即返回值**
>
> **每个 Scene 对应 `scenes/<scene-id>.json`，文件名 = Scene ID**。Scene 只声明「用了哪些接口、HTTP 语义、指向哪份 data」，不内嵌业务 body。
>
> 业务 body 按接口聚合在 `data/<api-id>/<variant>.json`。同一个接口（如 `get-orders`）可以有多份 variant；三个 Scene 分别引用 `list` / `empty` / `server-error`——**切换 Scene 不删除任何文件**，上一次的 mock 数据完整保留。

### 6.2 四种文件类型

**`apis.json`** — 接口池 · 全局唯一。注册所有接口的 method + URL 模式 + 描述，供 Scene 引用。

```json
[
  {
    "id": "get-orders",
    "method": "GET",
    "url": "/api/orders",
    "desc": "订单列表"
  },
  {
    "id": "create-order",
    "method": "POST",
    "url": "/api/orders",
    "desc": "创建订单"
  }
]
```

**`config.json`** — 全局配置。端口、透传目标、当前激活的 Scene 列表。激活切换会回写此文件。

```json
{
  "port": 3456,
  "proxyTarget": "https://api.example.com",
  "activeScenes": ["normal-order"]
}
```

**`scenes/<scene-id>.json`** — Scene 定义 · 每个 Scene 一个文件。声明名称、描述、接口条目（HTTP 语义 + 对 data variant 的引用）。`data` 字段是 variant 名，解析为 `data/<api-id>/<variant>.json`。

```json
{
  "name": "正常下单",
  "desc": "正常下单流程的接口返回值组合",
  "apis": {
    "get-orders": {
      "status": 200,
      "delay": 0,
      "headers": {
        "Content-Type": "application/json"
      },
      "data": "list"
    },
    "create-order": {
      "status": 201,
      "delay": 0,
      "data": "success"
    }
  }
}
```

`empty-data.json` 只改引用，不复制 body：

```json
{
  "name": "空数据联调",
  "desc": "订单列表为空",
  "apis": {
    "get-orders": {
      "status": 200,
      "data": "empty"
    }
  }
}
```

**`data/<api-id>/<variant>.json`** — 返回值 body · 按接口聚合的业务 JSON。文件内容就是响应体本身，不含 status / delay / headers。

```json
{
  "code": 0,
  "data": []
}
```

### 6.3 接口条目与返回值

一份对外生效的 mock 响应由 **Scene 条目 + data 文件** 合成：

| 来源 | 字段 | 类型 | 必填 | 说明 |
| --- | --- | --- | --- | --- |
| Scene 条目 | `status` | number | 否 | HTTP 状态码，如 200 / 404 / 500，默认 200 |
| Scene 条目 | `delay` | number | 否 | 延迟毫秒数（模拟慢接口），默认 0 |
| Scene 条目 | `headers` | object | 否 | 响应头键值对。未设 `Content-Type` 时默认 `application/json` |
| Scene 条目 | `data` | string | 是 | variant 名，对应 `data/<api-id>/<variant>.json` |
| data 文件 | （文件内容） | any | 是 | 响应体，可为 JSON 对象 / 数组 / 字符串 / `null` |

这是最小完备的结构：**status + body 覆盖正常/异常场景，delay 覆盖慢接口场景，headers 覆盖自定义头**。HTTP 语义留在 Scene，业务 body 留在 `data/`，同一份 body 可以被不同 status / delay 的条目引用。

Scene 的 `apis` 里声明了某接口、但未设 `data`、或对应 variant 文件不存在时：该接口**不算生效路由**，管理面板标记「未设置返回值」；请求不会返回空 body 造成静默误导，而是走未命中逻辑（透传或 404）。

### 6.4 隔离与复用

`data/` 是返回值池，复用是能力，覆盖是风险。默认行为仍对齐「互不覆盖」：

1. **新建条目默认新建 variant**。名称可用语义名（`empty`）或 scene-id（`normal-order`）。不要默认指向已有文件。
2. **「复制其它 Scene 的返回值」= 复制文件**。生成新 variant，再写入本 Scene 的 `data` 字段。
3. **编辑已共享的 variant 时先 fork**。引用计数 > 1 时，保存先复制成新文件再改，避免改 A 把 B 一起改掉。面板展示「此数据被 N 个 Scene 引用」。
4. **显式共享才共用同一文件**（例如多个 Scene 都指向 `get-orders/empty`）。共享是选择，不是默认。

引用计数从所有 `scenes/*.json` 的 `apis.*.data` 汇总。删除 Scene 只删 Scene 文件；variant 不再被任何 Scene 引用时，面板提示清理，**不自动删除**（避免误删手改的备用数据）。

### 6.5 数据维护操作

| 操作 | 文件变化 | 说明 |
| --- | --- | --- |
| **新增接口** | 编辑 `apis.json`，追加一条接口定义 | 全局注册一次，所有 Scene 可引用 |
| **新建 Scene** | 新增 `scenes/<id>.json` | 文件名即 Scene ID，`apis` 为空对象 |
| **设定返回值** | 改 Scene 条目 + 新建/编辑 `data/<api-id>/<variant>.json` | HTTP 语义写 Scene，body 写 data 文件 |
| **修改返回值** | 编辑对应 data 文件；共享时先 fork | 保存即生效，mock 服务热加载，无需重启 |
| **复制其它 Scene** | 复制 data 文件为新 variant + 写入本 Scene 引用 | 默认隔离，不共享同一文件 |
| **切换 Scene** | 只改 `config.json` 的 `activeScenes` | 所有 Scene JSON 与 data 文件原样保留 |
| **删除接口** | 从 `apis.json` 移除 + 清理各 Scene 引用与 `data/<api-id>/` | mock 服务校验引用，提示哪些 Scene 受影响 |
| **删除 Scene** | 删除 `scenes/<id>.json`；若在激活列表中则一并移除 | 只删该 Scene；孤立 data 文件提示清理 |

### 6.6 热加载与坏文件

- 监听 `mocks/` 目录（含子目录）。文件保存后重新加载受影响的接口池 / Scene / data / 配置，目标在 200ms 内对新请求生效。
- 某 JSON 语法错误或字段非法：**保留该文件上一份合法内容继续服务**，并在管理面板顶部显示错误（文件路径 + 原因）。服务进程不退出。单个 data 文件损坏只影响引用它的接口，不影响其它 Scene。
- `apis.json` / `config.json` 整体损坏同理；若从未成功加载过，则启动失败并打印路径，避免带着空配置静默运行。某个 `scenes/*.json` 损坏只停用该 Scene，其它 Scene 继续服务。

**为什么这样设计能解决痛点**

- **不丢失**：同接口多场景 = `data/` 下多个独立 variant，切换不删文件，数据天然保留
- **不繁琐**：接口池集中注册，Scene 文件只做组合，返回值按接口聚合，结构清晰、可检索、可 git 管理
- **可复用**：空列表、校验失败等 body 可被多个 Scene 显式引用，不必复制粘贴；默认仍隔离
- **可共享**：所有数据是纯 JSON 文件，提交到 git 即团队共享，新成员 clone 即拥有全部 mock 场景
- **可 diff**：改 Scene 引用与改 body 分属不同文件，git diff 能分清「换了哪份数据」还是「改了数据内容」
- **热加载**：修改 Scene 或 data 文件保存即生效，mock 服务自动监听文件变化，无需重启

---

## 7. 匹配、透传与激活

### 7.1 请求匹配规则

只有「当前激活 Scene 中、且已设置返回值」的接口会进入生效路由表（条目含 `data` 且对应 variant 文件存在）。一次请求按以下规则匹配：

1. **method 精确相等**（大小写不敏感，`GET` = `get`）。
2. **path 匹配 URL 模式**。支持 `:param` 单段参数（`/api/users/:id` 匹配 `/api/users/42`，不匹配 `/api/users` 或 `/api/users/42/orders`）。
3. **忽略 query string**。`GET /api/orders?page=1` 与 `GET /api/orders` 视为同一接口。query 匹配不做一期能力，避免规则爆炸。
4. strip 掉转发带来的 host，只比 path。whistle 把 `https://api.example.com/api/orders` 转到本机后，按 `/api/orders` 匹配。

| 请求 | 接口模式 | 结果 |
| --- | --- | --- |
| `GET /api/users/1` | `GET /api/users/:id` | 命中 |
| `GET /api/users` | `GET /api/users/:id` | 不命中 |
| `GET /api/orders?page=1` | `GET /api/orders` | 命中（忽略 query） |
| `POST /api/orders` | `GET /api/orders` | 不命中 |

若两个**不同 api-id** 的 URL 模式都能匹配同一请求（例如 `/api/users/:id` 与 `/api/users/:userId`），按「静态段更多、模式更具体」者优先；仍并列则取接口池中先注册者，并在面板提示潜在歧义。这是匹配层问题，**不走 Scene 冲突弹窗**（冲突弹窗只处理「同一 api-id 被两个激活 Scene 同时引用」）。

### 7.2 未命中时的透传

未命中生效路由的请求：

- 已配置 `proxyTarget` → 把 method、path、query、body 及必要请求头转发到真实环境，把上游响应原样返回（混合联调）。
- 未配置 `proxyTarget` → 返回 `404`，body 说明「未 mock 且未配置透传」，避免浏览器看到空白当成功。
- 透传超时默认 30s，失败时返回 `502` 并带上游错误摘要，便于判断是 mock 没配还是真实环境挂了。

透传时不转发 hop-by-hop 头（`Host`、`Connection` 等），`Host` 改为 `proxyTarget` 的 host。

### 7.3 启动 Scene

启动一个 Scene = 把它加入激活集合，其下**已设置返回值**的接口进入生效路由表：whistle 把这些接口转到 mock 服务后返回各自设定值，**同时生效、无需逐个配置**。

- **未被任何激活 Scene 覆盖的接口** → 透传真实环境（「部分 mock + 部分真实」）
- **切换 Scene** = 换一整套接口代理组合，瞬时生效，上一套 Scene 的返回值不丢（Scene JSON 与 `data/` 文件全部保留）
- 激活集合写入 `config.json.activeScenes`，重启服务后自动恢复，免去每天重新勾选

### 7.4 多 Scene 同时激活与冲突

支持同一时刻激活多个 Scene，不同业务流程的接口可并行生效。例如同时激活「登录流程 Scene」与「商品列表 Scene」，两组接口的代理同时工作。

> **冲突处理规则（重点）**
>
> 同时激活多个 Scene 时，若**新激活的 Scene 与已激活的 Scene 存在接口重合**（同一 api-id 出现在两个激活 Scene 中），则触发告警，由用户决定启用哪个：
>
> - 系统列出冲突的接口清单（含各 Scene 下 status / 摘要），提示用户二选一
> - 用户选择保留新 Scene → **所有与之冲突的旧 Scene 关闭激活**（其接口代理失效）
> - 用户选择保留旧 Scene → **新 Scene 不进入激活集合**（不生效）
> - 无重合 → 新 Scene 直接追加激活，不影响已激活的 Scene
>
> 核心原则：**冲突接口互斥，按 Scene 整组二选一，不按接口拆开叠加**。避免同一接口被两个 Scene 同时定义返回值造成歧义，也避免「半个 Scene 生效」的碎片状态。被弃用的 Scene 只是关闭激活，本身和所引用的 data 文件仍然保存，下次可重新激活。

边界补充：

- 新 Scene 同时与多个已激活 Scene 冲突：弹窗列出全部冲突对；选「激活新 Scene」则关闭所有冲突的旧 Scene，**与新 Scene 无交集的已激活 Scene 保持不动**。
- 关闭某个已激活 Scene：直接从激活集合移除，不弹冲突窗。
- 文件被手改导致激活集合本身已冲突（例如两个人 merge 了 `config.json`）：服务启动或热加载时拒绝加载该激活集合，面板强制进入冲突解决，在解决前不对外提供歧义路由。
- 不做「按接口挑选保留」——那会让激活状态无法用 Scene 来理解，违背「启动 Scene = 整组生效」。

---

## 8. 与 whistle 的集成

whistle 不再存储任何 mock 数据，也**不随 Scene 切换改规则**。推荐只保留一条前缀转发，匹配与透传全部交给 scene-mock。

### 8.1 推荐规则（一条前缀）

管理面板提供「复制 whistle 规则」。默认按接口池里 URL 的公共前缀生成，常见是：

```
# scene-mock 生成 · 粘贴到 whistle 即可
# 匹配与透传由 mock 服务决定，切换 Scene 不必改这条规则
/api/    http://127.0.0.1:3456
```

若真实接口不在 `/api/` 下，按接口池中的 path 前缀生成（多个前缀则多行，仍然与激活 Scene 无关）。需要限定 host 时，用 whistle 的 pattern：

```
^https?://api\.example\.com/api/    http://127.0.0.1:3456
```

之后所有命中前缀的请求由 scene-mock 响应：**当前激活 Scene 下的接口返回各自设定值，其余透传到 proxyTarget**。改返回值保存即生效，无需重启 whistle。

### 8.2 为什么不用「按接口生成多条规则」

按接口池逐条生成 whistle 规则，看起来更精确，但会把「当前 mock 了哪些接口」绑回 whistle：切 Scene、加接口都要重新粘贴规则，重新引入维护成本。前缀转发把决策权留在 mock 服务，才能做到「切 Scene 瞬时生效、whistle 零操作」。

一期不自动改 whistle 配置（避免操作用户本机规则文件）。演进项「whistle 插件自动同步」再做免粘贴。

**职责重新划分**

| | 传统方式 | scene-mock 方式 |
| --- | --- | --- |
| **whistle** | 转发 + 存数据（values） | 仅前缀转发 |
| **mock 服务** | — | 匹配、返回、透传、Scene 生命周期 |
| **接口数据** | whistle 内扁平变量 | 接口池结构化注册，Scene JSON 引用 `data/` 中的返回值 |
| **切场景** | 改 values，旧数据被覆盖 | 改激活集合，文件全部保留 |

---

## 9. Web 管理面板

面板是主操作面，和手改 JSON 等价。目标：不打开编辑器也能完成日常联调（建 Scene、改返回值、激活、处理冲突）。

| 屏幕 | 说明 |
| --- | --- |
| **Scene 管理** | Scene 列表：名称、接口数、激活状态、最近修改。一键激活 / 关闭。顶部统计：Scene 总数、已激活、接口总数、当前冲突。入口：新建 Scene。 |
| **Scene 详情** | 元信息（名称 / 描述 / ID / 状态）+ 接口条目表（method、URL、status、delay、data variant / 文件路径）。可添加/移除接口、编辑返回值、复制 whistle 规则。 |
| **接口池** | 全局接口表：method、URL、描述、被引用 Scene 数。注册 / 编辑 / 删除。删除前展示引用清单。 |
| **响应编辑器** | 针对「某 Scene × 某接口」。可改 status、delay、Content-Type；JSON 编辑 body（格式化）。status / delay / headers 写回 Scene JSON，body 写回 `data/<api-id>/<variant>.json` 并热加载。若 variant 被多个 Scene 引用，保存时 fork。 |
| **冲突告警弹窗** | 激活时若接口重合：列出冲突接口及两侧返回摘要（status / body 预览）。两个主操作：「激活新 Scene（关闭冲突的旧 Scene）」「保持现状」。脚注：数据不丢失。 |
| **全局配置** | 端口（只读，改文件并重启才生效）、proxyTarget、当前激活列表。复制 whistle 规则。展示热加载错误（若有）。 |

交互原则：

- **激活是 Scene 列表上的开关**，不是藏在详情里的次要操作——这是最高频动作。
- 返回值编辑默认在面板完成；同时显示 Scene 文件路径与 data 文件路径，并展示 variant 引用计数，方便「偶尔手改、git diff」。
- 破坏性操作（删接口、删 Scene）二次确认，并写清影响范围；删 Scene 不自动删孤立 data 文件。

---

## 10. 典型工作流

```
启动服务 → 录入接口池 → 接入 whistle → 建 Scene → 启动激活 → 冲突则二选一
```

1. **启动服务**：本地拉起 scene-mock，打开管理面板
2. **录入接口池**：注册联调会用到的 method + URL
3. **接入 whistle**：粘贴一条前缀转发，配好 proxyTarget
4. **建 Scene**：按业务流程建多个 Scene 并设返回值
5. **启动激活**：打开 Scene 开关，接口代理同时生效
6. **冲突则二选一**：多 Scene 接口重合时整组切换

**对比传统方式**：异常流测试时，传统方式要逐个改 values、测完再逐个改回，极易遗漏；scene-mock 只需切到对应 Scene，测完切回，零数据丢失风险。

日常增量：新接口先注册进接口池，再按需加入相关 Scene；新异常态新建一个 Scene，从「正常」**复制**返回值（生成新 variant）再改差异字段即可。

---

## 11. 功能范围、优先级与价值

### 11.1 一期（P0）· 可完成日常联调

| 优先级 | 能力 | 验收要点 |
| --- | --- | --- |
| P0 | 接口池 CRUD | method + URL 模式 + 描述；id 唯一；删除前展示引用 |
| P0 | Scene CRUD 与接口条目 | 建/改/删 Scene；从接口池添加/移除；复制其它 Scene 的返回值为新 variant |
| P0 | 返回值编辑 | 面板与 JSON 双通道；status / delay / headers 写 Scene，body 写 `data/`；共享 variant 编辑时 fork |
| P0 | 激活 / 关闭 Scene | 多 Scene 并行；状态写入 config.json，重启恢复 |
| P0 | 冲突检测与二选一 | 按 api-id 重合告警；整组关闭，不按接口拆分 |
| P0 | 请求匹配 | method + path，`:param`，忽略 query |
| P0 | 未命中透传 | proxyTarget 转发；未配置则明确 404 |
| P0 | 热加载 | 保存即生效；坏 JSON 不拖垮进程，面板报错 |
| P0 | 生成 whistle 前缀规则 | 一键复制；切 Scene 不必改规则 |
| P0 | Web 管理面板六屏 | Scene 列表/详情、接口池、响应编辑器、冲突弹窗、配置 |

### 11.2 二期及以后

| 优先级 | 能力 | 说明 |
| --- | --- | --- |
| P1 | 请求命中日志 | 最近 N 条：是否 mock、命中哪个 Scene / api-id，解决「到底有没有走到 mock」 |
| P1 | OpenAPI / Swagger 导入 | 从接口文档批量生成 apis.json |
| P1 | X-Mock-Scene 请求头 | 单次请求指定 Scene，不改全局激活，便于自动化脚本 |
| P1 | CLI | `start` / `activate` / `list`，方便不打开面板时切换 |
| P1 | whistle 插件同步规则 | 免手动粘贴 |
| P2 | Scene 继承 | Scene D 引用 Scene A 再覆盖其中若干接口 |
| P2 | mock 模板语法 | `{{$random.name}}`、`{{$request.params.id}}` 等动态生成 |
| P2 | 冲突智能建议 | 告警时给出「保留哪个 Scene」的推荐依据 |
| 不做 | 云端协同 / RBAC / 多用户 | 保持本机工具；协同走 git |

### 11.3 非功能要求

- **启动快**：无重依赖，秒级拉起；默认只绑 127.0.0.1。
- **稳**：单个 data 文件损坏不影响其它接口；某个 Scene JSON 损坏只停用该 Scene；服务不因热加载失败而退出。
- **可预期**：端口被占、JSON 非法、激活集合自相冲突——全部显式报错，不静默降级到错误端口或空路由。
- **数据即文件**：不引入数据库；git 是唯一共享机制。

### 11.4 价值对比

| 维度 | 传统 whistle values | scene-mock |
| --- | --- | --- |
| 数据丢失风险 | 高（场景覆盖） | 消除：同接口多 variant 独立保存在 `data/`，Scene 只引用 |
| 接口切换成本 | 高（逐个改 values） | 零成本：启动 Scene 批量激活 |
| 冲突可感知 | 无（静默覆盖） | 告警：重合接口整组二选一 |
| 接口可维护性 | 低（扁平堆叠） | 结构化：接口池注册 + Scene 组织 |
| 数据可追溯 | 无（whistle 内不可 git） | 可 diff：纯 JSON 文件，git 精准追踪 |
| 团队可共享 | 不支持 | 支持：mock 目录提交 git，clone 即用 |
| 混合联调 | 不支持 | 支持：未覆盖接口透传真实环境 |
| 与现有工具兼容 | — | 无缝：whistle 只加一条前缀转发 |

### 11.5 成功标准（一期）

- 从「正常下单」切到「下单异常流」并看到对应返回，**不超过一次点击 / 一次开关**，且正常 Scene 的 JSON 与所引用的 data 文件原样保留。
- 新成员 clone 仓库、启动服务、粘贴一条 whistle 规则后，**5 分钟内**能跑通已有 Scene。
- 同时激活两个无交集 Scene 时两组接口都生效；有交集时必须经过确认，不会静默覆盖。

---

## 12. 方案边界、风险与后续演进

### 当前边界

- 面向**前端联调阶段的 mock 接口代理**，非全量接口测试平台，非接口文档系统。
- mock 返回值以纯 JSON 文件维护在本地 `mocks/`：Scene 定义在 `scenes/`，业务 body 在 `data/`，支持手动编辑 + Web 面板管理双通道。
- 需本地启动一个轻量 mock 服务；依赖开发者本机已有 whistle（或同类代理）。
- 一期不覆盖：WebSocket、按 query / header 分支、HTTPS 终结、动态模板、云端托管。

### 已知风险与对策

- **前缀转发过宽**：`/api/` 会把所有 API 打到 mock。未 mock 的依赖 `proxyTarget` 正确；配错会表现为「全站都像挂了」。对策：配置页强提示；透传失败返回 502 而非空白。
- **接口 id 与文件名耦合**：重命名会牵动 `data/<api-id>/` 目录及所有 Scene 引用。对策：面板把改 id 做成显式「重命名」并级联改文件与引用；文档建议用稳定语义 id。
- **共享 variant 误改覆盖**：多个 Scene 指向同一 data 文件时，手改会同时影响它们。对策：面板展示引用计数；从面板编辑时默认 fork；文档约定手改共享文件前先确认引用。
- **激活状态进 git 可能互相覆盖**：`activeScenes` 是个人联调状态。对策：建议 `config.json` 中激活列表不提交，或提供 `config.local.json` 覆盖（P1）；一期在文档中约定「各人本地改、不要把个人激活状态推进主干」。
- **与真实环境 cookie / 鉴权**：透传需要带上原请求头。对策：默认转发 `Cookie` / `Authorization`；不在 mock 层做登录态模拟（可用独立「登录 Scene」返回固定 token）。

### 演进方向

- **OpenAPI / Swagger 批量导入**：从接口文档一键生成 apis.json 接口池
- **whistle 规则自动同步**：通过插件接口免手动粘贴规则
- **Scene 继承/复用**：Scene D 可引用 Scene A 的全部条目再覆盖其中若干
- **mock 模板语法**：返回值 body 支持 `{{$random.name}}`、`{{$request.params.id}}` 等动态生成
- **冲突智能建议**：告警时给出「保留哪个 Scene」的推荐依据
- **命中日志与 X-Mock-Scene**：可观测、可被脚本按次覆盖，而不破坏「Scene 整组激活」模型

---

scene-mock · 让 mock 接口可分组、可激活、不丢失
