# Pickle Rally

A pickleball game for the browser, played to USA Pickleball rules. Singles and doubles, traditional side-out and rally scoring, AI opponents, practice drills, tournaments, tutorials, local two-player and online play.

- No build step: plain JavaScript modules and [PeerJS](https://peerjs.com/) for peer-to-peer online play.
- **Graphics** (Settings): *Realistic 3D* ([Three.js](https://threejs.org/), needs a hardware GPU) or *Lite 2D* (plain canvas, runs on anything). *Auto* picks 3D when the browser can use the graphics card, and falls back to 2D if 3D can't stay smooth.
- Realistic human players in 3D: add free Adobe Mixamo characters. See [assets/characters/README.md](assets/characters/README.md).
- No game server, so it hosts free on GitHub Pages, Netlify or Cloudflare Pages.

## Play locally

```sh
python -m http.server 8000
```

Open http://localhost:8000. Engine tests are at http://localhost:8000/tests/.

## Deploy free on GitHub Pages

1. Push to GitHub.
2. Go to **Settings → Pages → Deploy from a branch**, choose `main` and `/ (root)`, and save.
3. The game goes live at `https://<user>.github.io/<repo>/`. Each push to `main` redeploys it.

## Modes
- **Quick Match**: singles or doubles vs Beginner, Intermediate or Advanced AI.
- **Practice**: serving, returns, dinking, volleys and court-positioning drills with a ball machine.
- **Tournament**: an 8-player bracket (quarterfinal, semifinal, final) saved between visits.
- **Local Multiplayer**: two players on one keyboard, with AI partners in doubles.
- **Online**: host or join with a 5-letter room code or a link.
- **Tutorials**: lessons that launch matching drills, plus an interactive scoring quiz.
- **Statistics**: career record. **Settings**: sound, camera, graphics, landing marker, hints.

## Controls

| | Solo | Local P1 | Local P2 |
| --- | --- | --- | --- |
| Move / aim | WASD or arrows | WASD | Arrows |
| Drive (smash when the ball is high) | J or Space | F | `.` or Num 2 |
| Soft (dink) | K | G | `,` or Num 1 |
| Lob | L | R | `/` or Num 3 |
| Drop serve | H | Q | Enter or Num 0 |
| Pause | Esc or P | | |

Press a shot as the ball comes to you; the paddle makes contact as the ball reaches it. Movement keys held at contact aim the shot. On phones, use the joystick and the shot buttons in landscape.

## Documentation
- [docs/RULES.md](docs/RULES.md): the rules and scoring implemented, and where each is enforced.
- [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md): engine, renderer, data flow and online sync.
- [docs/TESTING.md](docs/TESTING.md): automated tests and the manual release checklist.

## Notes
- Online play needs a direct browser-to-browser connection. A few strict networks block this. Supporting them would need a TURN relay server.
- Keep the host's tab in front during online matches, because browsers pause background tabs.
