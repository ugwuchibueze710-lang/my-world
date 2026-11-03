// AI voices: an OpenAI-compatible chat client (Groq by default) that lets characters speak in their own words.
// The simulation decides WHAT happens; the model only decides HOW people say it. Every call has a template fallback,
// stays inside a daily token budget, and only runs while someone is watching.
const BASE = process.env.LLM_BASE_URL || 'https://api.groq.com/openai/v1';
// One or more keys: GROQ_API_KEY, GROQ_API_KEY_2, GROQ_API_KEY_3 ... (or comma-separated in GROQ_API_KEYS).
// Each key has its own free daily quota; calls go to the least-used healthy key and fail over on 429/401.
const KEYS = [...new Set([
  process.env.LLM_API_KEY, process.env.GROQ_API_KEY,
  ...Array.from({ length: 8 }, (_, i) => process.env[`GROQ_API_KEY_${i + 2}`]),
  ...String(process.env.GROQ_API_KEYS || '').split(','),
].map((k) => String(k || '').trim()).filter(Boolean))];
const KEY = KEYS[0] || '';
const keyState = KEYS.map(() => ({ day: '', used: {}, disabledUntil: 0 }));
const SMALL = process.env.LLM_MODEL || 'llama-3.1-8b-instant';
const BIG = process.env.LLM_MODEL_BIG || 'llama-3.3-70b-versatile';
const BUDGET = { [SMALL]: Number(process.env.LLM_TPD_SMALL) || 420000, [BIG]: Number(process.env.LLM_TPD_BIG) || 85000 };
const MIN_GAP = { [SMALL]: Number(process.env.LLM_GAP_SMALL) || 3500, [BIG]: Number(process.env.LLM_GAP_BIG) || 25000 };

const state = { last: {}, inflight: 0, calls: 0, fails: 0 };
const today = () => new Date().toISOString().slice(0, 10);
function pickKey(model) {
  let best = -1, bestUsed = Infinity;
  keyState.forEach((k, i) => {
    if (k.day !== today()) { k.day = today(); k.used = {}; }
    if (Date.now() < k.disabledUntil || (k.used[model] || 0) > BUDGET[model]) return;
    if ((k.used[model] || 0) < bestUsed) { best = i; bestUsed = k.used[model] || 0; }
  });
  return best;
}

export const llmEnabled = () => !!KEY;
export function llmStatus() {
  return { enabled: !!KEY, keys: KEYS.length, base: BASE.replace(/\/\/([^/]+).*/, '//$1'), small: SMALL, big: BIG,
    usedToday: keyState.map((k) => k.used), calls: state.calls, fails: state.fails };
}

export function canCall(model, viewers) {
  if (!KEY || viewers <= 0 || state.inflight >= 2 + KEYS.length) return false;
  if (pickKey(model) < 0) return false;
  // more keys -> proportionally shorter gap between calls
  return Date.now() - (state.last[model] || 0) > MIN_GAP[model] / KEYS.length;
}

async function chat(model, messages, maxTokens = 220, temperature = 0.95, retry = true) {
  const ki = pickKey(model); if (ki < 0) return null;
  const ks = keyState[ki], key = KEYS[ki];
  state.last[model] = Date.now(); state.inflight++; state.calls++;
  let failover = false;
  const ctl = new AbortController(); const to = setTimeout(() => ctl.abort(), 9000);
  try {
    const res = await fetch(`${BASE}/chat/completions`, {
      method: 'POST', signal: ctl.signal,
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}` },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature, response_format: { type: 'json_object' } }),
    });
    if (res.status === 429) { ks.disabledUntil = Date.now() + 60000; failover = true; throw new Error(`key ${ki + 1} rate limited`); }
    if (res.status === 401 || res.status === 403) { ks.disabledUntil = Date.now() + 30 * 60000; failover = true; throw new Error(`key ${ki + 1} rejected`); }
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const j = await res.json();
    ks.used[model] = (ks.used[model] || 0) + (j.usage?.total_tokens || 600);
    const txt = j.choices?.[0]?.message?.content || '';
    return JSON.parse(txt.slice(txt.indexOf('{'), txt.lastIndexOf('}') + 1));
  } catch (e) {
    state.fails++;
    if (state.fails % 10 === 1) console.warn('[llm]', e.message);
    if (!failover) return null;
  } finally { clearTimeout(to); state.inflight--; }
  if (failover && retry && KEYS.length > 1) return chat(model, messages, maxTokens, temperature, false);
  return null;
}

const clean = (s, n = 160) => String(s || '').replace(/[\r\n]+/g, ' ').replace(/^["“]|["”]$/g, '').trim().slice(0, n);
const MOODS = { neutral: 0, happy: 1, sad: 2, angry: 3, scared: 4 };

const SYSTEM_TALK = `You voice characters in a living medieval world simulation. Each person has free will; the simulation tells you who they are and what is happening.
Write the conversation as these two specific people would actually speak, shaped by their personalities, feelings, memories and situation.
Rules: 2 to 4 short lines, speakers alternate starting with A, each line under 20 words, plain spoken medieval English (no "thee/thou" overload).
Never mention people, children, places or events that are not in the facts. Do not repeat earlier lines. Stay true to the INTERACTION outcome.
Reply ONLY as JSON: {"lines":[{"speaker":"A","text":"...","mood":"neutral|happy|sad|angry|scared"}]}`;

export async function writeConversation(facts) {
  const out = await chat(SMALL, [{ role: 'system', content: SYSTEM_TALK }, { role: 'user', content: facts }], 200, 1.0);
  if (!out || !Array.isArray(out.lines) || !out.lines.length) return null;
  return out.lines.slice(0, 4).map((l, i) => ({ who: (l.speaker || (i % 2 ? 'B' : 'A')).toUpperCase().startsWith('B') ? 'B' : 'A', text: clean(l.text), mood: MOODS[l.mood] ?? 0 })).filter((l) => l.text);
}

const SYSTEM_LETTER = `You write letters between medieval rulers in a living world simulation (think Game of Thrones). The simulation decides the intent; you write the words in the ruler's own voice, shaped by personality.
Under 60 words. No greetings longer than a few words. Mention only facts provided. Reply ONLY as JSON: {"text":"..."}`;

export async function writeLetter(facts) {
  const out = await chat(BIG, [{ role: 'system', content: SYSTEM_LETTER }, { role: 'user', content: facts }], 160, 0.9);
  return out?.text ? clean(out.text, 420) : null;
}

const SYSTEM_NARR = `You are the narrator of a living medieval world, like a documentary narrator for Game of Thrones. You build tension and ask what people will do next, but you NEVER predict or decide outcomes.
One or two sentences, under 40 words, vivid and specific to the facts given. Reply ONLY as JSON: {"text":"..."}`;

export async function writeNarration(facts) {
  const out = await chat(BIG, [{ role: 'system', content: SYSTEM_NARR }, { role: 'user', content: facts }], 120, 0.9);
  return out?.text ? clean(out.text, 300) : null;
}
export { SMALL, BIG };
