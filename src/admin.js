const summary = document.querySelector("#summary");
const rows = document.querySelector("#rows");
const formatTime = value => value ? new Date(value).toLocaleString("zh-CN") : "使用中";
const formatDuration = value => `${Math.floor(value / 60)}分${value % 60}秒`;
try {
  let records;
  if (window.SUPABASE_URL && window.SUPABASE_PUBLISHABLE_KEY) {
    const client = window.supabase.createClient(window.SUPABASE_URL, window.SUPABASE_PUBLISHABLE_KEY);
    const { data, error } = await client.rpc("admin_usage");
    if (error) throw error;
    records = data.map(item => ({ username: item.email, startedAt: item.started_at, endedAt: item.ended_at, durationSeconds: item.duration_seconds }));
  } else {
    const response = await fetch("/api/usage/admin");
    const data = await response.json();
    if (!response.ok) throw new Error(data.error);
    records = data.records;
  }
  summary.textContent = `共 ${records.length} 次使用记录`;
  for (const item of records) {
    const row = rows.insertRow();
    for (const value of [item.username, formatTime(item.startedAt), formatTime(item.endedAt), formatDuration(item.durationSeconds)]) row.insertCell().textContent = value;
  }
} catch (error) { summary.textContent = `无法查看记录：${error.message}。请先用管理员账号登录。`; summary.className = "error"; }
