// Court geometry and physical constants. Units: feet, seconds.
// World axes: x = across the court (sidelines at ±10), y = up, z = along the
// court (baselines at ±22, net at z = 0). Team 0 plays the +z half (near the
// default camera) and faces -z; team 1 plays the -z half and faces +z.

export const HALF_W = 10;            // 20 ft wide court
export const HALF_L = 22;            // 44 ft long court
export const KITCHEN = 7;            // non-volley zone depth from the net

export const NET_CENTER_H = 34 / 12; // 34 in at the center
export const NET_POST_H = 36 / 12;   // 36 in at the sidelines
export const NET_HALF_SPAN = 11;     // posts 1 ft outside each sideline

export const BALL_R = 0.121;         // 2.9 in diameter ball
export const G = 32.17;              // gravity
export const BOUNCE_E = 0.66;        // vertical restitution
export const BOUNCE_F = 0.8;         // horizontal speed kept on a bounce

export const MAX_SPEED = 14.5;       // player top speed
export const ACCEL = 110;            // player acceleration (snappy, responsive movement)
export const REACH = 3.4;            // max horizontal distance for paddle contact
export const SWEET = 1.7;            // ideal horizontal contact distance
export const BODY_R = 0.5;           // ball closer than this hits the body
export const FOOT = 0.25;            // foot reach used for line contact
export const NET_TOUCH_Z = 0.55;     // player this close to the net plane touches it
export const SMASH_H = 5.3;          // contact above this turns a drive into a smash

export const SWING_WINDOW = 0.42;    // time a swing can make contact
export const SWING_ANIM = 0.38;      // visual swing duration
export const SERVE_CLOCK = 10;       // 10-second serving rule
export const MOMENTUM_WINDOW = 0.8;  // after a volley, entering the kitchen this soon is a fault

export const SHOT_KINDS = ['drive', 'dink', 'lob'];

/** z sign of a team's half (+1 for team 0, -1 for team 1). */
export const teamZ = team => (team === 0 ? 1 : -1);

/** x sign of a team's right ('R') or left ('L') service court, from that team's view. */
export const courtX = (team, court) => (court === 'R' ? 1 : -1) * (team === 0 ? 1 : -1);

/** Net top height at a given x (it sags toward the middle). */
export const netHeightAt = x =>
  NET_CENTER_H + (NET_POST_H - NET_CENTER_H) * Math.min(1, Math.abs(x) / NET_HALF_SPAN);

/** A player is "in the kitchen" when touching the zone or its line. */
export const inKitchen = z => Math.abs(z) <= KITCHEN + FOOT;

export const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
