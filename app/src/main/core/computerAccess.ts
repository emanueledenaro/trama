import type { AccessPower } from "@shared/computerAccess";

/**
 * The one place the powers of computer access (network, browser, commands outside the project, screen) ask before they
 * act (ADR 0020, issue #413). The switch decides first: with it off nothing starts and what runs is stopped. The
 * powers that come later (issues #408 to #412) register through this gate and inherit the switch; the work on the
 * project's code never asks it.
 */

export type AccessDecision = { allowed: true } | { allowed: false; reason: "switchedOff" };

/** An action in progress that uses one of the powers: `stop` ends it at once and never throws. */
export interface RunningAccessAction {
  id: string;
  power: AccessPower;
  /** The agent that runs it, as the person sees it in Activity. */
  agent: string;
  /** What it does, in a few words for Activity. */
  label: string;
  stop: () => void | Promise<void>;
}

export class ComputerAccessGate {
  private readonly running = new Map<string, RunningAccessAction>();

  constructor(private readonly isOn: () => boolean) {}

  /** Whether a power may start now. A refusal is the caller's to record in Activity. */
  decide(_power: AccessPower): AccessDecision {
    return this.isOn() ? { allowed: true } : { allowed: false, reason: "switchedOff" };
  }

  /**
   * Registers an action that starts. Refused with the switch off; otherwise the returned function ends the
   * registration when the action finishes by itself.
   */
  begin(action: RunningAccessAction): { done: () => void } | null {
    if (!this.decide(action.power).allowed) return null;
    this.running.set(action.id, action);
    return { done: () => void this.running.delete(action.id) };
  }

  /** The actions in progress, oldest first. */
  actions(): RunningAccessAction[] {
    return [...this.running.values()];
  }

  /** The switch went off: stops every action in progress and returns them for Activity. */
  async stopAll(): Promise<RunningAccessAction[]> {
    const stopped = this.actions();
    this.running.clear();
    await Promise.all(
      stopped.map(async (action) => {
        try {
          await action.stop();
        } catch {
          // An action that cannot be stopped is already gone; the switch stays off for the next one.
        }
      }),
    );
    return stopped;
  }
}
