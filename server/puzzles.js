// Puzzle generator: every puzzle has one checkable answer, and difficulty climbs with the level.
// Kinds unlock as the hive grows: arithmetic, sequences, ciphers, anagrams, code tracing, base conversion, logic.

export function mulberry32(a) {
  return function () {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const WORDS = {
  4: ['moon', 'code', 'byte', 'wave', 'star', 'lamp', 'gate', 'neon', 'loop', 'node', 'fire', 'iron', 'wolf', 'rain', 'gold'],
  5: ['pixel', 'laser', 'robot', 'cloud', 'logic', 'orbit', 'spark', 'prism', 'cipher', 'quark', 'vault', 'flame', 'tiger', 'storm', 'glyph'],
  6: ['matrix', 'signal', 'vector', 'plasma', 'binary', 'kernel', 'socket', 'falcon', 'circuit', 'rocket', 'silver', 'beacon', 'puzzle', 'galaxy', 'oracle'],
  7: ['quantum', 'network', 'compile', 'element', 'phantom', 'crystal', 'horizon', 'lantern', 'gravity', 'monarch', 'nucleus', 'thunder', 'voltage', 'synapse', 'chimera'],
  8: ['labyrinth', 'algorithm', 'hologram', 'satellite', 'momentum', 'blueprint', 'sentinel', 'overdrive', 'interface', 'parallax', 'catalyst', 'velocity', 'sapphire', 'equation', 'protocol'],
};
const CATEGORY = {
  moon: 'space', star: 'space', orbit: 'space', galaxy: 'space', satellite: 'space', quark: 'physics', plasma: 'physics', quantum: 'physics', gravity: 'physics', momentum: 'physics', velocity: 'physics', nucleus: 'physics', voltage: 'physics',
  wolf: 'animal', tiger: 'animal', falcon: 'animal', chimera: 'myth', oracle: 'myth', phantom: 'myth', monarch: 'ruler',
};
const NAMES = ['Ada', 'Bo', 'Cy', 'Dex', 'Eve', 'Finn', 'Gia', 'Hal', 'Ivy', 'Jax'];

const pick = (r, a) => a[Math.floor(r() * a.length)];
const int = (r, lo, hi) => lo + Math.floor(r() * (hi - lo + 1));
const shuffle = (r, a) => { a = a.slice(); for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(r() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
export const norm = (s) => String(s ?? '').toLowerCase().replace(/^answer\s*[:=]\s*/, '').replace(/[\s"'`.]/g, '').replace(/^\[|\]$/g, '');

function wordFor(r, level) {
  const len = Math.min(8, 4 + Math.floor(level / 3));
  return pick(r, WORDS[len] || WORDS[8]);
}
const caesar = (w, k) => w.replace(/[a-z]/g, (c) => String.fromCharCode(((c.charCodeAt(0) - 97 + k + 26) % 26) + 97));

const KINDS = {
  arithmetic(r, L) {
    if (L < 4) { const a = int(r, 2, 20), b = int(r, 2, 12), c = int(r, 2, 9); return { title: 'Calculation', prompt: `${a} + ${b} × ${c} = ?`, answer: a + b * c, hint: 'Multiplication comes before addition.' }; }
    if (L < 8) { const a = int(r, 10, 60), b = int(r, 3, 30), c = int(r, 20, 90), d = int(r, 2, 19), m = int(r, 7, 23); return { title: 'Calculation', prompt: `((${a} + ${b}) × (${c} − ${d})) mod ${m} = ?`, answer: ((a + b) * (c - d)) % m, hint: 'mod is the remainder after division.' }; }
    const a = int(r, 2, 7), e = int(r, 9, 9 + L), m = int(r, 11, 41);
    let v = 1; for (let i = 0; i < e; i++) v = (v * a) % m;
    return { title: 'Modular power', prompt: `${a}^${e} mod ${m} = ?`, answer: v, hint: 'Square and reduce mod m as you go.' };
  },
  sequence(r, L) {
    let s, next, hint;
    if (L < 3) { const a = int(r, 1, 20), d = int(r, 2, 9); s = [0, 1, 2, 3, 4].map((i) => a + d * i); next = a + d * 5; hint = 'Constant difference.'; }
    else if (L < 5) { const a = int(r, 1, 5), q = int(r, 2, 4); s = [0, 1, 2, 3, 4].map((i) => a * q ** i); next = a * q ** 5; hint = 'Constant ratio.'; }
    else if (L < 8) { const a = int(r, 1, 9), b = int(r, 1, 6), c = int(r, 1, 3); const f = (n) => c * n * n + b * n + a; s = [0, 1, 2, 3, 4, 5].map(f); next = f(6); hint = 'Look at the differences of the differences.'; }
    else if (L < 11) { let x = int(r, 1, 5), y = int(r, 2, 7); s = [x, y]; for (let i = 0; i < 5; i++) s.push(s[s.length - 1] + s[s.length - 2]); next = s[s.length - 1] + s[s.length - 2]; hint = 'Each term depends on the two before it.'; }
    else { const a = int(r, 1, 9), d = int(r, 3, 9), q = int(r, 2, 3), b = int(r, 1, 4); s = []; for (let i = 0; i < 4; i++) { s.push(a + d * i); s.push(b * q ** i); } next = a + d * 4; hint = 'Two sequences are interleaved.'; }
    return { title: 'Sequence', prompt: `What comes next?\n${s.join(', ')}, ?`, answer: next, hint };
  },
  cipher(r, L) {
    const w = wordFor(r, L), k = int(r, 1, 25);
    if (L < 6) return { title: 'Caesar cipher', prompt: `Decode (each letter shifted forward by ${k}):\n${caesar(w, k).toUpperCase()}`, answer: w, hint: `Shift every letter back by ${k}.` };
    if (L < 10) return { title: 'Caesar cipher — unknown shift', prompt: `Decode this word. The shift is unknown.\n${caesar(w, k).toUpperCase()}`, answer: w, hint: CATEGORY[w] ? `It is a ${CATEGORY[w]} word.` : 'It is an English word from computing or science.' };
    const key = pick(r, ['ai', 'key', 'hive', 'neon', 'code']);
    const enc = w.split('').map((c, i) => caesar(c, key.charCodeAt(i % key.length) - 97)).join('');
    return { title: 'Vigenère cipher', prompt: `Decode with the Vigenère key "${key.toUpperCase()}":\n${enc.toUpperCase()}`, answer: w, hint: 'Shift each letter back by the matching key letter (A=0, B=1 …).' };
  },
  anagram(r, L) {
    const w = wordFor(r, L + 2);
    let s; do { s = shuffle(r, w.split('')).join(''); } while (s === w);
    return { title: 'Anagram', prompt: `Unscramble:\n${s.toUpperCase()}`, answer: w, hint: `It starts with "${w[0].toUpperCase()}".` };
  },
  code(r, L) {
    let src;
    if (L < 5) { const a = int(r, 2, 9), b = int(r, 2, 6), c = int(r, 1, 9); src = `let x = ${a};\nx = x * ${b} + ${c};\nx = x - ${a};\nconsole.log(x);`; }
    else if (L < 8) { const n = int(r, 8, 20), m = int(r, 2, 5); src = `let s = 0;\nfor (let i = 1; i <= ${n}; i++) {\n  if (i % ${m} === 0) s += i;\n}\nconsole.log(s);`; }
    else if (L < 11) { const w = wordFor(r, L).toUpperCase(), k = int(r, 2, 3); src = `const s = "${w}";\nlet out = "";\nfor (let i = s.length - 1; i >= 0; i -= ${k}) out += s[i];\nconsole.log(out);`; }
    else if (L < 14) { const n = int(r, 7, 12); src = `function f(n) {\n  return n < 2 ? n : f(n - 1) + f(n - 2);\n}\nconsole.log(f(${n}));`; }
    else { const arr = Array.from({ length: 7 }, () => int(r, 1, 30)), m = int(r, 2, 4); src = `const a = [${arr.join(', ')}];\nconst r = a.filter(v => v % ${m} !== 0)\n  .map(v => v * 2)\n  .reduce((s, v) => s + v, 0);\nconsole.log(r);`; }
    const out = []; new Function('console', src)({ log: (...v) => out.push(v.join(' ')) }); // our own generated code
    return { title: 'What does this print?', prompt: src, code: true, answer: out.join('\n'), hint: 'Trace it line by line.' };
  },
  base(r, L) {
    if (L < 5) { const n = int(r, 5, 60); return { title: 'Binary', prompt: `Convert binary ${n.toString(2)} to decimal.`, answer: n, hint: 'Each place is a power of 2.' }; }
    if (L < 9) { const n = int(r, 100, 4000); return { title: 'Hexadecimal', prompt: `Convert hex 0x${n.toString(16).toUpperCase()} to decimal.`, answer: n, hint: 'Each place is a power of 16.' }; }
    if (L < 13) { const n = int(r, 40, 400); return { title: 'To binary', prompt: `Write ${n} in binary.`, answer: n.toString(2), hint: 'Repeatedly divide by 2.' }; }
    const n = int(r, 100, 2000); return { title: 'Base 7', prompt: `Write ${n} in base 7.`, answer: n.toString(7), hint: 'Repeatedly divide by 7.' };
  },
  logic(r, L) {
    const n = Math.min(7, 3 + Math.floor(L / 3));
    const order = shuffle(r, NAMES).slice(0, n); // tallest first
    const clues = [];
    for (let i = 0; i < n - 1; i++) clues.push(r() < 0.5 ? `${order[i]} is taller than ${order[i + 1]}.` : `${order[i + 1]} is shorter than ${order[i]}.`);
    if (L > 8) for (let i = 0; i < 2; i++) { const a = int(r, 0, n - 3), b = int(r, a + 2, n - 1); clues.push(`${order[a]} is taller than ${order[b]}.`); }
    const ask = L < 6 ? 'top' : L < 10 ? 'middle' : 'list';
    const q = ask === 'top' ? 'Who is the shortest?' : ask === 'middle' ? `Who is exactly in the middle${n % 2 ? '' : ' (the taller of the two middle people)'}?` : 'List everyone from tallest to shortest, separated by commas.';
    const answer = ask === 'top' ? order[n - 1] : ask === 'middle' ? order[Math.floor((n - 1) / 2)] : order.join(',');
    return { title: 'Logic', prompt: `${shuffle(r, clues).join('\n')}\n\n${q}`, answer, hint: 'Chain the clues into one line from tallest to shortest.' };
  },
};

const UNLOCK = [['arithmetic', 1], ['sequence', 1], ['cipher', 2], ['anagram', 2], ['base', 3], ['code', 4], ['logic', 5]];

export function makePuzzle(level, seed) {
  const r = mulberry32(seed);
  const kinds = UNLOCK.filter(([, l]) => level >= l).map(([k]) => k);
  const kind = pick(r, kinds);
  const p = KINDS[kind](r, level);
  return { id: seed, level, kind, title: p.title, prompt: p.prompt, code: !!p.code, hint: p.hint, answer: String(p.answer), key: norm(p.answer),
    limit: 70 + level * 12 };
}
