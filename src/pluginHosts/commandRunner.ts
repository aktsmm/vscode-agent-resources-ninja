import { spawn } from "child_process";
import { realpath } from "fs/promises";
import {
  ExecutionCommandSpec,
  ExecutionIntentAuthority,
  MutationExecutor,
} from "./executionGate";
import { PluginHostAction, PluginHostId, PluginInstallScope } from "./types";

export interface PluginHostCommandResult {
  exitCode: number | null;
  stdout: string;
  stderr: string;
  error?: string;
  timedOut?: boolean;
  truncated?: boolean;
}

export interface PluginHostCommandRunner {
  run(args: readonly string[]): Promise<PluginHostCommandResult>;
}

export interface ApprovedCommandRunnerInput {
  authority: ExecutionIntentAuthority;
  executor: MutationExecutor;
  hostId: PluginHostId;
  action: PluginHostAction;
  scope?: PluginInstallScope;
  executablePath: string;
  executableVersion: string;
  cwd: string;
  environment: Readonly<Record<string, string>>;
  resourceIdentity: string;
  sourceOrigin: string;
  resolutionMode: "immutable" | "host-resolved" | "local-copy";
  targetPaths: readonly string[];
  readonlyCommands: readonly (readonly string[])[];
  mutationCommands: readonly (readonly string[])[];
  timeoutMs?: number;
  outputLimit?: number;
  resolveRealPath?: (value: string) => Promise<string>;
  readExecutableVersion?: (
    executablePath: string,
    options: {
      cwd: string;
      environment: Readonly<Record<string, string>>;
    },
  ) => Promise<string>;
  runProcess?: (
    executablePath: string,
    args: readonly string[],
    options: {
      cwd: string;
      environment: Readonly<Record<string, string>>;
      timeoutMs: number;
      outputLimit: number;
    },
  ) => Promise<PluginHostCommandResult>;
}

function commandKey(args: readonly string[]): string {
  return JSON.stringify(args);
}

export function createApprovedCommandRunner(
  input: ApprovedCommandRunnerInput,
): PluginHostCommandRunner {
  const timeoutMs = input.timeoutMs ?? 60_000;
  const outputLimit = input.outputLimit ?? 128 * 1024;
  const resolveRealPath = input.resolveRealPath ?? realpath;
  const runProcess = input.runProcess ?? runPluginHostProcess;
  const readExecutableVersion =
    input.readExecutableVersion ??
    (async (executablePath, options) => {
      const result = await runProcess(executablePath, ["--version"], {
        ...options,
        timeoutMs: Math.min(timeoutMs, 15_000),
        outputLimit: Math.min(outputLimit, 8 * 1024),
      });
      if (result.exitCode !== 0 || result.error || result.timedOut) {
        throw new Error(
          result.error ||
            result.stderr.trim() ||
            "Could not re-read plugin host version.",
        );
      }
      return result.stdout.trim().split(/\r?\n/, 1)[0];
    });
  const readonlyKeys = new Set(input.readonlyCommands.map(commandKey));
  const approvedMutations = new Map<
    string,
    ReturnType<ExecutionIntentAuthority["approve"]>
  >();

  for (const argv of input.mutationCommands) {
    const spec = createSpec(input, argv);
    approvedMutations.set(
      commandKey(argv),
      input.authority.approve(input.authority.prepare(spec)),
    );
  }

  return {
    async run(args: readonly string[]): Promise<PluginHostCommandResult> {
      const key = commandKey(args);
      if (readonlyKeys.has(key)) {
        return runProcess(input.executablePath, args, {
          cwd: input.cwd,
          environment: input.environment,
          timeoutMs,
          outputLimit,
        });
      }
      const intent = approvedMutations.get(key);
      if (!intent) {
        return {
          exitCode: null,
          stdout: "",
          stderr: "",
          error: "Plugin host command was not approved.",
        };
      }
      approvedMutations.delete(key);
      try {
        return await input.executor.execute(
          intent,
          async () => {
            const currentExecutablePath = await resolveRealPath(
              input.executablePath,
            );
            const currentVersion = await readExecutableVersion(
              currentExecutablePath,
              { cwd: input.cwd, environment: input.environment },
            );
            return createSpec(
              {
                ...input,
                executablePath: currentExecutablePath,
                executableVersion: currentVersion,
              },
              args,
            );
          },
          (approvedSpec) =>
            runProcess(approvedSpec.executablePath, approvedSpec.argv, {
              cwd: approvedSpec.cwd,
              environment: approvedSpec.environment,
              timeoutMs,
              outputLimit,
            }),
        );
      } catch (error) {
        return {
          exitCode: null,
          stdout: "",
          stderr: "",
          error: error instanceof Error ? error.message : String(error),
        };
      }
    },
  };
}

function createSpec(
  input: Omit<
    ApprovedCommandRunnerInput,
    "readonlyCommands" | "mutationCommands"
  >,
  argv: readonly string[],
): ExecutionCommandSpec {
  return {
    hostId: input.hostId,
    action: input.action,
    scope: input.scope,
    executablePath: input.executablePath,
    executableVersion: input.executableVersion,
    cwd: input.cwd,
    argv,
    environment: input.environment,
    resourceIdentity: input.resourceIdentity,
    sourceOrigin: input.sourceOrigin,
    resolutionMode: input.resolutionMode,
    targetPaths: input.targetPaths,
  };
}

export function runPluginHostProcess(
  executablePath: string,
  args: readonly string[],
  options: {
    cwd: string;
    environment: Readonly<Record<string, string>>;
    timeoutMs: number;
    outputLimit: number;
  },
): Promise<PluginHostCommandResult> {
  return new Promise((resolve) => {
    let stdout = "";
    let stderr = "";
    let truncated = false;
    let timedOut = false;
    let settled = false;
    const child = spawn(executablePath, [...args], {
      cwd: options.cwd,
      env: { ...options.environment },
      shell: false,
      windowsHide: true,
      stdio: ["ignore", "pipe", "pipe"],
    });
    const append = (current: string, chunk: Buffer): string => {
      if (current.length >= options.outputLimit) {
        truncated = true;
        return current;
      }
      const remaining = options.outputLimit - current.length;
      const text = chunk.toString("utf8");
      if (text.length > remaining) {
        truncated = true;
      }
      return current + text.slice(0, remaining);
    };
    child.stdout.on("data", (chunk: Buffer) => {
      stdout = append(stdout, chunk);
    });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = append(stderr, chunk);
    });
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill();
    }, options.timeoutMs);
    const finish = (result: PluginHostCommandResult): void => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeout(timer);
      resolve({ ...result, stdout, stderr, timedOut, truncated });
    };
    child.on("error", (error) => {
      finish({ exitCode: null, stdout, stderr, error: error.message });
    });
    child.on("close", (exitCode) => {
      finish({ exitCode, stdout, stderr });
    });
  });
}
