/**
 * Path switcher: send AI requests directly when the network allows it, and
 * switch to a store-and-forward fallback through our own API when it doesn't.
 *
 * The problem: some customers' VPNs, proxies or firewalls block the AI
 * provider's domain, or the long-lived connections streaming needs. Forcing
 * traffic through isn't an option. The client should work inside the network
 * it's in: detect the block, switch to a path the network already allows, and
 * switch back when the block clears.
 *
 * Fallback path: the client writes the request as a job through our API (a
 * domain the customer already allows), a server-side worker calls the model,
 * and the client polls for the result. Slower, but it gets through.
 * Dependencies: none.
 */

export type Route = 'direct' | 'fallback';

export interface SwitchEvent {
  from: Route;
  to: Route;
  /** Why we switched: the error that caused it, or a successful probe. */
  cause: string;
  at: number;
}

export interface SwitcherDeps<Req, Res> {
  /** Calls the AI path directly. Must reject within `timeoutMs`. */
  callDirect(req: Req, timeoutMs: number): Promise<Res>;
  /** Writes the request as a job through our own API; returns the job id. */
  enqueue(req: Req): Promise<string>;
  /** Polls the job until it has a result. */
  waitForResult(jobId: string): Promise<Res>;
  /** Cheap check: can we reach the direct path right now? */
  probe(): Promise<boolean>;
  /**
   * True for errors that mean "the network blocked us": timeouts, connection
   * resets, proxy refusals. Only these trigger a switch.
   */
  isNetworkBlock(err: unknown): boolean;
  clock: { now(): number };
  /** How often to check whether the direct path is open again. Default 60 s. */
  reprobeMs?: number;
  /** Direct call timeout. Default 1.5 s: long enough for a healthy call to start, short enough to fail over fast. */
  directTimeoutMs?: number;
  /** Called on every switch, for logs and metrics. Must not throw. */
  onSwitch?(event: SwitchEvent): void;
}

export interface PathSwitcher<Req, Res> {
  send(req: Req): Promise<{ route: Route; res: Res }>;
  /** The route the next request will try first. */
  current(): Route;
}

/**
 * Creates a switcher. One per client session or process.
 *
 * Only network blocks trigger a switch. A provider error, such as a rate limit
 * or a bad request, is rethrown: sending it the long way round wouldn't fix
 * it, and it would hide the real problem.
 *
 * @param deps - Transport functions, error classifier, clock and settings.
 * @returns `send` and `current`.
 * @throws From `send`: provider errors from the direct path, and any error
 *   from the fallback path (there is nowhere further to fall back to).
 */
export function createPathSwitcher<Req, Res>(deps: SwitcherDeps<Req, Res>): PathSwitcher<Req, Res> {
  const reprobeMs = deps.reprobeMs ?? 60_000;
  const timeoutMs = deps.directTimeoutMs ?? 1_500;
  let route: Route = 'direct';
  let lastProbe = 0;
  // One probe at a time: a burst of requests must not become a burst of probes.
  let probing: Promise<void> | null = null;

  function switchTo(to: Route, cause: string) {
    if (route === to) return;
    const event = { from: route, to, cause, at: deps.clock.now() };
    route = to;
    try {
      deps.onSwitch?.(event);
    } catch {
      // A broken metrics hook must not break requests.
    }
  }

  function maybeReprobe(): Promise<void> | null {
    if (route !== 'fallback' || deps.clock.now() - lastProbe < reprobeMs) return probing;
    if (probing) return probing;
    lastProbe = deps.clock.now();
    probing = deps
      .probe()
      .then((ok) => {
        if (ok) switchTo('direct', 'probe succeeded');
      })
      .catch(() => {
        // A failed probe means "still blocked": stay on the fallback.
      })
      .finally(() => {
        probing = null;
      });
    return probing;
  }

  async function send(req: Req): Promise<{ route: Route; res: Res }> {
    await maybeReprobe();

    if (route === 'direct') {
      try {
        return { route: 'direct', res: await deps.callDirect(req, timeoutMs) };
      } catch (err) {
        if (!deps.isNetworkBlock(err)) throw err;
        switchTo('fallback', err instanceof Error ? err.message : String(err));
        lastProbe = deps.clock.now();
        // Fall through: retry this same request on the fallback, so the user still gets an answer.
      }
    }

    const jobId = await deps.enqueue(req);
    return { route: 'fallback', res: await deps.waitForResult(jobId) };
  }

  return { send, current: () => route };
}
