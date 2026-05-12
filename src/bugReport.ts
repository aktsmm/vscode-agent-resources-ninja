import * as vscode from "vscode";

export const BUG_REPORT_ISSUE_URL =
  "https://github.com/aktsmm/vscode-agent-resources-ninja/issues/new";

export function buildBugReportUrl(title: string, body: string): string {
  const params = new URLSearchParams();
  params.set("title", title);
  params.set("body", body);
  return `${BUG_REPORT_ISSUE_URL}?${params.toString()}`;
}

export async function openBugReport(title: string, body: string): Promise<void> {
  await vscode.env.openExternal(vscode.Uri.parse(buildBugReportUrl(title, body)));
}