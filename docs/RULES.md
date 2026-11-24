# Rules implemented

Pickle Rally follows the USA Pickleball rulebook for the parts of the game it simulates. Each rule below lists where it is enforced and which test covers it. Tests live in `tests/engine.test.js`.

> I could not check this against the final 2026 rulebook text, so verify anything marked **assumption** if you need exact tournament compliance.

## Court

| Item | Value | Code |
| --- | --- | --- |
| Court | 20 × 44 ft, same for singles and doubles | `constants.js` `HALF_W`, `HALF_L` |
| Kitchen (non-volley zone) | 7 ft from the net on each side; the line belongs to the kitchen | `KITCHEN`, `inKitchen()` |
| Net | 36 in at the sidelines, 34 in at the center, posts 1 ft outside the sidelines | `netHeightAt()` |
| Service courts | Left and right of the centerline, between the kitchen line and the baseline | `courtX()` |
| Lines | A ball touching any line is in, except a serve touching the kitchen line | `match.js` `onBounce` |

## Scoring (`js/engine/scoring.js`)

### Traditional side-out scoring
- Only the serving side scores. Games go to 11 (15 and 21 can be chosen), win by 2.
- **Singles**: the server serves from the right when their score is even and the left when it's odd. Losing the rally is a side-out.
- **Doubles**: each partner serves before a side-out. The first serving team gets one server only, so the game starts at **0-0-2**.
  - When the serving team wins a point, the server switches sides with their partner and keeps serving.
  - When the first server loses a rally, the partner serves from where they stand (server 2). When server 2 loses a rally, it's a side-out.
  - After a side-out, the player in the right court serves first.
  - The score is called as serving score, receiving score, server number, e.g. `4-2-1`.

### Rally scoring
- Every rally scores a point for whichever side wins it. Games go to 11, 15 or 21, win by 2.
- Doubles uses one server per side-out. When the serving team wins a rally it scores and the server switches sides.
- When the receiving team wins a rally it scores, gets the serve and does not switch sides. The server is the player standing in the court that matches the team's new score: right when even, left when odd.
- The score is called as serving score, receiving score, e.g. `7-5`.
- **Assumption**: there is no "freeze" at game point. Some rally-scoring formats require the final point to be won on serve; that is not implemented.

### Matches
- A match is 1 game or best of 3.
- The team that received first in one game serves first in the next.

## Serving (`match.js` `serveContact`, `onBounce`)
- The serve must land diagonally in the opposite service court, past the kitchen line. Landing on the kitchen line, in the wrong service court or out is a fault.
- The server must be behind the baseline and between the centerline and the sideline of the correct side. Otherwise it's an illegal serving position.
- Volley serves and drop serves are both supported.
- **Assumption**: if a dropped ball isn't struck before its second bounce, the server simply re-drops it, with no fault.
- One serve attempt; there are no lets.
- **10-second rule**: the serve must be made within 10 seconds of the score being set. A countdown appears for the last 5 seconds.
- Underhand motion and below-the-waist contact are built into the serve animation and contact height, so they cannot be broken.

## Two-bounce rule
The receiving side must let the serve bounce, and the serving side must then let the return bounce. Hitting either one in the air is a `two_bounce` fault.

## Kitchen
- Volleying while touching the kitchen or its line is a `kitchen_volley` fault.
- After a volley, entering the kitchen within 0.8 s is a `kitchen_momentum` fault. This models momentum carrying a player in.
- Playing a ball inside the kitchen after it has bounced is legal.

## Other faults
| Fault | When |
| --- | --- |
| `out` | The first bounce after a shot is outside the opponents' court |
| `net` | The ball hits the net, or lands on the hitter's own side |
| `double_bounce` | The ball bounces twice on a side before that side returns it |
| `body_hit` | A live ball touches a player's body; that player's side loses the rally |
| `net_touch` | A player touches the net plane during a live rally |

Each side may contact the ball only once per shot, so partners can't both hit it.

## Not modeled
- Spin and air drag.
- Wind and lets.
- Paddle and equipment regulations.
- Timeouts and medical rules.
- Line-call disputes.
- Ending switches mid-game, which makes no difference to play here.
