# Neon Hive

One AI wakes up in a neon arena with a puzzle in front of it. **Every puzzle it solves, it copies itself.**
The clones attack the next puzzle together, sharing what they've ruled out, and every level is harder than the last.
Fail a puzzle and the youngest clone flickers out of existence.

You can help: type an answer into **Help the hive**. If you're right, the hive absorbs your answer and copies itself.

## Puzzles
Arithmetic and modular powers, number sequences, Caesar and Vigenère ciphers, anagrams, "what does this code print?",
binary / hex / base-7 conversion, and logic orderings. New kinds unlock and every kind gets harder as the level rises.

## Running
```
npm install
npm start        # http://localhost:3000
npm run dev      # start a fresh hive
```

## Settings (environment variables)
| Variable | What it does |
|---|---|
| `GROQ_API_KEY`, `GROQ_API_KEY_2` … | Real AI minds (Groq, free tier). Without a key the hive runs in simulation mode. |
| `LLM_MODEL` / `LLM_MODEL_BIG` | Defaults `openai/gpt-oss-20b` / `openai/gpt-oss-120b`; retired models are replaced automatically. |
| `REDIS_URL` | Saves the hive so it continues across restarts and deploys (also saved to `data/hive.sav`). |
| `MAX_AGENTS` | Largest hive size (default 96). |
| `WAVE_SECONDS` | Seconds between waves of attempts (default 9). |
| `FRESH_HIVE=1` | Start over from a single mind. |

With real AI, the hive rests while nobody is watching, to save the free daily budget.

## Credits
three.js (MIT). Fonts: Orbitron and JetBrains Mono (SIL Open Font License, via Google Fonts).
