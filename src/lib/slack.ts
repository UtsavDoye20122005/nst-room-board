// ============================================================
//  Posting booking updates to Slack, server side only.
//
//  Uses a Slack Incoming Webhook - a single URL from your workspace,
//  no bot install or OAuth needed. Set SLACK_WEBHOOK_URL to turn this
//  on; leave it unset and this quietly does nothing, same as email's
//  EMAIL_PROVIDER=console fallback. A booking never fails because
//  Slack is down or unset.
//
//  Admin-only: the caller (src/app/api/notify/route.ts) only invokes
//  this when the signed-in person is an admin - faculty can still
//  email staff, but cannot post to Slack. That's enforced there, not
//  here, but is worth knowing when reading this file.
//
//  Messages read as a plain announcement to students, not a system
//  log line - e.g. "M3 Lab for 1st Year Batch A will be conducted in
//  Classroom 5 today at 10:30 to 11:00." - matching how a teacher
//  would actually word it on the class Slack.
// ============================================================

export interface SlackMessageInput {
  kind: "booked" | "cancelled" | "moved" | "reinstated";
  subject: string;
  title: string;
  facultyName: string;
  roomName: string;
  previousRoomName?: string;
  /** "today" / "tomorrow" / "yesterday" / "on <full date>" - already
   *  resolved by the caller so this file doesn't need to know the
   *  server's timezone. */
  dayWord: string;
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
  const titlePart = t.title && t.title !== t.subject ? " (" + t.title + ")" : "";
  const subject = t.subject + titlePart;
  const forBatch = t.batchLabel ? " for " + t.batchLabel : "";
  const atTime = t.timeLabel ? " at " + t.timeLabel : "";

  let body: string;
  switch (t.kind) {
    case "cancelled":
      body =
        subject + forBatch + " cancelled for " + t.dayWord + "." +
        (t.reason ? " Reason: " + t.reason + "." : "");
      break;
    case "moved":
      body =
        subject + forBatch + " will now be conducted in " + t.roomName +
        (t.previousRoomName ? " instead of " + t.previousRoomName : "") +
        ", " + t.dayWord + atTime + ".\nPlease note the room change.";
      break;
    case "reinstated":
      body =
        subject + forBatch + " is back on and will be conducted in " + t.roomName +
        " as scheduled, " + t.dayWord + atTime + ".";
      break;
    default:
      body =
        subject + forBatch + " will be conducted in " + t.roomName +
        " " + t.dayWord + atTime + ".\nPlease take note of this.";
  }

  return "Students,\n" + body;
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
