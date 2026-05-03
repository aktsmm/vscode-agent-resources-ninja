import * as vscode from "vscode";

let outputChannel: vscode.OutputChannel | undefined;
let outputChannelDisposed = false;

function getOutputChannel(): vscode.OutputChannel {
  if (!outputChannel || outputChannelDisposed) {
    outputChannel = vscode.window.createOutputChannel("Agent Resources Ninja");
    outputChannelDisposed = false;
  }
  return outputChannel;
}

function stringifyValue(value: unknown): string {
  if (value instanceof Error) {
    return value.stack || value.message;
  }
  if (typeof value === "string") {
    return value;
  }
  try {
    return JSON.stringify(value) ?? String(value);
  } catch {
    return String(value);
  }
}

function formatMessage(message: unknown, details: unknown[]): string {
  const parts = [message, ...details].map(stringifyValue);
  return parts.join(" ");
}

export function registerLogger(context: vscode.ExtensionContext): void {
  getOutputChannel();
  context.subscriptions.push(
    new vscode.Disposable(() => {
      outputChannel?.dispose();
      outputChannel = undefined;
      outputChannelDisposed = true;
    }),
  );
}

function appendLine(line: string): void {
  try {
    getOutputChannel().appendLine(line);
  } catch {
    // Diagnostics must never break extension behavior.
  }
}

export const logger = {
  info(message: unknown, ...details: unknown[]): void {
    appendLine(formatMessage(message, details));
  },
  warn(message: unknown, ...details: unknown[]): void {
    appendLine(`WARN: ${formatMessage(message, details)}`);
  },
  error(message: unknown, ...details: unknown[]): void {
    appendLine(`ERROR: ${formatMessage(message, details)}`);
  },
};
