#include <Arduino.h>
#include <ESP8266HTTPClient.h>
#include <ESP8266WiFi.h>
#include <WiFiClientSecureBearSSL.h>
#include <WiFiUdp.h>
#include <time.h>

#include "certs.h"
#include "secrets.h"

namespace {

constexpr char kHost[] = WAKE_HOST;
constexpr char kPollPath[] = "/api/poll";
constexpr char kAckPath[] = "/api/ack";

// 目标 MAC / 广播地址来自本地 secrets.h，不进仓库
constexpr uint8_t kNasMac[6] = {
    NAS_MAC_0, NAS_MAC_1, NAS_MAC_2, NAS_MAC_3, NAS_MAC_4, NAS_MAC_5};
const IPAddress kBroadcast(WOL_BCAST_0, WOL_BCAST_1, WOL_BCAST_2, WOL_BCAST_3);
constexpr uint16_t kWolPort = 9;

constexpr uint32_t kPollMs = 8000;
constexpr uint32_t kWifiRetryMs = 3000;
constexpr uint32_t kNtpWaitMs = 20000;

BearSSL::X509List gTrustAnchors(CLOUDFLARE_TRUST_ANCHORS);
WiFiUDP gUdp;

bool wifiReady() {
  if (WiFi.status() == WL_CONNECTED) return true;
  Serial.println(F("WiFi 断开，重连"));
  WiFi.disconnect();
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);
  const uint32_t start = millis();
  while (WiFi.status() != WL_CONNECTED) {
    if (millis() - start > 20000) {
      Serial.println(F("WiFi 连不上"));
      return false;
    }
    delay(250);
  }
  Serial.print(F("WiFi 已连接 "));
  Serial.println(WiFi.localIP());
  return true;
}

bool timeReady() {
  time_t now = time(nullptr);
  if (now > 1700000000) return true;
  Serial.println(F("等 NTP"));
  configTime(0, 0, "pool.ntp.org", "time.cloudflare.com", "ntp.aliyun.com");
  const uint32_t start = millis();
  while (time(nullptr) < 1700000000) {
    if (millis() - start > kNtpWaitMs) {
      Serial.println(F("NTP 超时，证书校验会失败"));
      return false;
    }
    delay(200);
  }
  Serial.println(F("时间已同步"));
  return true;
}

int gTlsRxBuf = 2048;

void configureTls(BearSSL::WiFiClientSecure& client) {
  client.setTrustAnchors(&gTrustAnchors);
  client.setBufferSizes(gTlsRxBuf, 512);
}

void tuneTlsBuffers() {
  BearSSL::WiFiClientSecure probe;
  // Cloudflare 支持较小 TLS 分片时更省 RAM，减少偶发 HTTP -1
  if (probe.probeMaxFragmentLength(kHost, 443, 1024)) {
    gTlsRxBuf = 1024;
    Serial.println(F("TLS MFLN 1024"));
  } else {
    gTlsRxBuf = 2048;
    Serial.println(F("TLS 缓冲 2048"));
  }
}

void logHttpFail(const char* tag, HTTPClient& http, BearSSL::WiFiClientSecure& client, int code) {
  Serial.print(tag);
  Serial.print(F(" HTTP "));
  Serial.print(code);
  Serial.print(' ');
  Serial.print(http.errorToString(code));
  char sslErr[64];
  const int n = client.getLastSSLError(sslErr, sizeof(sslErr));
  if (n != 0 && sslErr[0] != '\0') {
    Serial.print(F(" SSL "));
    Serial.print(sslErr);
  }
  Serial.println();
}

bool readWakeFlag(const String& body) {
  // 响应形态固定：{"wake":true} 或 {"wake":false}
  return body.indexOf("\"wake\":true") >= 0;
}

bool pollShouldWake() {
  // 静态复用，减轻栈压力；ESP8266 HTTPS 栈上新建客户端容易偶发 -1
  static BearSSL::WiFiClientSecure client;
  client.stop();
  configureTls(client);

  for (int attempt = 0; attempt < 3; attempt++) {
    HTTPClient http;
    const String url = String(F("https://")) + kHost + kPollPath;
    if (!http.begin(client, url)) {
      Serial.println(F("poll begin 失败"));
      delay(300);
      continue;
    }
    http.setTimeout(10000);
    http.setReuse(false);
    http.addHeader(F("Authorization"), String(F("Bearer ")) + DEVICE_TOKEN);
    http.addHeader(F("Connection"), F("close"));

    const int code = http.GET();
    const String body = http.getString();
    http.end();

    if (code == 401) {
      Serial.println(F("poll 令牌不对"));
      return false;
    }
    if (code == 200) {
      const bool wake = readWakeFlag(body);
      Serial.print(F("poll "));
      Serial.println(wake ? F("要开机") : F("空闲"));
      return wake;
    }
    logHttpFail("poll", http, client, code);
    client.stop();
    delay(400);
  }
  return false;
}

bool sendMagicPacket() {
  uint8_t packet[102];
  memset(packet, 0xFF, 6);
  for (int i = 0; i < 16; i++) {
    memcpy(packet + 6 + i * 6, kNasMac, 6);
  }

  bool ok = false;
  if (gUdp.beginPacket(kBroadcast, kWolPort)) {
    gUdp.write(packet, sizeof(packet));
    ok = gUdp.endPacket() == 1;
  }

  if (ok) {
    Serial.println(F("魔术包已发出"));
  } else {
    Serial.println(F("魔术包发送失败"));
  }
  return ok;
}

bool ackWake() {
  static BearSSL::WiFiClientSecure client;
  client.stop();
  configureTls(client);

  for (int attempt = 0; attempt < 3; attempt++) {
    HTTPClient http;
    const String url = String(F("https://")) + kHost + kAckPath;
    if (!http.begin(client, url)) {
      Serial.println(F("ack begin 失败"));
      delay(300);
      continue;
    }
    http.setTimeout(10000);
    http.setReuse(false);
    http.addHeader(F("Authorization"), String(F("Bearer ")) + DEVICE_TOKEN);
    http.addHeader(F("Connection"), F("close"));

    const int code = http.POST("");
    const String body = http.getString();
    http.end();

    if (code == 200) {
      const bool ok = body.indexOf("\"ok\":true") >= 0;
      Serial.println(ok ? F("已回报消费") : F("回报未接受"));
      return ok;
    }
    logHttpFail("ack", http, client, code);
    client.stop();
    delay(400);
  }
  return false;
}

}  // namespace

void setup() {
  Serial.begin(115200);
  delay(200);
  Serial.println();
  Serial.println(F("NAS 唤醒中继"));

  WiFi.mode(WIFI_STA);
  WiFi.persistent(false);
  WiFi.setSleepMode(WIFI_NONE_SLEEP);
  WiFi.begin(WIFI_SSID, WIFI_PASSWORD);

  // 本地端口随意；真正发包目标是广播 :9
  gUdp.begin(0);
}

void loop() {
  if (!wifiReady()) {
    delay(kWifiRetryMs);
    return;
  }
  if (!timeReady()) {
    delay(kWifiRetryMs);
    return;
  }

  static bool tlsTuned = false;
  if (!tlsTuned) {
    tuneTlsBuffers();
    tlsTuned = true;
  }

  if (pollShouldWake()) {
    if (sendMagicPacket()) {
      // 回报失败则保持待开机，下一轮再发一次魔术包
      if (!ackWake()) {
        Serial.println(F("回报失败，下轮重试"));
      }
    } else {
      Serial.println(F("未发包，不回报"));
    }
  }

  delay(kPollMs);
}
