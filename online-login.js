const gate = document.querySelector("#login-gate");
const form = gate.querySelector("form");
const message = gate.querySelector(".login-message");
const submit = form.querySelector('button[type="submit"]');
const register = gate.querySelector(".register");
const emailField = form.elements.namedItem("email");
const passwordField = form.elements.namedItem("password");
const client = window.supabase?.createClient(window.SUPABASE_URL, window.SUPABASE_PUBLISHABLE_KEY);
let registering = false;
let usageId = null;
let heartbeat = null;

async function updateUsage(ended = false) {
  if (!usageId) return;
  const id = usageId;
  const { data, error } = await client.from("usage_sessions").select("started_at").eq("id", id).single();
  if (error) throw error;
  const now = new Date();
  const change = { last_active_at: now.toISOString(), duration_seconds: Math.max(0, Math.floor((now - new Date(data.started_at)) / 1000)) };
  if (ended) change.ended_at = now.toISOString();
  const result = await client.from("usage_sessions").update(change).eq("id", id);
  if (result.error) throw result.error;
}

async function openJourney(user) {
  gate.hidden = true;
  const id = crypto.randomUUID();
  const { error } = await client.from("usage_sessions").insert({ id, user_id: user.id });
  if (error) { message.textContent = `已登录，但使用记录暂时无法保存：${error.message}`; }
  else {
  usageId = id;
  heartbeat = setInterval(() => updateUsage().catch(() => {}), 30000);
  }
  document.querySelector("#app").hidden = false;
  const script = document.createElement("script");
  script.src = document.body.dataset.appEntry || "./src/app.bundle.js";
  if (script.src.endsWith("/app.js")) script.type = "module";
  document.body.append(script);
}

form.addEventListener("submit", async event => {
  event.preventDefault();
  if (!client) { message.textContent = "登录服务未加载，请刷新页面"; return; }
  submit.disabled = true;
  message.textContent = registering ? "正在注册…" : "正在登录…";
  try {
    const email = emailField.value.trim();
    const password = passwordField.value;
    const { data, error } = registering
      ? await client.auth.signUp({ email, password })
      : await client.auth.signInWithPassword({ email, password });
    if (error) throw error;
    if (registering) {
      message.textContent = data.session ? "注册成功，请点击登录" : "注册成功！请先打开邮箱中的确认邮件，然后回来登录";
      registering = false;
      register.textContent = "立即注册";
      submit.setAttribute("aria-label", "登录");
      return;
    }
    await openJourney(data.user);
  } catch (error) {
    message.textContent = error.message || "登录失败，请检查邮箱和密码";
  } finally { submit.disabled = false; }
});
register.addEventListener("click", () => {
  registering = !registering;
  register.textContent = registering ? "返回登录" : "立即注册";
  submit.setAttribute("aria-label", registering ? "注册" : "登录");
  message.textContent = registering ? "先输入邮箱和密码，再点击金色按钮注册" : "请输入邮箱和密码登录";
});
window.addEventListener("pagehide", () => { clearInterval(heartbeat); updateUsage(true).catch(() => {}); });
if (!client) message.textContent = "登录服务未加载，请刷新页面";
else {
  message.textContent = "新用户请点右下角“立即注册”";
  try {
    const { data } = await client.auth.getUser();
    if (data.user) await openJourney(data.user);
  } catch (error) { message.textContent = `连接失败：${error.message}`; }
}
