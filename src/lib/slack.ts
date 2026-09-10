// ============================================================
//  Posting booking updates to Slack, server side only.
//
//  Uses a Slack Incoming Webhook - a single URL from your workspace,
//  no bot install or OAuth needed. Set SLACK_WEBHOOK_URL to turn this
//  on; leave it unset and this quietly does nothing, same as email's
//  EMAIL_PROVIDER=console fallback. A booking never fails because
//  Slack is down or unset.
// ============================================================

export interface SlackMessageInput {
  kind: "booked" | "cancelled" | "moved" | "reinstated";
  subject: string;
  title: string;
  facultyName: string;
  roomName: string;
  previousRoomName?: string;
  dateLabel: string;
  timeLabel: string;
  batchLabel: string;
  reason?: string;
}

export interface SlackResult {
  attempted: boolean;
  ok: boolean;
  error?: string;
}

export function slackConfigured(): boolean {
  return Boolean(process.env.SLACK_WEBHOOK_URL);
}

function line(t: SlackMessageInput): string {
  const emoji =
    t.kind === "cancelled" ? "\u{1F534}" : t.kind === "moved" ? "\u{1F501}" : t.kind === "reinstated" ? "\u{1F7E2}" : "\u{1F4CC}";

  const what =
    t.kind === "cancelled"
      ? "*cancelled*"
      : t.kind === "moved"
        ? "*moved*" + (t.previousRoomName ? " from " + t.previousRoomName : "") + " to *" + t.roomName + "*"
        : t.kind === "reinstated"
          ? "*back on*, in *" + t.roomName + "*"
          : "*booked* in *" + t.roomName + "*";

  const titlePart = t.title && t.title !== t.subject ? " (" + t.title + ")" : "";

  return (
    emoji + " " + t.subject + titlePart + " with " + t.facultyName + " is " + what + "\n" +
    t.dateLabel + " · " + t.timeLabel + (t.batchLabel ? " · " + t.batchLabel : "") +
    (t.reason ? "\n" + "Reason: " + t.reason : "")
  );
}

export async function sendSlackMessage(t: SlackMessageInput): Promise<SlackResult> {
  const url = process.env.SLACK_WEBHOOK_URL;
  if (!url) return { attempted: false, ok: false };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ text: line(t) }),
    });
    if (!res.ok) {
      const body = await res.text();
      return { attempted: true, ok: false, error: "Slack returned " + res.status + ": " + body.slice(0, 300) };
    }
    return { attempted: true, ok: true };
  } catch (e) {
    return { attempted: true, ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
