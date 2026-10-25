# nas-wake-cloudflare

用 Cloudflare Worker 做外网入口，家里常开的 ESP8266 轮询后发 Wake-on-LAN，远程唤醒局域网里的 NAS。NAS 不必暴露到公网，也不做端口转发。

## 怎么工作

```
手机浏览器 ──HTTPS──► Cloudflare Worker（密码保护 / 状态机）
                              ▲
                              │ 每约 8 秒轮询 + 设备令牌
                         ESP8266
                              │ 待开机时
                              ▼
                    局域网广播 UDP/9 魔术包 ──► NAS 网卡
```

1. 外网打开网页，输入开机密码，进入「待开机」。
2. ESP8266 带着设备令牌轮询；看到待开机就发 WoL，再回报「已消费」。
3. 网页显示「指令已消费」。待开机超过约 2 分钟无人领取则过期。

网页上不出现 MAC、IP 或 Wi-Fi。凭据只放在 Cloudflare Secret 和本地 `secrets.h`。

## 目录

| 路径 | 内容 |
|------|------|
| `worker/` | Cloudflare Worker：开机页 + API + Durable Object |
| `esp8266/NasWake/` | Arduino 工程（推荐入口） |
| `esp8266/` | PlatformIO 工程与烧录说明 |
| `方案.md` | 设计取舍与约束 |

## 快速开始

### 1. 部署 Worker

需要 Node.js 20+ 和 Cloudflare 账号（免费档即可，需 SQLite Durable Object）。

```bash
cd worker
cp wrangler.jsonc.example wrangler.jsonc
# 编辑 wrangler.jsonc：把 routes 里的域名改成你的自定义域名
npm install
npx wrangler login
openssl rand -base64 24          # 生成设备令牌
npx wrangler secret put WAKE_PASSWORD
npx wrangler secret put DEVICE_TOKEN
npx wrangler deploy
```

建议用自定义域名作为网页和 ESP 的入口；部分网络会污染 `workers.dev` 的 DNS。

更细的步骤、接口约定见 [`worker/部署.md`](worker/部署.md)。

### 2. 烧录 ESP8266

1. 复制密钥文件并填写：

```bash
cp esp8266/NasWake/secrets.h.example esp8266/NasWake/secrets.h
```

填写 Wi-Fi、`DEVICE_TOKEN`（与 Worker 相同）、`WAKE_HOST`、NAS 的 MAC，以及同子网广播地址。

2. 用 Arduino IDE 打开 `esp8266/NasWake/NasWake.ino` 烧录；或在 `esp8266/` 下用 PlatformIO：`pio run -t upload`。

3. 板子与 NAS 同一子网，路由器不要开 AP / 客户端隔离。

板载 USB 损坏时可用 Arduino Uno 转接，见 [`esp8266/用Arduino烧录.md`](esp8266/用Arduino烧录.md)。固件与联调说明见 [`esp8266/说明.md`](esp8266/说明.md)。

### 3. 验证

1. 手机流量打开你的域名，输入密码开机，页面应变为「待开机」。
2. 串口（115200）应出现 `要开机` → `魔术包已发出` → `已回报消费`。
3. 页面变为「指令已消费」；NAS 需已开启网络唤醒，关机/睡眠后网口待机灯仍亮。

## 安全注意

- **不要**把 `secrets.h`、`wrangler.jsonc`、`.dev.vars` 提交进仓库（已在 `.gitignore` 中）。
- 开机密码与设备令牌分开；ESP 不能用网页密码调设备接口。
- 仓库示例里只有占位符。公开自己的 fork 前，确认没有个人域名、MAC、内网地址和真实口令。
- 这只能证明「魔术包已发出」，不能证明系统已进桌面。

## License

未单独声明许可证时，请按你自己的仓库设置选用；贡献或二次分发前请自行确认。
