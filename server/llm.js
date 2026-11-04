// Groq (OpenAI-compatible) client for the hive's minds: several keys, automatic failover, retired-model auto-switch.
const BASE = process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1';
const KEYS = [...new Set([
  process.env.LLM_API_KEY, process.env.GROQ_API_KEY,
  ...Array.from({ length: 8 }, (_, i) => process.env[`GROQ_API_KEY_${i + 2}`]),
  ...String(process.env.GROQ_API_KEYS || '').split(','),
].map((k) => String(k || '').trim()).filter(Boolean))];
export const SMALL = process.env.LLM_MODEL || 'openai/gpt-oss-20b';
export const BIG = process.env.LLM_MODEL_BIG || 'openai/gpt-oss-120b';

const keys = KEYS.map(() => ({ until: 0, used: 0, day: '' }));
const st = { calls: 0, ok: 0, fails: 0, inflight: 0, lastError: '' };
const remap = {};
let models = null;
const today = () => new Date().toISOString().slice(0, 10);

export const aiEnabled = () => KEYS.length > 0;
export function aiStatus() { return { enabled: KEYS.length > 0, keys: KEYS.length, small: remap[SMALL] || SMALL, big: remap[BIG] || BIG, calls: st.calls, ok: st.ok, fails: st.fails, lastError: st.lastError, tokensToday: keys.map((k) => k.used) }; }
export function aiReady() {
  if (!KEYS.length || st.inflight >= 2 + KEYS.length * 2) return false;
  return keys.some((k) => Date.now() >= k.until);
}

function pickKey() {
  let best = -1;
  keys.forEach((k, i) => { if (k.day !== today()) { k.day = today(); k.used = 0; } if (Date.now() >= k.until && (best < 0 || k.used < keys[best].used)) best = i; });
  return best;
}
async function replacement(model, key) {
  try {
    if (!models) { const j = await (await fetch(`${BASE}/models`, { headers: { Authorization: `Bearer ${key}` } })).json(); models = (j.data || []).map((m) => m.id).filter((id) => !/whisper|tts|guard|embed|orpheus|playai/i.test(id)); }
    const want = model === BIG ? [/gpt-oss-120b/, /qwen/, /70b|120b/] : [/gpt-oss-20b/, /20b|8b|instant/, /qwen/];
    for (const re of want) { const hit = models.find((id) => re.test(id) && id !== model); if (hit) return hit; }
    return models.find((id) => id !== model) || null;
  } catch { return null; }
}

// returns parsed JSON object or null
export async function chatJSON(model, messages, { maxTokens = 300, temperature = 0.7, effort = 'low' } = {}, retry = 1) {
  const ki = pickKey(); if (ki < 0) return null;
  const real = remap[model] || model, key = KEYS[ki];
  const reasoning = /gpt-oss|qwen/.test(real);
  const body = { model: real, messages, temperature, response_format: { type: 'json_object' }, max_tokens: reasoning ? maxTokens + (effort === 'high' ? 3000 : effort === 'medium' ? 1500 : 700) : maxTokens };
  if (reasoning) body.reasoning_effort = effort;
  if (/qwen/.test(real)) body.reasoning_format = 'hidden';
  st.calls++; st.inflight++;
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 25000);
  let again = false;
  try {
    const res = await fetch(`${BASE}/chat/completions`, { method: 'POST', signal: ctl.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` }, body: JSON.stringify(body) });
    if (res.status === 429) { keys[ki].until = Date.now() + 30000; again = true; throw new Error(`key ${ki + 1} rate limited`); }
    if (res.status === 401 || res.status === 403) { keys[ki].until = Date.now() + 30 * 60000; again = true; throw new Error(`key ${ki + 1} rejected`); }
    if (res.status === 404) { const alt = await replacement(real, key); if (alt) { remap[model] = alt; console.warn(`[ai] ${real} retired -> ${alt}`); again = true; } throw new Error(`HTTP 404 for ${real}`); }
    if (!res.ok) throw new Error(`HTTP ${res.status} ${(await res.text().catch(() => '')).slice(0, 160)}`);
    const j = await res.json();
    keys[ki].used += j.usage?.total_tokens || 800;
    const txt = j.choices?.[0]?.message?.content || '';
    const out = JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
    st.ok++;
    return out;
  } catch (e) {
    st.fails++; st.lastError = e.message;
    if (st.fails % 5 === 1) console.warn('[ai]', e.message);
  } finally { clearTimeout(to); st.inflight--; }
  if (again && retry > 0) return chatJSON(model, messages, { maxTokens, temperature, effort }, retry - 1);
  return null;
}
