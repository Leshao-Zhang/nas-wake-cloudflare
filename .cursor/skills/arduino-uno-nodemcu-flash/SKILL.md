---
name: arduino-uno-nodemcu-flash
description: >-
  Flash ESP8266 NodeMCU via Arduino Uno as USB-serial when onboard USB/CH340
  fails. Use when burning NasWake, Timed out waiting for packet header, USB
  RESET_FAILURE, or Uno bridge TX/RX questions for this WakeUpOnCloudflare project.
---

# Uno 给 NodeMCU 烧录（本项目）

权威步骤与接线图见：`esp8266/用Arduino烧录.md`。下面是必须遵守的硬规则，避免重复踩坑。

## 硬规则

1. **Uno RESET 接 GND** 时：串口 **同名相接**（Uno TX?NodeMCU TX，Uno RX?NodeMCU RX），**禁止**按常规交叉。
2. Uno→NodeMCU **RX** 必须 **5V 分压**（可用 560+560 与 2.2k）；禁止 5V 直连。
3. 供电：NodeMCU **VIN←Uno 5V**（或独立 USB 充电）；烧录时拔掉 NodeMCU 当数据用的 Micro-USB。
4. 若能读 `ets`/`boot mode` 却一直 `Timed out`：先确认已断开 **CH340→ESP RX**（切断走线或去掉串在 RX 上的阻件，万用表测 RX 排针对 CH340 开路）。
5. IDE：直接选 **NodeMCU 1.0 (ESP-12E Module)**，Upload **115200**。靠 **D3(GPIO0) 接地 + RST** 进下载模式，不必改成 Generic / `no dtr`。
6. 下载模式：监视器 **74880** 见 `boot mode:(1,x)`。业务日志：**115200** 见 `NAS 唤醒中继`。
7. 固件入口：`esp8266/NasWake/NasWake.ino`；密钥 `secrets.h` 不进仓库。

## 成功判据

- 上传完成且 115200 出现 `WiFi 已连接` / `poll 空闲`
- 可选：同网段抓到 ESP → 广播地址:9、UDP length 102 的魔术包
