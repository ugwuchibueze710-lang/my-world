# Neon Siege

First-person alien survival in a neon arena. Aliens pour out of the gate and floor rifts in endless waves — survive as long as you can.

- AK-74M in fully animated first-person arms: idle, walk, run, shot, draw, magazine-change reloads (the empty mag drops to the floor), aim down sights
- Crawlers, brutes and acid spitters; they get tougher every wave
- PS5 controller with Fortnite's default layout (R2 fire, L2 aim, ✕ jump, ○/R3 crouch, □ reload, △/R1/L1 weapons, L3 sprint), aim assist and rumble
- Mouse & keyboard: click fire, right-click aim, WASD, Shift, Space, C, R, 1-3
- Global leaderboard (saved to Redis when `REDIS_URL` is set)

`npm install && npm start` → http://localhost:3000

## Credits
- AK-74M & arms: "FPS AK-74m animations" (https://sketchfab.com/3d-models/fps-ak-74m-animations-94be8385c402474cacd39bc096c6ca14) by Cransh (https://sketchfab.com/ccransh), licensed under CC BY 4.0 (http://creativecommons.org/licenses/by/4.0/). Textures recompressed for the web.
- three.js (MIT). Fonts: Orbitron, JetBrains Mono (SIL OFL).
