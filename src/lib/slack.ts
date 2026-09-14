// ============================================================
//  Posting booking updates to Slack, server side only.
//
//  Uses Slack Incoming Webhooks - a plain URL per channel, no bot
//  install or OAuth needed. Two years, two channels: set
//  SLACK_WEBHOOK_URL_YEAR1 and SLACK_WEBHOOK_URL_YEAR2 to route each
//  booking's update to only the channel for the year(s) it's
//  actually for - a 1st Year class never reaches the 2nd Year
//  channel and vice versa. A booking that invites both years (e.g. a
//  combined exam) posts to both channels.
//
//  SLACK_WEBHOOK_URL (no year suffix) is an optional fallback for a
//  booking whose `years` is empty/unrecognised, or for a simpler
//  single-channel setup if you never split by year at all. Leave any
//  of the three unset and that channel is quietly skipped - this
//  never breaks a booking, same as email's EMAIL_PROVIDER=console
//  fallback.
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
  /** Which year(s) this booking is for - [1], [2] or [1, 2]. Decides
   *  which Slack channel(s) the message goes to. */
  years: number[];
  reason?: string;
}

export interface SlackResult {
  attempted: boolean;
  ok: boolean;
  error?: string;
}

/** Any channel configured at all, for the "is Slack set up?" checks. */
export function slackConfigured(): boolean {
  return Boolean(
    process.env.SLACK_WEBHOOK_URL || process.env.SLACK_WEBHOOK_URL_YEAR1 || process.env.SLACK_WEBHOOK_URL_YEAR2
  );
}

/** Which webhook URL(s) a booking with these years should reach. */
function webhookUrlsForYears(years: number[]): string[] {
  const y1 = process.env.SLACK_WEBHOOK_URL_YEAR1;
  const y2 = process.env.SLACK_WEBHOOK_URL_YEAR2;
  const fallback = process.env.SLACK_WEBHOOK_URL;

  const urls = new Set<string>();
  if (years.includes(1) && y1) urls.add(y1);
  if (years.includes(2) && y2) urls.add(y2);

  // Nothing matched a per-year channel - either `years` was empty/
  // unrecognised, or the matching per-year var isn't set up yet.
  // Fall back to the single generic channel so the update still goes
  // somewhere instead of silently vanishing.
  if (urls.size === 0 && fallback) urls.add(fallback);

  return Array.from(urls);
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
  const urls = webhookUrlsForYears(t.years);
  if (urls.length === 0) return { attempted: false, ok: false };

  const text = line(t);

  const outcomes = await Promise.all(
    urls.map(async (url) => {
      try {
        const res = await fetch(url, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ text }),
        });
        if (!res.ok) {
          const body = await res.text();
          return { ok: false, error: "Slack returned " + res.status + ": " + body.slice(0, 300) };
        }
        return { ok: true, error: undefined as string | undefined };
      } catch (e) {
        return { ok: false, error: e instanceof Error ? e.message : String(e) };
      }
    })
  );

  const failures = outcomes.filter((o) => !o.ok);
  return {
    attempted: true,
    ok: failures.length === 0,
    error: failures.length ? failures.map((f) => f.error).join(" | ") : undefined,
  };
}
