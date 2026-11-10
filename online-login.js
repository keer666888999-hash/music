const client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_PUBLISHABLE_KEY);
const gate = document.querySelector("#login-gate");
const form = gate.querySelector("form");
const message = gate.querySelector(".login-message");
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
  if (error) { gate.hidden = false; message.textContent = `记录启动失败：${error.message}`; return; }
  usageId = id;
  heartbeat = setInterval(() => updateUsage().catch(() => {}), 30000);
  document.querySelector("#app").hidden = false;
  const script = document.createElement("script");
  script.src = document.body.dataset.appEntry || "./src/app.bundle.js";
  if (script.src.endsWith("/app.js")) script.type = "module";
  document.body.append(script);
}

form.addEventListener("submit", async event => {
  event.preventDefault(); message.textContent = "正在登录…";
  const { data, error } = await client.auth.signInWithPassword({ email: form.email.value, password: form.password.value });
  if (error) { message.textContent = error.message; return; }
  await openJourney(data.user);
});
gate.querySelector(".register").addEventListener("click", async () => {
  const { error } = await client.auth.signUp({ email: form.email.value, password: form.password.value });
  message.textContent = error ? error.message : "请打开邮箱里的确认邮件，然后回来登录";
});
window.addEventListener("pagehide", () => { clearInterval(heartbeat); updateUsage(true).catch(() => {}); });
if (!window.SUPABASE_URL || !window.SUPABASE_PUBLISHABLE_KEY) message.textContent = "登录尚未配置";
else {
  const { data } = await client.auth.getUser();
  if (data.user) await openJourney(data.user);
}
