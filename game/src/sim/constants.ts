// All sim units: metres, seconds. Origin at pitch centre.
// Team 0 defends the -x goal and attacks +x in the first half.
export const PITCH_LENGTH = 105;
export const PITCH_WIDTH = 68;
export const HALF_LEN = PITCH_LENGTH / 2; // 52.5
export const HALF_WID = PITCH_WIDTH / 2; // 34

export const GOAL_HALF_WIDTH = 3.66;
export const GOAL_HEIGHT = 2.44;
export const GOAL_DEPTH = 2.0;

export const PENALTY_BOX_DEPTH = 16.5;
export const PENALTY_BOX_HALF_WIDTH = 20.16;
export const SIX_BOX_DEPTH = 5.5;
export const SIX_BOX_HALF_WIDTH = 9.16;
export const PENALTY_SPOT = 11;
export const CENTER_CIRCLE_R = 9.15;

export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

export const BALL_RADIUS = 0.11;
export const CONTROL_RADIUS = 1.05; // distance at which a player can take the ball
export const HEADER_MIN_Z = 1.55; // below this the ball is chested/volleyed, never headed
export const HEADER_MAX_Z = 2.3; // jumping-header ceiling
export const AERIAL_REACH_Z = 2.35; // above this no outfield player can play the ball
export const TOUCH_COOLDOWN = 0.3; // seconds between dribble touches

export const GRAVITY = -9.81 * 1.6; // slightly heavy ball = arcade snap
export const BALL_GROUND_FRICTION = 1.45; // m/s^2 rolling deceleration
export const BALL_AIR_DRAG = 0.12; // proportional drag in flight
export const BALL_RESTITUTION = 0.55;

export const PLAYER_RADIUS = 0.45;
