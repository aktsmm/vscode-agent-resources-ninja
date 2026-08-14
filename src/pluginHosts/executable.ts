import { constants as fsConstants } from "fs";
import { access, readdir, stat } from "fs/promises";
import * as path from "path";

export async function findExecutableOnPath(
  baseName: string,
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  windowsExtensions?: readonly string[],
): Promise<string | undefined> {
  if (!/^[A-Za-z0-9._-]+$/.test(baseName)) {
    return undefined;
  }
  const executableNames = getExecutableCandidateNames(
    baseName,
    environment,
    platform,
    windowsExtensions,
  );
  const pathValue = environment.PATH || environment.Path || environment.path;
  if (!pathValue) {
    return undefined;
  }
  for (const directory of pathValue.split(path.delimiter)) {
    if (!directory) {
      continue;
    }
    for (const executableName of executableNames) {
      const candidate = path.join(
        directory.replace(/^"|"$/g, ""),
        executableName,
      );
      try {
        const candidateStat = await stat(candidate);
        if (!candidateStat.isFile()) {
          continue;
        }
        await access(
          candidate,
          platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK,
        );
        return candidate;
      } catch {
        // Continue searching PATH.
      }
    }
  }
  return undefined;
}

export function getExecutableCandidateNames(
  baseName: string,
  environment: NodeJS.ProcessEnv,
  platform: NodeJS.Platform,
  windowsExtensions?: readonly string[],
): string[] {
  if (platform !== "win32") {
    return [baseName];
  }
  if (path.extname(baseName)) {
    return [baseName];
  }
  const extensions =
    windowsExtensions ??
    (environment.PATHEXT || ".COM;.EXE;.BAT;.CMD").split(";");
  return Array.from(
    new Set(
      extensions
        .map((extension) => extension.trim())
        .filter(Boolean)
        .map((extension) =>
          extension.startsWith(".") ? extension : `.${extension}`,
        )
        .map((extension) => `${baseName}${extension.toLowerCase()}`),
    ),
  );
}

export async function findCodexExecutable(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  architecture: NodeJS.Architecture = process.arch,
): Promise<string | undefined> {
  return (await findCodexExecutableProbe(environment, platform, architecture))
    .executablePath;
}

export type CodexExecutableProbeReason =
  | "path"
  | "winget-link-not-on-path"
  | "winget-package-no-link"
  | "unsupported-winget-package"
  | "not-found";

export interface CodexExecutableProbe {
  executablePath?: string;
  source?: "path" | "winget-link" | "winget-package";
  aliasMissing: boolean;
  reason: CodexExecutableProbeReason;
}

async function isUsableFile(
  filePath: string,
  platform: NodeJS.Platform,
): Promise<boolean> {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile()) return false;
    await access(
      filePath,
      platform === "win32" ? fsConstants.F_OK : fsConstants.X_OK,
    );
    return true;
  } catch {
    return false;
  }
}

export async function findCodexExecutableProbe(
  environment: NodeJS.ProcessEnv = process.env,
  platform: NodeJS.Platform = process.platform,
  architecture: NodeJS.Architecture = process.arch,
): Promise<CodexExecutableProbe> {
  const fromPath = await findExecutableOnPath(
    "codex",
    environment,
    platform,
    platform === "win32" ? [".exe", ".com"] : undefined,
  );
  if (fromPath) {
    return {
      executablePath: fromPath,
      source: "path",
      aliasMissing: false,
      reason: "path",
    };
  }
  if (platform !== "win32") {
    return { aliasMissing: false, reason: "not-found" };
  }
  if (!environment.LOCALAPPDATA) {
    return { aliasMissing: true, reason: "not-found" };
  }

  const wingetRoot = path.join(environment.LOCALAPPDATA, "Microsoft", "WinGet");
  const linkPath = path.join(wingetRoot, "Links", "codex.exe");
  if (await isUsableFile(linkPath, platform)) {
    return {
      executablePath: linkPath,
      source: "winget-link",
      aliasMissing: true,
      reason: "winget-link-not-on-path",
    };
  }

  const packagesRoot = path.join(wingetRoot, "Packages");
  let packageRoots: string[];
  try {
    const packageEntries = await readdir(packagesRoot, { withFileTypes: true });
    packageRoots = packageEntries
      .filter(
        (entry) =>
          entry.isDirectory() &&
          /^OpenAI\.Codex_Microsoft\.Winget\.Source_/i.test(entry.name),
      )
      .map((entry) => path.join(packagesRoot, entry.name));
  } catch {
    return { aliasMissing: true, reason: "not-found" };
  }
  const candidates: Array<{
    executablePath: string;
    executableMtimeMs: number;
    packageMtimeMs: number;
  }> = [];
  const expectedArchitecture =
    architecture === "x64"
      ? "x86_64"
      : architecture === "arm64"
        ? "aarch64"
        : undefined;
  if (!expectedArchitecture) {
    return {
      aliasMissing: true,
      reason:
        packageRoots.length > 0 ? "unsupported-winget-package" : "not-found",
    };
  }
  for (const packageRoot of packageRoots) {
    try {
      const [entries, packageStat] = await Promise.all([
        readdir(packageRoot, { withFileTypes: true }),
        stat(packageRoot),
      ]);
      for (const entry of entries) {
        if (
          !entry.isFile() ||
          entry.name.toLowerCase() !==
            `codex-${expectedArchitecture}-pc-windows-msvc.exe`
        ) {
          continue;
        }
        const executablePath = path.join(packageRoot, entry.name);
        const executableStat = await stat(executablePath);
        candidates.push({
          executablePath,
          executableMtimeMs: executableStat.mtimeMs,
          packageMtimeMs: packageStat.mtimeMs,
        });
      }
    } catch {
      // One incomplete package directory must not hide another valid install.
    }
  }
  candidates.sort(
    (left, right) =>
      right.executableMtimeMs - left.executableMtimeMs ||
      right.packageMtimeMs - left.packageMtimeMs ||
      left.executablePath
        .toLowerCase()
        .localeCompare(right.executablePath.toLowerCase()),
  );
  const candidate = candidates[0];
  if (candidate && (await isUsableFile(candidate.executablePath, platform))) {
    return {
      executablePath: candidate.executablePath,
      source: "winget-package",
      aliasMissing: true,
      reason: "winget-package-no-link",
    };
  }
  return {
    aliasMissing: true,
    reason:
      packageRoots.length > 0 ? "unsupported-winget-package" : "not-found",
  };
}

export function canExecuteWithoutShell(
  executablePath: string,
  platform: NodeJS.Platform = process.platform,
): boolean {
  return platform !== "win32" || /\.(?:exe|com)$/i.test(executablePath);
}
