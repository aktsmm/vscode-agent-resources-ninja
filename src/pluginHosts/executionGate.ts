import { createHash, randomUUID } from "crypto";
import * as path from "path";
import { PluginHostAction, PluginHostId, PluginInstallScope } from "./types";

export interface ExecutionCommandSpec {
  hostId: PluginHostId;
  action: PluginHostAction;
  scope?: PluginInstallScope;
  executablePath: string;
  executableVersion: string;
  cwd: string;
  argv: readonly string[];
  environment: Readonly<Record<string, string>>;
  resourceIdentity: string;
  sourceOrigin: string;
  resolutionMode: "immutable" | "host-resolved" | "local-copy";
  targetPaths: readonly string[];
}

export interface PreparedExecutionIntent {
  readonly id: string;
  readonly fingerprint: string;
  readonly spec: ExecutionCommandSpec;
}

export interface ApprovedExecutionIntent extends PreparedExecutionIntent {
  readonly approved: true;
}

function cloneSpec(spec: ExecutionCommandSpec): ExecutionCommandSpec {
  return {
    ...spec,
    argv: [...spec.argv],
    environment: { ...spec.environment },
    targetPaths: [...spec.targetPaths],
  };
}

function stableSpec(spec: ExecutionCommandSpec): string {
  return JSON.stringify({
    ...spec,
    environment: Object.fromEntries(
      Object.entries(spec.environment).sort(([left], [right]) =>
        left.localeCompare(right),
      ),
    ),
  });
}

function fingerprint(spec: ExecutionCommandSpec): string {
  return createHash("sha256").update(stableSpec(spec), "utf8").digest("hex");
}

function freezeSpec(spec: ExecutionCommandSpec): ExecutionCommandSpec {
  Object.freeze(spec.argv);
  Object.freeze(spec.environment);
  Object.freeze(spec.targetPaths);
  return Object.freeze(spec);
}

function validateSpec(spec: ExecutionCommandSpec): void {
  if (!path.isAbsolute(spec.executablePath)) {
    throw new Error("Plugin host executable path must be absolute.");
  }
  if (!path.isAbsolute(spec.cwd)) {
    throw new Error("Plugin host working directory must be absolute.");
  }
  if (
    !spec.executableVersion.trim() ||
    !spec.resourceIdentity.trim() ||
    !spec.sourceOrigin.trim()
  ) {
    throw new Error("Plugin host execution identity is incomplete.");
  }
  if (spec.targetPaths.some((target) => !path.isAbsolute(target))) {
    throw new Error("Plugin host target paths must be absolute.");
  }
}

export function buildSanitizedEnvironment(
  source: NodeJS.ProcessEnv,
  allowedKeys: readonly string[],
): Record<string, string> {
  const environment: Record<string, string> = {};
  for (const key of allowedKeys) {
    const value = source[key];
    if (typeof value === "string") {
      environment[key] = value;
    }
  }
  return environment;
}

export class ExecutionIntentAuthority {
  private readonly prepared = new WeakSet<object>();
  private readonly approved = new WeakSet<object>();
  private readonly consumed = new WeakSet<object>();

  prepare(specInput: ExecutionCommandSpec): PreparedExecutionIntent {
    const spec = cloneSpec(specInput);
    validateSpec(spec);
    const intent = Object.freeze({
      id: randomUUID(),
      fingerprint: fingerprint(spec),
      spec: freezeSpec(spec),
    });
    this.prepared.add(intent);
    return intent;
  }

  approve(intent: PreparedExecutionIntent): ApprovedExecutionIntent {
    if (!this.prepared.has(intent)) {
      throw new Error("Execution intent was not prepared by this authority.");
    }
    const approved = Object.freeze({ ...intent, approved: true as const });
    this.approved.add(approved);
    return approved;
  }

  consume(
    intent: ApprovedExecutionIntent,
    observedSpecInput: ExecutionCommandSpec,
  ): ExecutionCommandSpec {
    if (!this.approved.has(intent)) {
      throw new Error("Plugin host mutation requires an approved intent.");
    }
    if (this.consumed.has(intent)) {
      throw new Error("Approved execution intent has already been consumed.");
    }
    const observedSpec = cloneSpec(observedSpecInput);
    validateSpec(observedSpec);
    if (fingerprint(observedSpec) !== intent.fingerprint) {
      throw new Error("Plugin host execution changed after approval.");
    }
    this.consumed.add(intent);
    return intent.spec;
  }
}

export class MutationExecutor {
  constructor(private readonly authority: ExecutionIntentAuthority) {}

  async execute<T>(
    intent: ApprovedExecutionIntent,
    observeImmediatelyBeforeExecution: () => Promise<ExecutionCommandSpec>,
    operation: (spec: ExecutionCommandSpec) => Promise<T>,
  ): Promise<T> {
    const observedSpec = await observeImmediatelyBeforeExecution();
    const approvedSpec = this.authority.consume(intent, observedSpec);
    return operation(approvedSpec);
  }
}
