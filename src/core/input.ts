/** Device-independent input for one simulation step. */
export interface InputState {
  /** -1..1, forward positive. */
  forward: number;
  /** -1..1, right positive. */
  strafe: number;
  /** Radians of turn this step (mouse + keys). Positive = clockwise on the map. */
  turn: number;
  /** Radians of vertical look this step. Positive = up. */
  pitch: number;
  sprint: boolean;
  crouch: boolean;
  /** Held this step. */
  interact: boolean;
  /** Pressed this step (edge). */
  interactPressed: boolean;
  flashlightPressed: boolean;
  holdBreath: boolean;
  throwPressed: boolean;
}

export const idleInput = (): InputState => ({
  forward: 0,
  strafe: 0,
  turn: 0,
  pitch: 0,
  sprint: false,
  crouch: false,
  interact: false,
  interactPressed: false,
  flashlightPressed: false,
  holdBreath: false,
  throwPressed: false,
});
