import { spawn } from "node:child_process";

export type Command = string[];

export interface CommandResult {
  exitCode: number;
  stdout: string;
  stderr: string;
}

export interface CommandPolicy {
  isAllowed(command: Command): boolean;
}

function isExactMatch(entry: ReadonlyArray<string>, command: Command): boolean {
  if (entry.length !== command.length) {
    return false;
  }

  for (let index = 0; index < entry.length; index += 1) {
    if (entry[index] !== command[index]) {
      return false;
    }
  }

  return true;
}

export class ExactCommandPolicy implements CommandPolicy {
  private readonly entries: ReadonlyArray<ReadonlyArray<string>>;

  constructor(entries: ReadonlyArray<ReadonlyArray<string>>) {
    this.entries = entries;
  }

  isAllowed(command: Command): boolean {
    return this.entries.some((entry) => isExactMatch(entry, command));
  }
}

type CommandRule = ReadonlyArray<string> | ((command: Command) => boolean);

class RuleBasedCommandPolicy implements CommandPolicy {
  private readonly rules: ReadonlyArray<CommandRule>;

  constructor(rules: ReadonlyArray<CommandRule>) {
    this.rules = rules;
  }

  isAllowed(command: Command): boolean {
    return this.rules.some((rule) =>
      typeof rule === "function" ? rule(command) : isExactMatch(rule, command)
    );
  }
}

function isSafeLineCountToken(token: string): boolean {
  if (!/^\d+$/.test(token)) {
    return false;
  }
  const count = Number(token);
  return Number.isInteger(count) && count >= 1 && count <= 500;
}

function isSafeRelativePathToken(token: string): boolean {
  if (token.length === 0 || token.startsWith("-")) {
    return false;
  }

  const normalized = token.replaceAll("\\", "/");
  if (normalized.startsWith("/")) {
    return false;
  }

  const segments = normalized.split("/");
  if (segments.some((segment) => segment === "..")) {
    return false;
  }

  return /^[a-zA-Z0-9._/@+-]+$/.test(normalized);
}

function isSafeReadCommand(command: Command): boolean {
  if (command.length === 2 && command[0] === "cat") {
    return isSafeRelativePathToken(command[1]);
  }

  if (command.length === 4 && (command[0] === "head" || command[0] === "tail")) {
    return (
      command[1] === "-n" &&
      isSafeLineCountToken(command[2]) &&
      isSafeRelativePathToken(command[3])
    );
  }

  return false;
}

function isSafeReadSliceCommand(command: Command): boolean {
  return (
    command.length === 3 &&
    (command[0] === "head" || command[0] === "tail") &&
    command[1] === "-n" &&
    isSafeLineCountToken(command[2])
  );
}

function splitPipeline(command: Command): Command[] | null {
  const segments: Command[] = [];
  let segmentStart = 0;

  for (let index = 0; index < command.length; index += 1) {
    if (command[index] !== "|") {
      continue;
    }
    if (index === segmentStart) {
      return null;
    }
    segments.push(command.slice(segmentStart, index));
    segmentStart = index + 1;
  }

  if (segmentStart === 0) {
    return null;
  }
  if (segmentStart >= command.length) {
    return null;
  }

  segments.push(command.slice(segmentStart));
  return segments;
}

function isSafeReadPipelineCommand(command: Command): boolean {
  const segments = splitPipeline(command);
  if (!segments) {
    return false;
  }
  if (segments.length < 2 || segments.length > 3) {
    return false;
  }
  if (!isSafeReadCommand(segments[0])) {
    return false;
  }
  for (const segment of segments.slice(1)) {
    if (!isSafeReadSliceCommand(segment)) {
      return false;
    }
  }
  return true;
}

function isPowerShellBinary(token: string): boolean {
  return token === "powershell" || token === "pwsh";
}

