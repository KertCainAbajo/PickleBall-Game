# Testing

## Running the engine tests

```sh
python -m http.server 8000
```

Open http://localhost:8000/tests/. The page runs every test in the browser and shows pass or fail for each. The tab title becomes `PASS n/n` or `FAIL n/n`.

To run headless, for example in CI:

```sh
chrome --headless=new --virtual-time-budget=120000 --dump-dom http://localhost:8000/tests/index.html | grep -o "[0-9]*/[0-9]* passed"
```

## What is covered (`tests/engine.test.js`)

| Area | Tests |
| --- | --- |
| Traditional scoring | only the server scores; side-outs; score call |
| Win by two | 11-10 continues, 12-10 wins; rally scoring to 21 |
| Doubles start | the game starts at 0-0-2; the first fault is an immediate side-out to server 1 |
| Server rotation | a point switches the server's side; server 2; side-out; the right-court player serves first |
| Receiver | always diagonal to the server |
| Singles positions | even score serves from the right, odd from the left |
| Rally scoring | receivers score and take the serve; doubles server stands in the court matching the score |
| Two-bounce rule | volleying the serve is a fault |
| Kitchen | volley in the kitchen is a fault; volley behind the line is legal; momentum fault; groundstroke inside the kitchen is legal |
| Serves | kitchen-line serve is a fault; just past the line is legal; wrong court; out; baseline is in; wrong side of the centerline; 10-second rule |
| Rally faults | out of bounds, double bounce, net, net touch, ball hitting a player |
| Match completion | AI vs AI best-of-3 singles, side-out doubles and rally-scoring doubles all finish with valid final scores |
| Rotation invariant | in a full doubles match, after every rally the player who started on the right is in the right court exactly when the team's score is even |
| AI fairness | AI vs AI matches produce no two-bounce, kitchen-volley, serve-position, 10-second or service-placement faults |
| Determinism | the same shot always lands in the same spot |

## Manual checklist before release
1. Quick Match: singles and doubles, both scoring systems, best of 3. The scorebug shows server number 2 at 0-0-2 in doubles.
2. Practice: all five drills count attempts, successes and streaks.
3. Tournament: play a round, check the bracket advances, abandon, then start a new one.
4. Local Multiplayer: both keyboard layouts work, and P2 serves with `.`, `,`, `/` or Enter.
5. Online: host in one browser and join from another with the code and with the link. Play a point, rematch, and leave, which should return the other player to the menu.
6. Tutorials: every "Try it" button opens its drill. The quiz checks answers.
7. Statistics update after a match. Reset clears them.
8. Settings persist after a reload, including name, color, volume, marker, hints, camera and graphics.
9. Phone in landscape: joystick and shot buttons work; the HUD fits.
