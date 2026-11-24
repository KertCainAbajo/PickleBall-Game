// Tutorial content. Each lesson can link to a practice drill or the scoring quiz.

export const LESSONS = [
  {
    id: 'court', title: 'The court', summary: 'Size, lines and the kitchen.',
    body: [
      'A pickleball court is <b>20 ft wide and 44 ft long</b>, the same for singles and doubles. The net is 36 in high at the sidelines and 34 in at the center.',
      'The <b>non-volley zone</b>, called the <b>kitchen</b>, is the 7 ft area on each side of the net. Its line counts as part of the kitchen.',
      'Behind each kitchen is a left and right <b>service court</b>, split by the centerline. Lines are in, except that a serve touching the kitchen line is a fault.',
    ],
  },
  {
    id: 'serve', title: 'Serving', summary: 'Diagonal, underhand, one attempt.', practice: 'serve',
    body: [
      'Serve <b>diagonally</b> into the opposite service court. It must clear the kitchen, so a serve landing on the kitchen line is a fault.',
      'Stand <b>behind the baseline</b>, between the centerline and the sideline of your side. In singles, serve from the right when your score is even and the left when it is odd.',
      'You may hit a <b>volley serve</b> straight out of your hand, or a <b>drop serve</b> after letting the ball bounce. You get <b>one attempt</b>, and you must serve within <b>10 seconds</b> of the score being called.',
      'In this game, shot keys volley-serve and the Drop key drops the ball first. Hold forward to serve deep, back to serve short, and left or right to aim wide or at the T.',
    ],
  },
  {
    id: 'twobounce', title: 'The two-bounce rule', summary: 'Serve and return must bounce.', practice: 'return',
    body: [
      'The receiving side must let the <b>serve</b> bounce before hitting it.',
      'The serving side must then let the <b>return</b> bounce before hitting it.',
      'After those two bounces anyone may volley, which means hitting the ball out of the air. Hitting the serve or the return early is a fault.',
      'This is why servers stay back at the baseline while receivers move up to the kitchen line after returning.',
    ],
  },
  {
    id: 'kitchen', title: 'Kitchen rules', summary: 'No volleys in the non-volley zone.', practice: 'volley',
    body: [
      'You may <b>not volley</b> while touching the kitchen or its line.',
      'If the <b>momentum</b> of a volley carries you into the kitchen, even after the ball is dead, that is a fault too.',
      'You <b>may</b> step into the kitchen to play a ball that has bounced. Dinks and groundstrokes in the kitchen are legal.',
    ],
  },
  {
    id: 'dink', title: 'Dinking and shots', summary: 'Dink, drive, lob, smash.', practice: 'dink',
    body: [
      '<b>Drive</b>: a fast, flat shot. Driving a ball that is near the ground, close to the net, often finds the net.',
      '<b>Soft (dink)</b>: a soft arc into the opponent’s kitchen. It forces them to hit up and is the key shot at the kitchen line.',
      '<b>Lob</b>: a high, deep shot over opponents who are at the net.',
      '<b>Smash</b>: press Drive on a high ball (above about 5 ft) for a fast downward put-away.',
      'Move so the ball passes about a paddle’s length beside you. The cleaner the contact, the more accurate the shot. Poor contact sends the ball wider and longer.',
    ],
  },
  {
    id: 'position', title: 'Court positioning', summary: 'Where to stand and when.', practice: 'position',
    body: [
      '<b>Serving side</b>: stay back after serving, because you must let the return bounce. After your third shot, move up.',
      '<b>Receiving side</b>: return deep, then move up to the kitchen line right away. Stop just behind it.',
      'Most points are won by the team that controls the kitchen line.',
    ],
  },
  {
    id: 'faults', title: 'Faults', summary: 'Everything that ends a rally.',
    body: [
      'A rally is lost by hitting <b>out</b> or <b>into the net</b>, letting the ball <b>bounce twice</b>, a <b>service fault</b> (wrong court, kitchen, out, illegal position or the 10-second rule), a <b>two-bounce</b> or <b>kitchen</b> violation, <b>touching the net</b>, or the ball <b>hitting a player</b> before it bounces out.',
    ],
  },
  {
    id: 'scoring', title: 'Scoring', summary: 'Side-out, doubles server numbers, rally.', quiz: true,
    body: [
      '<b>Traditional (side-out) scoring</b>: only the serving side scores. Games go to 11, win by 2.',
      '<b>Singles</b>: if the server loses the rally, it is a side-out. The score is called server-score, receiver-score, e.g. “4-2”.',
      '<b>Doubles</b>: both partners serve before a side-out, except at the start, which is called <b>0-0-2</b> because the first serving team gets only one server. When the server wins a point they switch sides with their partner. The call adds the server number: “4-2-1”.',
      'After a side-out, the player in the <b>right</b> court serves first.',
      '<b>Rally scoring</b>: every rally scores a point, for either side. Games are often played to 15 or 21, win by 2. In doubles each team has one serve per side-out. The serving team switches sides when it scores, and the server is the player in the court matching the team’s score: right when even, left when odd.',
    ],
  },
];
