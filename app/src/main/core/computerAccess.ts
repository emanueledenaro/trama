import { isBlockedAddress } from "@shared/blockedSites";
import { roleMayUse, type AccessPower } from "@shared/computerAccess";
import type { TeamRole } from "@shared/domain";

/**
 * The one place the powers of computer access (network, browser, commands outside the project, screen) ask before they
 * act (ADR 0020, issue #413). The switch decides first: with it off nothing starts and what runs is stopped. The
 * powers that come later (issues #408 to #412) register through this gate and inherit the switch; the work on the
 * project's code never asks it.
 */

export type AccessDecision = { allowed: true } | { allowed: false; reason: "switchedOff" | "roleNotAllowed" | "blockedSite" };

/** An action in progress that uses one of the powers: `stop` ends it at once and never throws. */
export interface RunningAccessAction {
  id: string;
  power: AccessPower;
  /** The agent that runs it, as the person sees it in Activity. */
  agent: string;
  /** What it does, in a few words for Activity. */
  label: string;
  /** The role that runs it: the power must be one of its own. */
  role?: TeamRole;
  stop: () => void | Promise<void>;
}

export class ComputerAccessGate {
  private readonly running = new Map<string, RunningAccessAction>();

  constructor(
    private readonly isOn: () => boolean,
    private readonly blockedSites: () => readonly string[] = () => [],
  ) {}

  /**
   * Whether an address leads to a site the person blocked (ADR 0020, issue #414). It holds for every power that reaches
   * a site, in every project, and for every step: the first address, a redirect and a link. A consent never lifts it.
   */
  isBlocked(address: string | URL): boolean {
    return isBlockedAddress(address, this.blockedSites());
  }

  /**
   * Whether a power may start now, for the role that asks (when given) and the address it goes to (when it goes to a
   * site). The switch decides first, then the role, then the blocked sites. A refusal is the caller's to record in
   * Activity. The mandate never enters: it neither grants nor takes the access.
   */
  decide(power: AccessPower, role?: TeamRole, address?: string | URL): AccessDecision {
    if (!this.isOn()) return { allowed: false, reason: "switchedOff" };
    if (role && !roleMayUse(power, role)) return { allowed: false, reason: "roleNotAllowed" };
    if (address !== undefined && this.isBlocked(address)) return { allowed: false, reason: "blockedSite" };
    return { allowed: true };
  }

  /**
   * Registers an action that starts. Refused with the switch off; otherwise the returned function ends the
   * registration when the action finishes by itself.
   */
  begin(action: RunningAccessAction): { done: () => void } | null {
    if (!this.decide(action.power, action.role).allowed) return null;
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
