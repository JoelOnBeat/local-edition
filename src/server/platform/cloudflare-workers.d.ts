/**
 * Minimal ambient types for the `cloudflare:workers` module, which only exists inside workerd. Enough for
 * the Durable Object and Workflow classes in this repo; swap for @cloudflare/workers-types if it is ever added.
 */
declare module "cloudflare:workers" {
  export interface DurableObjectStorage {
    get<T = unknown>(key: string): Promise<T | undefined>;
    put(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<boolean>;
  }
  export interface DurableObjectState {
    storage: DurableObjectStorage;
    waitUntil(promise: Promise<unknown>): void;
  }
  export abstract class DurableObject<Env = unknown> {
    protected ctx: DurableObjectState;
    protected env: Env;
    constructor(ctx: DurableObjectState, env: Env);
  }

  export interface WorkflowStepConfig {
    retries?: { limit: number; delay: string | number; backoff?: "constant" | "linear" | "exponential" };
    timeout?: string | number;
  }
  export interface WorkflowStep {
    do<T>(name: string, callback: () => Promise<T>): Promise<T>;
    do<T>(name: string, config: WorkflowStepConfig, callback: () => Promise<T>): Promise<T>;
    sleep(name: string, duration: string | number): Promise<void>;
  }
  export interface WorkflowEvent<Params> {
    payload: Readonly<Params>;
    timestamp: Date;
    instanceId: string;
  }
  export abstract class WorkflowEntrypoint<Env = unknown, Params = unknown> {
    protected ctx: unknown;
    protected env: Env;
    constructor(ctx: unknown, env: Env);
    abstract run(event: WorkflowEvent<Params>, step: WorkflowStep): Promise<unknown>;
  }
}