function isSafeWindowsReadCommand(command: Command): boolean {
  if (command.length >= 3 && command[0] === "cmd" && command[1] === "/c") {
    if (command.length === 3 && command[2] === "dir") {
      return true;
    }
    if (command.length === 4 && command[2] === "dir") {
      return isSafeRelativePathToken(command[3]);
    }
    if (command.length === 4 && command[2] === "type") {
      return isSafeRelativePathToken(command[3]);
    }
  }

  if (
    command.length >= 6 &&
    isPowerShellBinary(command[0]) &&
    command[1] === "-NoProfile" &&
    command[2] === "-Command" &&
    command[3] === "Get-Content" &&
    command[4] === "-Path" &&
    isSafeRelativePathToken(command[5])
  ) {
    if (command.length === 6) {
      return true;
    }

    if (
      command.length === 8 &&
      (command[6] === "-TotalCount" || command[6] === "-Tail") &&
      isSafeLineCountToken(command[7])
    ) {
      return true;
    }
  }

  return false;
}

export function createDefaultCommandPolicy(): CommandPolicy {
  const rules: CommandRule[] = [
    ["ls", "-la"],
    ["npm", "test"],
    ["npm", "run", "lint"],
    ["npm", "run", "build"],
    ["pnpm", "test"],
    ["pnpm", "lint"],
    ["pnpm", "build"],
    ["yarn", "test"],
    ["yarn", "lint"],
    ["yarn", "build"],
    isSafeReadCommand,
    isSafeReadPipelineCommand
  ];

  if (process.platform === "win32") {
    rules.push(isSafeWindowsReadCommand);
  }

  return new RuleBasedCommandPolicy(rules);
}

function resolveWindowsExecutable(binary: string): string {
  if (process.platform !== "win32") {
    return binary;
  }
  if (binary === "npm" || binary === "pnpm" || binary === "yarn" || binary === "code") {
    return `${binary}.cmd`;
  }
  return binary;
}

async function spawnCommand(
  repoRoot: string,
  command: Command,
  timeoutMs: number,
  stdinContent?: string
): Promise<CommandResult> {
  return new Promise<CommandResult>((resolve, reject) => {
    const child = spawn(resolveWindowsExecutable(command[0]), command.slice(1), {
      cwd: repoRoot,
      shell: false,
      env: process.env
    });

    let stdout = "";
    let stderr = "";
    const maxOutputSize = 200_000;
    let timedOut = false;

    const timer = setTimeout(() => {
      timedOut = true;
      child.kill("SIGTERM");
    }, timeoutMs);

    if (typeof stdinContent === "string") {
      child.stdin.write(stdinContent);
    }
    child.stdin.end();

    child.stdout.on("data", (chunk: Buffer | string) => {
      stdout += chunk.toString();
      if (stdout.length > maxOutputSize) {
        stdout = stdout.slice(-maxOutputSize);
      }
    });

    child.stderr.on("data", (chunk: Buffer | string) => {
      stderr += chunk.toString();
      if (stderr.length > maxOutputSize) {
        stderr = stderr.slice(-maxOutputSize);
      }
    });

    child.on("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });

    child.on("close", (exitCode) => {
      clearTimeout(timer);

      if (timedOut) {
        reject(new Error(`Command timed out after ${timeoutMs}ms: ${command.join(" ")}`));
        return;
      }

      resolve({
        exitCode: exitCode ?? 1,
        stdout,
        stderr
      });
    });
  });
}

export async function runAllowedCommand(
  repoRoot: string,
  command: Command,
  policy: CommandPolicy,
  timeoutMs = 120_000
): Promise<CommandResult> {
  if (command.length === 0) {
    throw new Error("Command is empty");
  }

  if (!policy.isAllowed(command)) {
    throw new Error(`Command is not allowed: ${command.join(" ")}`);
  }

  const pipeline = splitPipeline(command);
  if (!pipeline) {
    return spawnCommand(repoRoot, command, timeoutMs);
  }

  let pipedStdout = "";
  const stderrParts: string[] = [];
  let exitCode = 0;

  for (const [index, segment] of pipeline.entries()) {
    const result = await spawnCommand(
      repoRoot,
      segment,
      timeoutMs,
      index === 0 ? undefined : pipedStdout
    );
    pipedStdout = result.stdout;
    if (result.stderr) {
      stderrParts.push(result.stderr);
    }
    exitCode = result.exitCode;
    if (result.exitCode !== 0) {
      break;
    }
  }

  return {
    exitCode,
    stdout: pipedStdout,
    stderr: stderrParts.join("\n")
  };
}
