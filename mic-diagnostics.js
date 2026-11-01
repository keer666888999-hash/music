let stream = null;
let context = null;
let frame = null;
let timer = null;
let generation = 0;
let selectedDeviceId = "";
let deviceChangeHandler = null;
let state = freshState();

function freshState() {
  return {
    permission: "尚未请求",
    stream: "未连接",
    context: "未启动",
    phase: "idle",
    volume: null,
    noise: null,
    threshold: null,
    detected: false,
    maxTestVolume: 0,
    issue: "尚未开始检测。权限、音频流与声音识别会分别报告。"
  };
}

function clientInfo() {
  const ua = navigator.userAgent || "";
  const platform = navigator.userAgentData?.platform || navigator.platform || "";
  let browser = "未知浏览器";
  if (/Edg\//.test(ua)) browser = "Microsoft Edge";
  else if (/Firefox\//.test(ua)) browser = "Firefox";
  else if (/CriOS\//.test(ua)) browser = "Chrome (iOS)";
  else if (/Chrome\//.test(ua)) browser = "Chrome";
  else if (/FxiOS\//.test(ua)) browser = "Firefox (iOS)";
  else if (/Safari\//.test(ua)) browser = "Safari";

  let os = "未知系统";
  if (/iPhone|iPad|iPod/.test(ua) || (/Mac/.test(platform) && navigator.maxTouchPoints > 1)) os = "iOS / iPadOS";
  else if (/Mac/.test(platform)) os = "macOS";
  else if (/Win/.test(platform)) os = "Windows";
  else if (/Android/.test(ua)) os = "Android";
  else if (/Linux/.test(platform)) os = "Linux";
  return { browser, os };
}

function renderMarkup() {
  const client = clientInfo();
  return `
    <main class="mic-diagnostics" aria-labelledby="mic-diagnostics-title">
      <header class="mic-diagnostics-header">
        <button class="mic-back" data-action="back" aria-label="返回">←</button>
        <h1 id="mic-diagnostics-title">🎤 麦克风检测</h1>
      </header>
      <section class="mic-device-row">
        <label for="mic-device-select">当前输入设备</label>
        <select id="mic-device-select" aria-label="选择麦克风" disabled>
          <option value="">开始检测后读取设备</option>
        </select>
      </section>
      <section class="mic-live-panel" aria-live="polite">
        <div class="mic-status-grid">
          <div><span>麦克风权限</span><strong id="mic-permission">${state.permission}</strong></div>
          <div><span>AudioContext</span><strong id="mic-context">${state.context}</strong></div>
          <div><span>音频流</span><strong id="mic-stream">${state.stream}</strong></div>
          <div><span>声音状态</span><strong id="mic-sound">尚未检测</strong></div>
        </div>
        <div class="mic-volume-block">
          <div class="mic-volume-label"><span>实时音量</span><strong id="mic-volume-text">等待开始</strong></div>
          <div class="mic-meter" role="meter" aria-label="实时音量" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0"><span id="mic-meter-fill"></span></div>
        </div>
        <p class="mic-test-prompt" id="mic-test-prompt">点击“开始测试”后，请弹一下钢琴。</p>
        <div class="mic-actions">
          <button class="mic-start" data-action="start">开始测试</button>
          <button class="mic-stop" data-action="stop" disabled>停止检测</button>
        </div>
      </section>
      <section class="mic-diagnostic-details">
        <h2>详细诊断</h2>
        <dl>
          <div><dt>设备 / 操作系统</dt><dd>${client.os}</dd></div>
          <div><dt>浏览器</dt><dd>${client.browser}</dd></div>
          <div><dt>当前麦克风</dt><dd id="mic-device-name">尚未获取</dd></div>
          <div><dt>权限</dt><dd id="mic-permission-detail">尚未请求</dd></div>
          <div><dt>音频流</dt><dd id="mic-stream-detail">未连接</dd></div>
          <div><dt>AudioContext</dt><dd id="mic-context-detail">未启动</dd></div>
          <div><dt>环境噪声 RMS</dt><dd id="mic-noise-detail">--</dd></div>
          <div><dt>当前音量 RMS</dt><dd id="mic-rms-detail">--</dd></div>
          <div><dt>动态阈值 RMS</dt><dd id="mic-threshold-detail">--</dd></div>
          <div><dt>钢琴声音</dt><dd id="mic-detected-detail">尚未检测</dd></div>
          <div><dt>麦克风状态</dt><dd id="mic-overall-detail">尚未测试</dd></div>
        </dl>
        <p class="mic-issue" id="mic-issue" role="status">${state.issue}</p>
      </section>
    </main>
  `;
}

function setText(root, selector, value) {
  const node = root.querySelector(selector);
  if (node) node.textContent = value;
}

function message() {
  if (state.phase === "calibrating") return "正在采样环境噪声，请保持安静……";
  if (state.phase === "testing") return "🎹 请连续弹奏几个音符";
  if (state.phase === "done") {
    if (state.detected) return "✅ 检测到高于环境噪声的声音。";
    if (state.maxTestVolume > state.noise) return "H. 捕捉到的声音高于环境底噪，但未超过动态阈值。请确认输入设备朝向钢琴，并检查系统降噪或输入增益设置。";
    return "E. 测试期间没有检测到高于环境噪声的声音；请靠近麦克风弹奏，并检查输入设备选择（F）。";
  }
  return state.issue;
}

function update(root) {
  setText(root, "#mic-permission", state.permission);
  setText(root, "#mic-permission-detail", state.permission);
  setText(root, "#mic-context", state.context);
  setText(root, "#mic-context-detail", state.context);
  setText(root, "#mic-stream", state.stream);
  setText(root, "#mic-stream-detail", state.stream);
  setText(root, "#mic-noise-detail", state.noise === null ? "--" : state.noise.toFixed(4));
  setText(root, "#mic-rms-detail", state.volume === null ? "--" : state.volume.toFixed(4));
  setText(root, "#mic-threshold-detail", state.threshold === null ? "--" : state.threshold.toFixed(4));
  setText(root, "#mic-sound", state.detected ? "🎵 检测到声音" : state.phase === "testing" ? "🔇 暂未检测到明显声音" : state.phase === "calibrating" ? "正在校准" : "尚未检测");
  setText(root, "#mic-detected-detail", state.phase === "idle" ? "尚未检测" : state.detected ? "已检测到" : state.phase === "testing" ? "暂未检测到" : state.phase === "done" ? "未检测到" : "校准中");
  const microphoneOk = state.stream === "✅ 已连接" && state.context === "running";
  const overall = microphoneOk
    ? "✅ 麦克风与音频链路正常"
    : state.issue?.startsWith("尚未开始")
      ? "尚未测试"
      : state.issue?.startsWith("检测已停止")
        ? "检测已停止，设备已释放"
        : "⚠️ 需要检查";
  setText(root, "#mic-overall-detail", overall);
  setText(root, "#mic-issue", message());
  setText(root, "#mic-test-prompt", state.phase === "calibrating" ? "环境校准中，请暂时保持安静" : state.phase === "testing" ? "🎹 请连续弹奏几个音符" : state.phase === "done" ? (state.detected ? "测试完成：已检测到声音" : "测试完成：未识别到明显琴声") : "点击“开始测试”后，请弹一下钢琴。");

  const active = state.phase === "calibrating" || state.phase === "testing";
  root.querySelector('[data-action="start"]').disabled = active;
  root.querySelector('[data-action="stop"]').disabled = !active && state.stream !== "✅ 已连接";
  const select = root.querySelector("#mic-device-select");
  if (select && !active) select.disabled = select.options.length < 2;

  const meter = root.querySelector(".mic-meter");
  const fill = root.querySelector("#mic-meter-fill");
  if (meter && fill) {
    const percent = state.volume === null ? 0 : Math.min(100, state.volume * 1000);
    fill.style.width = `${percent}%`;
    meter.setAttribute("aria-valuenow", String(Math.round(percent)));
    setText(root, "#mic-volume-text", state.volume === null ? "等待开始" : `${Math.round(percent)}% (${state.volume.toFixed(4)} RMS)`);
  }
}

async function populateDevices(root) {
  try {
    const inputs = (await navigator.mediaDevices.enumerateDevices()).filter((device) => device.kind === "audioinput");
    const select = root.querySelector("#mic-device-select");
    if (!select) return;
    const previous = selectedDeviceId || select.value;
    select.replaceChildren();
    if (!inputs.length) {
      select.add(new Option("未发现音频输入设备", ""));
      select.disabled = true;
      setText(root, "#mic-device-name", "未发现音频输入设备");
      return;
    }
    inputs.forEach((device, index) => {
      select.add(new Option(device.label || `麦克风 ${index + 1}（名称不可用）`, device.deviceId));
    });
    if (inputs.some((device) => device.deviceId === previous)) select.value = previous;
    else select.selectedIndex = 0;
    if (!selectedDeviceId) selectedDeviceId = select.value;
    select.disabled = inputs.length < 2 || state.phase !== "idle";
    const activeDevice = inputs.find((device) => device.deviceId === (selectedDeviceId || select.value));
    setText(root, "#mic-device-name", activeDevice?.label || (state.stream.startsWith("✅") ? "设备名称不可用" : "尚未获取"));
  } catch {
    state.issue = "B. 浏览器无法读取输入设备列表。开始测试仍会尝试请求麦克风。";
    update(root);
  }
}

function releaseAudio() {
  generation += 1;
  if (deviceChangeHandler) {
    navigator.mediaDevices?.removeEventListener?.("devicechange", deviceChangeHandler);
    deviceChangeHandler = null;
  }
  if (frame !== null) cancelAnimationFrame(frame);
  if (timer !== null) clearTimeout(timer);
  frame = null;
  timer = null;
  if (stream) stream.getTracks().forEach((track) => track.stop());
  if (context) context.close().catch(() => {});
  stream = null;
  context = null;
}

function stopTest(root) {
  releaseAudio();
  state.phase = "idle";
  state.stream = "已停止";
  state.context = "已关闭";
  state.volume = null;
  state.noise = null;
  state.threshold = null;
  state.detected = false;
  state.issue = "检测已停止，麦克风已释放。";
  update(root);
}

async function startTest(root) {
  releaseAudio();
  const run = generation;
  state.phase = "calibrating";
  state.permission = "请求中";
  state.stream = "连接中";
  state.context = "启动中";
  state.volume = null;
  state.noise = null;
  state.threshold = null;
  state.detected = false;
  state.maxTestVolume = 0;
  state.issue = "正在采样环境噪声，请保持安静……";
  update(root);

  if (!window.isSecureContext) {
    state.phase = "idle";
    state.permission = "未获取";
    state.stream = "未连接";
    state.context = "未启动";
    state.issue = "C. 页面不是安全上下文。请使用 HTTPS；手机通过局域网 HTTP 打开时通常不能访问麦克风。";
    update(root);
    return;
  }
  if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices?.enumerateDevices) {
    state.phase = "idle";
    state.permission = "未获取";
    state.stream = "未连接";
    state.context = "未启动";
    state.issue = "B. 浏览器不支持麦克风访问或输入设备枚举。请更新 Safari、Chrome 或 Edge。";
    update(root);
    return;
  }

  let acquiredStream;
  try {
    const deviceId = root.querySelector("#mic-device-select")?.value || selectedDeviceId;
    acquiredStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
        echoCancellation: false,
        noiseSuppression: false,
        autoGainControl: false
      }
    });
    if (run !== generation) {
      acquiredStream.getTracks().forEach((track) => track.stop());
      return;
    }
    stream = acquiredStream;
    const actualDeviceId = stream.getAudioTracks()[0]?.getSettings?.().deviceId;
    if (actualDeviceId) selectedDeviceId = actualDeviceId;
    state.permission = "✅ 已允许";
    state.stream = "✅ 已连接";
    await populateDevices(root);
  } catch (error) {
    state.phase = "idle";
    state.stream = "未连接";
    state.context = "未启动";
    if (["NotAllowedError", "PermissionDeniedError"].includes(error?.name)) {
      state.permission = "❌ 未允许";
      state.issue = "A. 麦克风权限被拒绝或系统隐私设置禁止访问。请在浏览器网站设置及设备隐私设置中允许麦克风。";
    } else if (["NotFoundError", "DevicesNotFoundError"].includes(error?.name)) {
      state.permission = "未获取";
      state.issue = "D. 没有找到可用麦克风，请连接或启用音频输入设备。";
    } else if (["OverconstrainedError", "NotReadableError"].includes(error?.name)) {
      state.permission = "未获取";
      state.issue = `F. 无法使用所选输入设备（${error.name}）。请选择其他麦克风，或关闭正在占用麦克风的应用。`;
    } else {
      state.permission = "未获取";
      state.issue = `D. 获取音频流失败（${error?.name || "未知错误"}）。请检查设备连接和系统麦克风设置。`;
    }
    update(root);
    return;
  }

  try {
    const AudioContextClass = window.AudioContext || window.webkitAudioContext;
    if (!AudioContextClass) throw new Error("浏览器没有 Web Audio API");
    context = new AudioContextClass();
    await context.resume();
    if (run !== generation) return;
    if (context.state !== "running") throw new Error(`当前状态为 ${context.state}`);
    state.context = context.state;
    context.addEventListener("statechange", () => {
      if (run !== generation) return;
      state.context = context?.state || "已关闭";
      if (state.context !== "running" && ["calibrating", "testing"].includes(state.phase)) {
        state.phase = "idle";
        state.issue = "G. AudioContext 已停止运行。请再次点击开始测试，或检查浏览器是否暂停了音频。";
        releaseAudio();
      }
      update(root);
    });
    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 2048;
    source.connect(analyser);
    const samples = new Float32Array(analyser.fftSize);
    const ambientSamples = [];
    const startedAt = performance.now();

    const sample = (now) => {
      if (run !== generation || !context || !stream) return;
      analyser.getFloatTimeDomainData(samples);
      let energy = 0;
      for (const value of samples) energy += value * value;
      const rms = Math.sqrt(energy / samples.length);
      state.volume = rms;
      const elapsed = now - startedAt;
      if (elapsed < 2000) {
        ambientSamples.push(rms);
        state.phase = "calibrating";
      } else if (state.phase === "calibrating") {
        state.noise = ambientSamples.reduce((sum, value) => sum + value, 0) / Math.max(1, ambientSamples.length);
        state.threshold = state.noise + Math.max(state.noise * 1.8, 0.003);
        state.phase = "testing";
        state.issue = "🎹 请连续弹奏几个音符";
        timer = window.setTimeout(() => {
          if (run !== generation || state.phase !== "testing") return;
          state.phase = "done";
          update(root);
        }, 10000);
      }
      if (state.phase === "testing") {
        state.maxTestVolume = Math.max(state.maxTestVolume, rms);
        if (rms > state.threshold) state.detected = true;
      }
      update(root);
      frame = requestAnimationFrame(sample);
    };
    frame = requestAnimationFrame(sample);
  } catch (error) {
    releaseAudio();
    state.phase = "idle";
    state.context = "异常";
    state.stream = "已释放";
    state.issue = `G. AudioContext 未能正常启动（${error?.message || "未知错误"}）。请检查浏览器支持及音频输出状态。`;
    update(root);
  }
}

export function renderMicrophoneDiagnostics(root) {
  releaseAudio();
  state = freshState();
  root.innerHTML = renderMarkup();
  const back = root.querySelector('[data-action="back"]');
  const start = root.querySelector('[data-action="start"]');
  const stop = root.querySelector('[data-action="stop"]');
  const select = root.querySelector("#mic-device-select");
  back.addEventListener("click", () => {
    releaseAudio();
    window.location.href = window.location.pathname;
  });
  start.addEventListener("click", () => startTest(root));
  stop.addEventListener("click", () => stopTest(root));
  select.addEventListener("change", () => {
    selectedDeviceId = select.value;
    if (state.phase !== "idle") startTest(root);
    else {
      const selected = select.selectedOptions[0];
      setText(root, "#mic-device-name", selected?.textContent || "尚未获取");
    }
  });
  if (navigator.mediaDevices?.addEventListener) {
    deviceChangeHandler = () => populateDevices(root);
    navigator.mediaDevices.addEventListener("devicechange", deviceChangeHandler);
  }
  window.addEventListener("pagehide", releaseAudio, { once: true });

  if (!window.isSecureContext) {
    state.issue = "C. 当前页面不是安全上下文。手机和平板请用 HTTPS 页面测试；localhost 通常可用于本机测试。";
  } else if (!navigator.mediaDevices?.getUserMedia || !navigator.mediaDevices?.enumerateDevices || !(window.AudioContext || window.webkitAudioContext)) {
    state.issue = "B. 当前浏览器不支持所需的麦克风或 Web Audio API。请使用较新的 Safari、Chrome 或 Edge。";
  } else {
    navigator.permissions?.query?.({ name: "microphone" }).then((result) => {
      if (result.state === "granted") state.permission = "✅ 已允许";
      else if (result.state === "denied") {
        state.permission = "❌ 未允许";
        state.issue = "A. 麦克风权限已被浏览器或系统设置拒绝。请在网站权限及设备隐私设置中允许麦克风。";
      }
      update(root);
    }).catch(() => {});
    populateDevices(root);
  }
  update(root);
}
