# 交接文档：herdr-app 分支的 pi-herdr-agents fork

写给下一个接手的人（或 agent）。读完这份文档你应该能直接开工，不用重新摸一遍环境。

最后更新：2026-11-02

---

## 1. 这个 fork 为什么存在

`pi-herdr-agents` 这个 Pi 扩展负责把子 agent 派发到独立终端里跑。它原本**硬绑 herdr TUI**：所有子 agent pane 都通过 `herdr` 命令行创建，pane 布局、worktree、状态标记全部依赖 herdr 的 workspace/tab/pane 模型。

用户的主要诉求有两条：

1. **界面定制**。用户已经在用 [herdr-app](https://github.com/herdrdev/herdr-app)，希望子 agent 的 pane 能显示在 app 里，并自己做可视化。
2. **只加一个开关**。fork 的改动要小：**一处判断**决定用哪个运行时（原版 herdr TUI，还是 herdr-app 用的 herdr-core），而不是把两套实现散落到整个代码库里。

本次改动就落在这条线上：加了一个「一次判断、全进程复用」的运行时选择点，以及一个 herdr-core（`hc`）的 `SurfaceProvider` 骨架。

---

## 2. 三个仓库的关系

| 仓库 | 位置 | 作用 |
|---|---|---|
| `herdrdev/herdr` | 上游，未 clone | herdr **TUI**（`herdr` 命令）。当前装在 `/home/zhannan/.local/bin/herdr`，版本 0.9.5 |
| `herdrdev/herdr-core` | `/tmp/hc-src`（临时参考副本） | **herdr-core**（`hc` 命令）。herdr-app 的运行后端：终端运行时 + 机器编排。**本机尚未安装** |
| `herdrdev/herdr-app` | 上游，未 clone | 跨平台终端 app（Rust + GPUI），通过 herdr-core 显示终端 |
| `giuseppecrj/pi-herdr-agents` | 本项目 | Pi 扩展。我们 fork 的就是它，当前版本 `3.7.2` |

### herdr-app 的硬限制（决定了架构）

`herdr-app/defaults/AGENTS.md:35` 写明：**不支持 HTML/CSS/webview/Node API/setTimeout**。所有 UI 只能用 `gpui-kit` 的 JS 描述符来写（`mod` 文件里定义 GPUI 元素），且默认在全局 JS 作用域、无沙箱。所以「定制可视化」是写 GPUI 组件，不是写网页。

这条限制意味着：**app 侧不能跑 Pi 扩展**。Pi 扩展只能跑在 WSL 里，通过 `hc` CLI 和 app 通信。所以 fork 必须落在 `pi-herdr-agents` 这一侧，而不是写 app 插件。

---

## 3. 目录约定（重要，别搞错）

```
~/dev/pi-herdr-agents            ← 开发副本（WSL ext4 磁盘）。所有构建、测试、git 操作在这里
/mnt/a/workspaces/pi-herdr-agents ← Windows A: 盘副本。给人看、给 Windows 侧工具用
```

**为什么不能直接在 A 盘开发**——实测数据：

| 操作 | `/mnt/a`（9p 磁盘） | `~/dev`（ext4） | 倍数 |
|---|---|---|---|
| 全量测试 `npm test` | **8 分 16 秒** | **33 秒** | ~15× |
| 写 64MB | 0.464s | 0.057s | 8× |
| `npm ci`（140 包） | 3 分 37 秒 | — | — |

`/mnt/a` 通过 9p 协议访问，每个文件操作都有额外一次往返。源码量一大，TypeScript 的类型解析和 node 的模块加载就会被这个延迟吃掉。

**同步方式**：在 `~/dev/pi-herdr-agents` 改完，用 rsync 推源码到 A 盘（不含 `node_modules`、`.git` 由 A 盘自己的仓库管理）：

```bash
rsync -a --delete \
  --exclude node_modules --exclude .git \
  ~/dev/pi-herdr-agents/ /mnt/a/workspaces/pi-herdr-agents/
```

---

## 4. 环境事实（2026-11-02 实测）

| 项 | 值 |
|---|---|
| 系统 | WSL2，Linux x86_64，Node v26.8.1 |
| 当前运行时 | **herdr TUI**：`HERDR_ENV=1`、`TERM_PROGRAM=herdr`、`HERDR_PANE_ID=w7:p5D` |
| herdr socket | `/home/zhannan/.config/herdr/herdr.sock`（由 `HERDR_SOCKET_PATH` 指定） |
| `hc` | **未安装**，`~/.config/herdr-core` 不存在 |
| GPU | **无 Vulkan ICD**（`/usr/share/vulkan/icd.d` 不存在）→ herdr-app 的 GPUI 后端在此环境跑不起来 |
| WSLg | 1.0.71，`/tmp/.X11-unix/X0` 与 `wayland-0` 都在 |
| `LANG` | `zh_CN.UTF-8`（会影响下面第 5 节的一个测试） |

---

## 5. 两个基线失败（动手前先知道，都不是代码 bug）

全量测试 `npm test` 在**未改动的上游代码**上就有 2 个失败：

### 5.1 `test/package-manifest.test.js` — npm 版本不兼容

```
TypeError: Cannot read properties of undefined (reading 'files')
    at test/package-manifest.test.js:58
```

原因：`npm pack --dry-run --json` 在 npm 11（Node 26 自带）里输出**以包名为 key 的对象**，而测试第 58 行按数组取 `[0].files`。旧版 npm 输出数组。

这是测试代码过时，不是项目坏了。修法二选一：兼容两种形状，或升级测试最低 npm 版本要求。

### 5.2 git 输出本地化 — 受 `LANG` 影响

```
致命错误：不是 Git 仓库
```

测试断言 git 的英文错误信息（`"not a git repository"`），但 `LANG=zh_CN.UTF-8` 让它输出中文。

绕开办法：**跑测试时固定 `LANG=C`**。

```bash
LANG=C LC_ALL=C npm test
```

已验证：加上 `LANG=C` 后，这个失败消失，全量 1426 pass / 1 fail（只剩上面的 npm 问题）。

---

## 6. 本次改了什么

### 6.1 设计：一处判断，全进程只算一次

```
maestro/runtime/surface-runtime.ts    ← 选择器（新）
maestro/core/config/surface-config.ts ← 配置解析（新）
maestro/surfaces/hc/hc-cli.ts         ← hc CLI 封装（新）
maestro/surfaces/hc/hc-surface-provider.ts ← hc provider 骨架（新）
maestro/runtime/pi-run-session.ts     ← 两个装配点改成走工厂（改）
config.json.example                   ← 加 surface.runtime 段（改）
test/maestro/surface-runtime.test.ts  ← 单元测试，14 个（新）
test/maestro/dependency-rule.test.ts  ← 依赖规则加 surfaces/hc（改）
```

### 6.2 判断顺序（`decideSurfaceRuntime`）

| 优先级 | 依据 | 结果 | `source` |
|---|---|---|---|
| 1 | `config.json` 里 `surface.runtime` 显式设为 `herdr` / `hc` | 照办 | `config` |
| 2 | `HERDR_ENV=1` 或 `TERM_PROGRAM=herdr` | herdr | `environment` |
| 3 | `HC_TERMINAL_ID` 存在 | hc | `environment` |
| 4 | herdr socket 文件存在（server 在跑） | herdr | `probe` |
| 5 | PATH 上有 `hc` | hc | `probe` |
| 6 | PATH 上有 `herdr` | herdr | `probe` |
| 7 | 都没有 | herdr（保持原行为，会提示装什么） | `fallback` |

第 2 步压过第 3 步是**刻意的**：现有 herdr 用户的界面行为不该因为装了 `hc` 就变。在 herdr 里又开了 hc 终端再跑 pi 这种嵌套场景，`reason` 里会提示「pin `surface.runtime` to `"hc"`」。

结果缓存在模块级变量 `decided` 里，第二次调用直接返回同一个对象，不再探测磁盘。测试可以用 `resetSurfaceRuntimeDecision()` 清掉。

### 6.3 两个装配点

`maestro/runtime/pi-run-session.ts`：

- 建会话时：原来 `new HerdrSurfaceProvider({ paneConfig: loadPaneConfig(...) })` → 现在 `createSurfaceProvider({ configDir, configExamplePath })`
- 构造 launch operations 时：原来又 `new` 了一个 `HerdrSurfaceProvider` → 现在 `createSurfaceProviderForPaneConfig(snapshot.paneConfig, {...})`

两处都走同一个缓存的判断结果，所以一个进程里不可能出现「会话用 hc、启动操作却用 herdr」的错配。

### 6.4 配置

```json
{
  "surface": {
    "runtime": "auto"
  }
}
```

`auto` 是默认值，走上面的判断链。`herdr` / `hc` 是硬钉死，跳过全部探测。

---

## 7. 还没做的（下一个人的活）

### 7.1 `HcSurfaceProvider` 是骨架，不是成品

已实现并能编译的方法：`isAvailable` / `createSurface` / `runCommand` / `readScreen` / `closeSurface` / `listSurfaces` / `attachSurface` / `inspectSurface` / `sendKeys` / `getProcessInfo` / `waitForShellReady` / `waitForSurfaceAbsence` / `setTitle` / `setupHint`。

**明确抛错**的方法（hc 没有对应能力，不假装有）：

| 方法 | 为什么不行 |
|---|---|
| `createWorktreeSurface` | hc 没有 workspace 概念，只有一条扁平终端列表 |
| `removeWorktreeSurface` | 同上 |
| `runScript` | 还没实现，可以降级成 `runCommand` |
| `reportOpenedPrimaryWorkspace` | 返回 `undefined`（接口允许） |
| `focusWorkspace` | no-op |
| `listWorktreeSurfaces` | 返回 `[]` |

**未验证的部分**（`hc` 本机没装，一行都没跑过）：

- `hc --json send <t> <text>`：文档写「waits for a person to pause」，自动化调用会不会卡住、有没有非交互模式，**未知，需要实测**
- `hc --json run --bg --name X --cwd Y` 无 argv 时是否稳定给出一个可交互 shell
- `--name` 与 `hc label <t> title=...` 最终在哪一个字段体现（`Terminal.name` 还是 `labels.title`），代码里两种都读了
- `hc --json keys` 的键名范围（代码里用 `normalizeHcKeys` 做了一层 herdr 风格 → hc 风格的映射）

### 7.2 conformance 套件对 hc 不适用

`test/maestro/surface-provider.conformance.ts` 是给 `SurfaceProvider` 做活体合规测的，但它测的正是 herdr 的语义：`grouped` 放到满要开新 tab、worktree 要能注册和清理。hc 没有这些概念，**这套 conformance 跑不过 hc，是正常的**。

要做的是写一份 hc 自己的 conformance 变体，只测 hc 真正承诺的东西：建终端、跑命令、读屏、关终端、名字规范化。

---

## 8. 怎么开工

```bash
cd ~/dev/pi-herdr-agents

# 类型检查（约 10 秒，ext4 上）
npx tsc --noEmit

# lint（oxlint，有 anti-slop 规则：禁 runtime typeof、禁无 SAFETY 注释的类型断言）
npm run lint

# 全量测试（约 33 秒）。LANG=C 绕开 git 本地化问题
LANG=C LC_ALL=C npm test

# 只跑本次改动相关的
LANG=C LC_ALL=C node --experimental-strip-types --test \
  test/maestro/surface-runtime.test.ts test/maestro/dependency-rule.test.ts
```

要装 hc 才能测 provider：

```bash
# 参考：上游给的是 cargo 构建或发布二进制
git clone https://github.com/herdrdev/herdr-core /tmp/hc-src
cd /tmp/hc-src && cat README.md
```

装好后先验证三件事再改代码：

```bash
hc --json server status        # core 起来了没
hc --json ls                   # 终端列表长什么样
hc --json run --bg --name probe sh -c 'echo hi'   # 输出字段
```

---

## 9. 读代码的顺序

1. `maestro/core/surface-provider.ts` — `SurfaceProvider` 接口，18 个方法，整个 fork 的接缝
2. `maestro/runtime/surface-runtime.ts` — 本次新增的唯一判断点
3. `maestro/surfaces/herdr/herdr-surface-provider.ts` — 原实现，41 行起，照着抄结构
4. `maestro/surfaces/hc/hc-surface-provider.ts` — 新骨架
5. `maestro/runtime/pi-run-session.ts` — 两个装配点（搜 `createSurfaceProvider`）

---

## 10. 已知的坑

- **`/mnt/a` 上别跑测试**，15 倍差距。改代码在 `~/dev`。
- **A 盘仓库必须设 `core.fileMode false`**：DrvFs 把所有文件报成 `100755`，不设的话 `git status` 会显示 262 个「改动」，其实只是权限位。已在本机设置：
  ```bash
  git -C /mnt/a/workspaces/pi-herdr-agents config core.fileMode false
  ```
  换机器或重新 clone 后要重设一次。
- **`rm -rf` 在仓库外会被拦**（CC Safety Net 的 `rm.recursive-force-outside-cwd`）。清理临时目录要用仓库内路径或让用户手动来。
- **`npm test` 里 `package-manifest.test.js` 会挂**，npm 11 的输出格式变了。别以为是自己的改动弄坏的。
- **herdr-app 在这里跑不起来**：没有 Vulkan ICD。真要在本机试 app，得装 `mesa-vulkan-drivers` 或换有 GPU 直通的环境。
