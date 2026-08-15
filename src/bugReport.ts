import * as vscode from "vscode";

export const BUG_REPORT_ISSUE_URL =
  "https://github.com/aktsmm/vscode-agent-resources-ninja/issues/new";
export const BUG_REPORT_URL_MAX_LENGTH = 7_500;
const BUG_REPORT_TITLE_MAX_LENGTH = 256;
const BUG_REPORT_TRUNCATION_NOTICE =
  "\n\n[Details truncated to fit GitHub issue URL limits.]";

function sliceWithoutBrokenSurrogate(value: string, maxLength: number): string {
  let end = Math.min(value.length, Math.max(0, maxLength));
  if (end > 0 && /[\uD800-\uDBFF]/.test(value.charAt(end - 1))) {
    end -= 1;
  }
  return value.slice(0, end);
}

function createBugReportUrl(title: string, body: string): string {
  const params = new URLSearchParams();
  params.set("title", title);
  params.set("body", body);
  return `${BUG_REPORT_ISSUE_URL}?${params.toString()}`;
}

export function buildBugReportUrl(title: string, body: string): string {
  const boundedTitle = sliceWithoutBrokenSurrogate(
    title,
    BUG_REPORT_TITLE_MAX_LENGTH,
  );
  const fullUrl = createBugReportUrl(boundedTitle, body);
  if (fullUrl.length <= BUG_REPORT_URL_MAX_LENGTH) {
    return fullUrl;
  }

  let low = 0;
  let high = body.length;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    const candidateBody = `${sliceWithoutBrokenSurrogate(body, middle)}${BUG_REPORT_TRUNCATION_NOTICE}`;
    if (
      createBugReportUrl(boundedTitle, candidateBody).length <=
      BUG_REPORT_URL_MAX_LENGTH
    ) {
      low = middle;
    } else {
      high = middle - 1;
    }
  }
  return createBugReportUrl(
    boundedTitle,
    `${sliceWithoutBrokenSurrogate(body, low)}${BUG_REPORT_TRUNCATION_NOTICE}`,
  );
}

export async function openBugReport(
  title: string,
  body: string,
): Promise<void> {
  await vscode.env.openExternal(
    vscode.Uri.parse(buildBugReportUrl(title, body)),
  );
}
