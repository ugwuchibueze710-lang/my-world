# My World — The Endless Kingdoms

An autonomous, never-ending 3D world built with Three.js. It begins with two kingdoms, each with one king and one queen. From there, nobody is scripted:

- **People have free will.** Each person weighs hunger, thirst, tiredness, danger, loyalty, ambition, courage and love, then decides to farm, mine, build, eat, drink, rest, court, marry, flee, fight, defect or rebel.
- **Families grow.** Couples marry and have boys or girls, who inherit their parents' traits. Children grow up, marry into other realms, and become soldiers, generals, kings and queens.
- **Land and resources are biased.** Some regions are naturally richer in food, water and ore, and those fortunes drift over the decades. Better-nourished, better-armed realms are stronger.
- **War.** Kings declare war for granaries, rich lands or glory. Armies march, besiege and conquer. The winner becomes the **Capital of the World**, and smaller kingdoms form alliances to bring it down.
- **Kingdoms split.** Ambitious nobles break away and found new realms. Dynasties rise and fall, and conquered castles become ruins.
- **Weather is random and deadly.** Rain, snow, blizzards, thunderstorms with lightning, hurricanes, tornadoes, floods, droughts, heatwaves, windstorms, wildfires and plague all occur.

## Time
`1 real second = 1 world hour` by default. A day lasts 24 seconds and a year about 2.4 hours. Change it with the `HOURS_PER_SECOND` environment variable. Walking, working and fighting happen at watchable real-time speed.

## Run locally
```
npm install
npm start
```
Open http://localhost:3000. For a fast-forward test, use `npm run dev` (50 hours per second).

## Deploy on Render
1. Push this repo to GitHub.
2. In Render, choose **New → Blueprint** and pick this repo (it uses `render.yaml`), or create a **Web Service** with build command `npm install` and start command `npm start`.
3. Use the **Starter** plan or higher so the world never sleeps. On the free plan it sleeps after 15 minutes without visitors and restarts from two kingdoms.

The world currently restarts fresh when the server restarts. Saving and resuming is planned next.

## Controls
Scroll to zoom from the whole continent down to a single person. Left-drag pans, right-drag rotates. Click a person, castle or realm to inspect it. Double-click flies there. Click the minimap to jump anywhere.

## Environment variables
| Name | Default | Meaning |
|---|---|---|
| `HOURS_PER_SECOND` | 1 | World hours per real second |
| `MAX_POPULATION` | 4000 | Soft population cap (protects the server) |
| `WORLD_SEED` | 20261103 | Changes the shape of the continent |

## AI voices (optional, free with Groq)
People's conversations, kings' letters and the narrator can be written live by an AI model, using each character's real personality, memories and situation. The simulation still decides what happens; the AI only chooses the words. Without a key, built-in lines are used.

On Render → Environment, add:
| Name | Value |
|---|---|
| `GROQ_API_KEY` | your key from console.groq.com (keep it secret) |
| `GROQ_API_KEY_2` (optional, also `_3`, `_4`…) | extra Groq keys; the world spreads calls across them and fails over when one hits its daily limit |
| `LLM_MODEL` | optional, default `llama-3.1-8b-instant` (conversations) |
| `LLM_MODEL_BIG` | optional, default `llama-3.3-70b-versatile` (letters and narrator) |

It only calls the AI while someone is watching, and stays under a daily token budget sized for Groq's free tier. `/healthz` shows usage.

## Characters
Rigged characters from [Grab3D](https://grab3d.com) (CC0), compressed for the web. Animations come from Quaternius' Universal Animation Library (CC0), retargeted onto the Grab3D skeletons in the browser.
