import { problemCount } from "../../lib/counts";

export interface PublishHint {
  lead: string;
  linksToChecks: boolean;
  trail: string;
}

export function publishWaitsFor({
  saving,
  checking,
  checksFailed,
  problems,
}: {
  saving: boolean;
  checking: boolean;
  checksFailed: boolean;
  problems: number;
}): PublishHint | null {
  if (saving) return { lead: "Publishing waits until your changes are saved.", linksToChecks: false, trail: "" };
  if (checking) return { lead: "Publishing waits until ", linksToChecks: true, trail: " have run on the saved draft." };
  if (checksFailed) return { lead: "Publishing waits until ", linksToChecks: true, trail: " can run." };
  if (problems > 0) {
    return { lead: `${problemCount(problems)} under `, linksToChecks: true, trail: ` ${problems === 1 ? "is" : "are"} blocking publishing.` };
  }
  return null;
}
