export const PAGE = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
  <meta name="referrer" content="no-referrer">
  <meta name="robots" content="noindex">
  <meta name="theme-color" content="#09090b">
  <title>开机</title>
  <script src="https://cdn.tailwindcss.com"></script>
</head>
<body class="min-h-dvh bg-zinc-950 text-zinc-50 antialiased" style="margin:0;color-scheme:dark;font-family:ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,'PingFang SC','Hiragino Sans GB','Noto Sans SC',sans-serif;-webkit-tap-highlight-color:transparent;padding-top:env(safe-area-inset-top);padding-bottom:env(safe-area-inset-bottom);padding-left:env(safe-area-inset-left);padding-right:env(safe-area-inset-right);">
  <main class="mx-auto flex w-full max-w-md flex-col px-5 pb-8 pt-10">
    <p class="text-xs font-medium tracking-tight text-zinc-500">NAS</p>
    <h1 class="mt-3 text-3xl font-semibold tracking-tight text-zinc-50">开机</h1>
    <p class="mt-2 text-sm font-normal leading-relaxed text-zinc-400">输入密码，然后按开机。</p>
    <div class="mt-8 border-t border-zinc-800 pt-8">
      <label for="password" class="mb-2 block text-sm font-medium text-zinc-300">密码</label>
      <div class="relative">
        <input id="password" type="password" autocomplete="current-password" autocapitalize="off" autocorrect="off" spellcheck="false" enterkeyhint="go" autofocus class="h-12 w-full rounded-xl border border-zinc-800 bg-zinc-900 px-3 pr-12 text-base text-zinc-50 outline-none transition-colors placeholder:text-zinc-600 hover:border-zinc-700 focus:border-zinc-400 focus:outline focus:outline-2 focus:outline-offset-2 focus:outline-zinc-600" style="font-size:16px;">
        <button id="toggle" type="button" aria-label="显示密码" class="absolute right-1 top-1 flex h-10 w-10 items-center justify-center rounded-lg text-zinc-400 outline-none transition-colors hover:bg-zinc-800 hover:text-zinc-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-500">
          <i data-lucide="eye" class="h-5 w-5"></i>
        </button>
      </div>
      <button id="wake" type="button" disabled class="mt-3 flex h-14 w-full touch-manipulation items-center justify-center gap-2 rounded-xl bg-zinc-100 text-base font-medium text-zinc-950 outline-none transition-colors hover:bg-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-zinc-300 disabled:cursor-not-allowed disabled:bg-zinc-800 disabled:text-zinc-500 disabled:hover:bg-zinc-800">
        <i data-lucide="power" class="h-5 w-5"></i>
        开机
      </button>
      <div class="mt-4 flex min-h-12 items-center gap-2 rounded-xl border border-zinc-800 px-3">
        <span id="status-icon" class="flex h-4 w-4 shrink-0 items-center justify-center text-zinc-400"></span>
        <p id="message" role="status" class="min-h-5 text-sm font-medium text-zinc-300"></p>
      </div>
    </div>
  </main>
  <script src="https://unpkg.com/lucide@0.544.0/dist/umd/lucide.min.js"></script>
  <script>
    const passwordEl = document.querySelector("#password");
    const wakeEl = document.querySelector("#wake");
    const toggleEl = document.querySelector("#toggle");
    const messageEl = document.querySelector("#message");
    const statusIcon = document.querySelector("#status-icon");
    let pollTimer = 0;

    function drawIcons() {
      if (window.lucide) lucide.createIcons({ attrs: { "stroke-width": 1.5 } });
    }

    function syncButton() {
      wakeEl.disabled = passwordEl.value.length === 0;
    }

    function show(text) {
      const icons = {
        "密码错误": "circle-x",
        "服务未配置": "circle-alert",
        "没有发出去": "circle-alert",
        "待开机": "loader-circle",
        "指令已消费": "check",
        "未送达": "alarm-clock",
        "空闲": "circle"
      };
      messageEl.textContent = text;
      statusIcon.className = "flex h-4 w-4 shrink-0 items-center justify-center text-zinc-400" + (text === "待开机" ? " animate-spin" : "");
      statusIcon.innerHTML = '<i data-lucide="' + (icons[text] || "circle") + '" class="h-4 w-4"></i>';
      drawIcons();
    }

    function stopPolling() {
      if (pollTimer) {
        clearInterval(pollTimer);
        pollTimer = 0;
      }
    }

    passwordEl.addEventListener("input", syncButton);
    passwordEl.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !wakeEl.disabled) wakeEl.click();
    });
    toggleEl.addEventListener("click", () => {
      const hidden = passwordEl.type === "password";
      passwordEl.type = hidden ? "text" : "password";
      toggleEl.setAttribute("aria-label", hidden ? "隐藏密码" : "显示密码");
      toggleEl.innerHTML = '<i data-lucide="' + (hidden ? "eye-off" : "eye") + '" class="h-5 w-5"></i>';
      drawIcons();
      passwordEl.focus();
    });

    async function post(path) {
      return fetch(path, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ password: passwordEl.value }),
      });
    }

    function failText(response) {
      return response.status === 503 ? "服务未配置" : "没有发出去";
    }

    async function refresh() {
      const response = await post("/api/status");
      if (response.status === 401) {
        show("密码错误");
        stopPolling();
        return;
      }
      if (!response.ok) {
        show(failText(response));
        return;
      }
      const data = await response.json();
      if (data.status === "pending") {
        show("待开机");
        return;
      }
      if (data.status === "consumed") show("指令已消费");
      else if (data.status === "expired") show("未送达");
      else show("空闲");
      stopPolling();
    }

    wakeEl.addEventListener("click", async () => {
      wakeEl.disabled = true;
      try {
        const response = await post("/api/wake");
        if (response.status === 401) {
          show("密码错误");
          return;
        }
        if (!response.ok) {
          show(failText(response));
          return;
        }
        show("待开机");
        stopPolling();
        pollTimer = setInterval(() => {
          refresh().catch(() => show("没有发出去"));
        }, 2000);
        await refresh();
      } catch {
        show("没有发出去");
      } finally {
        syncButton();
      }
    });

    drawIcons();
  </script>
</body>
</html>
`;
