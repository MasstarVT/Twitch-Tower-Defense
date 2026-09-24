# Twitch Tower Defense

Chat attacks, you defend. Viewers earn coins by chatting and spend them to send enemies down the path.
You build towers from a control panel on a second monitor. The game renders as a transparent OBS browser
source on top of your stream.

## Quick start

```bash
npm install
copy .env.example .env      # then edit TWITCH_CHANNEL
npm start
```

- Overlay (OBS browser source): `http://localhost:3000/overlay.html`
- Control panel (your second monitor): `http://localhost:3000/control.html`

Chat is read-only by default and needs no login. Set `TWITCH_BOT_USERNAME` and `TWITCH_OAUTH` in `.env`
if you want the game to reply in chat (for `!coins`, `!shop` etc). Without a bot token, replies show as
toasts on the overlay instead.

## OBS setup

1. Add a **Browser** source, URL `http://localhost:3000/overlay.html`, width **1920**, height **1080**.
2. Leave the custom CSS at its default (the page background is already transparent).
3. Check "Shutdown source when not visible" if you like; the game state lives on the server, so the
   overlay can be refreshed at any time without resetting the round.

To shrink or move the map on screen, edit the `overlay` block in `maps/default.json`
(`offsetX`, `offsetY`, `scale`, `pathOpacity`).

## Viewer commands

| Command | Effect |
| --- | --- |
| `!spawn <enemy> [count]` | Send enemies. `!spawn goblin 5` |
| `!rush` | Send five of the cheapest enemy |
| `!buff` | Heal all living enemies by 30% (60 coins) |
| `!coins` | Show your balance |
| `!shop` | List enemies and prices |
| `!top` | Top leakers this round and top spenders all-time |
| `!help` | Command list |

Enemies (defaults, see `config.json`):

| Enemy | Cost | Notes |
| --- | --- | --- |
| goblin | 10 | fast, weak |
| wolf | 20 | very fast |
| orc | 25 | tougher |
| knight | 40 | armored, costs 2 lives if it leaks |
| tank | 80 | slow, huge HP, 3 lives |
| boss | 250 | 5 lives |

Viewers earn 2 coins per message (15 s cooldown) and 10 coins every 5 minutes while active. If an enemy
they sent reaches the exit, they get 150% of its cost back. All of this is in the `economy` block of
`config.json`.

## Streamer side

- Gold starts at 150 and comes from kills plus 10 per minute.
- Towers: Archer (single target), Cannon (splash), Frost (slow), Tesla (chain lightning). Each has three
  levels. Selling refunds 70%.
- Keys on the control panel: `1`-`4` pick a tower, `Esc` or right-click cancels, hold `Shift` while
  placing to keep the tower selected for multiple builds.
- You start with 20 lives. At 0 the overlay shows "Chat wins" with the top leakers, then a fresh round
  starts automatically.

## Testing without Twitch

The control panel has a "Simulate chat" box that injects fake chat messages, plus quick buttons. The
`+coins` button grants the test user 500 coins. There are also dev endpoints:

```
POST /dev/chat   { "user": "Bob", "message": "!spawn boss" }
POST /dev/spawn  { "type": "tank", "user": "Bob" }
POST /dev/grant  { "user": "Bob", "coins": 500 }
GET  /dev/state
```

## Project layout

```
server/            Node: express + ws, Twitch chat (tmi.js), economy, commands
server/game/       authoritative simulation (map, enemies, towers, projectiles, snapshot)
public/            overlay.html, control.html and shared canvas renderer
public/assets/     sprites (atlas.json maps names to files; missing sprites fall back to shapes)
maps/              map definitions
config.json        all tuning: costs, stats, earn rates, caps
data/              viewers.json (coin balances), created at runtime
```

## Art

Sprites are from Kenney's CC0 "Tower Defense (Top-Down)" pack: https://kenney.nl/assets/tower-defense-top-down
