# AGENTS.md — 给编码 Agent 的操作指南

本文件优先于散落的长文说明。改代码前先读本节硬约束；细节再查文末「文档索引」。

## 项目一句话

Cloudflare Worker 只存「要不要开机」；家里 ESP8266 轮询后发 WoL 魔术包。NAS 不暴露公网。

## 硬约束（违反即错误）

1. **禁止提交**：`secrets.h`、`worker/.dev.vars`、`worker/wrangler.jsonc`、抓包文件、驱动目录。只改 `*.example`。
2. **禁止写入仓库或网页**：真实 Wi-Fi、开机密码、`DEVICE_TOKEN`、个人域名、NAS MAC、内网 IP/广播地址。示例一律用 `wake.example.com`、`0xAA…0xFF`、`192.168.1.255` 等占位符。
3. **网页 / Worker 页面不得出现** MAC、IP、Wi-Fi、令牌。
4. **两套固件必须同步**：改逻辑时同时改  
   - `esp8266/NasWake/NasWake.ino`（Arduino 主入口）  
   - `esp8266/src/main.cpp`（PlatformIO）  
   以及两侧的 `certs.h`、`secrets.h.example`。
5. **Durable Object migration `tag: v1` 不可删改**（`wrangler.jsonc.example`）。可追加新 migration，不要改已有 tag。
6. **不要把 `workers.dev` 当作唯一推荐入口**；文档与固件默认走自定义域名（`WAKE_HOST`）。
7. **轮询不消费**：`/api/poll` 只读；只有成功发包后的 `/api/ack` 才把 `pending` → `consumed`。
8. **魔术包发广播地址 UDP/9**，不要改成发往 NAS 主机单播 IP（关机无 ARP）。

## 仓库地图

| 路径 | 职责 | Agent 常改？ |
|------|------|-------------|
| `worker/src/index.ts` | 路由、鉴权、Durable Object 状态机 | 是 |
| `worker/src/page.ts` | 开机页 HTML/JS（内联字符串） | 是 |
| `worker/wrangler.jsonc.example` | 部署模板（无真实域名） | 偶发 |
| `worker/.dev.vars.example` | 本地密钥模板 | 否（只改占位说明） |
| `esp8266/NasWake/NasWake.ino` | 固件主逻辑 | 是 |
| `esp8266/src/main.cpp` | 同上（PIO） | 是（与 .ino 同步） |
| `esp8266/**/secrets.h.example` | Wi-Fi/令牌/域名/MAC/广播占位 | 只加字段、不填真值 |
| `esp8266/**/certs.h` | BearSSL 信任锚 | 证书轮换时 |
| `方案.md` | 产品决策 | 改行为前先对齐 |
| `README.md` | 给人看的总览 | 公开接口变了再改 |

本地用户文件（存在也不要读进提交、不要回显内容）：`secrets.h`、`wrangler.jsonc`、`.dev.vars`。

## API 契约（不要擅自改路径/字段名）

| 调用方 | 方法 | 路径 | 鉴权 | 成功体要点 |
|--------|------|------|------|------------|
| 网页 | `POST` | `/api/wake` | JSON `{ "password" }` | `{ "status": "pending" }` |
| 网页 | `POST` | `/api/status` | 同上 | `{ "status": "idle\|pending\|consumed\|expired" }` |
| ESP | `GET` | `/api/poll` | `Authorization: Bearer <DEVICE_TOKEN>` | `{ "wake": true\|false }` |
| ESP | `POST` | `/api/ack` | 同上 | `{ "ok": true\|false }` |

- 密码错：`401` + `{ "error": "密码错误" }`（状态不变）。
- 设备令牌错：`401`；poll 仍返回 `{ "wake": false }`，ack 返回 `{ "ok": false }`。
- 待开机窗口：`PENDING_MS = 120_000`（`index.ts`）。

状态机：`idle → pending → consumed`；pending 超时 → `expired`。pending 期间再次 wake 只刷新计时。

## 固件约定

- 主机 / MAC / 广播**只**来自 `secrets.h` 宏：`WAKE_HOST`、`NAS_MAC_0..5`、`WOL_BCAST_0..3`。
- 轮询间隔约 `8000` ms；先 NTP 再 HTTPS；校验 `certs.h` 信任锚。
- 串口 115200；业务日志关键字：`WiFi 已连接`、`poll 空闲`、`要开机`、`魔术包已发出`、`已回报消费`。
- 烧录接线坑见 `esp8266/用Arduino烧录.md` 与 `.cursor/skills/arduino-uno-nodemcu-flash/SKILL.md`（Uno 转接时 **TX-TX / RX-RX**，RESET 接地）。

## 常见任务清单

### 改 Worker 行为

1. 编辑 `worker/src/index.ts`（和必要时 `page.ts`）。
2. `cd worker && npm run check`（`tsc --noEmit`）。
3. 本地：`cp .dev.vars.example .dev.vars` 填占位后 `npm run dev`（勿提交 `.dev.vars`）。
4. 部署说明指向 `worker/部署.md`；**不要**在文档里写用户真实域名。

### 改固件行为

1. 先改 `NasWake/NasWake.ino`，再原样同步 `src/main.cpp`（或反过来，但必须双端一致）。
2. 新配置项加到**两个** `secrets.h.example`，不要提交 `secrets.h`。
3. 提醒用户：本地已有 `secrets.h` 时需手工补新宏。

### 用户要「帮我部署 / 烧录」

1. 只指导复制 example → 本地文件，**让用户自己填密**；Agent 不要生成或索要真实密码并写进仓库。
2. 域名：改本地 `wrangler.jsonc` 的 `routes[0].pattern`，以及 `secrets.h` 的 `WAKE_HOST`。
3. 验证用 curl 时 `BASE=https://wake.example.com` 占位，或用户提供的域名（会话内使用，不写入 git）。

### 公开前自检

```text
rg -n "password|token|WIFI_|WAKE_HOST|192\\.168\\.|[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}" \
  --glob '!**/*.example' --glob '!**/node_modules/**'
```

确认命中仅为代码字段名/占位符/公钥证书，无真实机密。

## 明确不做（除非用户改产品范围）

- 端口转发、公网 IP、DDNS、Cloudflare Tunnel 替代 WoL
- 远程关机、多机、定时开机、网页探测「是否进桌面」
- 用 KV 存唤醒标志（必须 Durable Object / 强一致）
- 在开发机（非 NAS 局域网）上「验证已唤醒」当作验收完成

## 文档索引

| 需求 | 打开 |
|------|------|
| 人读总览 | `README.md` |
| 决策与验收 | `方案.md` |
| Worker 部署与 curl | `worker/部署.md` |
| ESP 联调 | `esp8266/说明.md` |
| Uno 烧录 | `esp8266/用Arduino烧录.md` |
| Uno 烧录硬规则（Skill） | `.cursor/skills/arduino-uno-nodemcu-flash/SKILL.md` |

## 回复用户时的偏好

- 中文、简短、可执行步骤。
- 涉及机密时：说明「写入本地被 ignore 的文件」，不要贴出用户已有的密钥内容。
- 改 API 或状态机时，同步更新 `README.md` / `方案.md` / 本文件中的契约表。
