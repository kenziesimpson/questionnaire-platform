import { Aside, Lead, ScreenHeading, ScreenLayout, StatusBadge } from "./screen-layout.tsx";

export function LoadingScreen() {
  return (
    <ScreenLayout>
      <p role="status" className="text-sm text-muted-foreground">
        Loading questionnaire…
      </p>
    </ScreenLayout>
  );
}

export function ClosedScreen() {
  return (
    <ScreenLayout>
      <StatusBadge>
        <circle cx="12" cy="12" r="10" />
        <path d="m15 9-6 6" />
        <path d="m9 9 6 6" />
      </StatusBadge>
      <ScreenHeading title="This questionnaire is closed" />
      <Aside>If your clinic sent you this link, ask them for a current one.</Aside>
    </ScreenLayout>
  );
}

export function NotFoundScreen() {
  return (
    <ScreenLayout>
      <StatusBadge>
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
      </StatusBadge>
      <ScreenHeading title="Questionnaire not found">
        <Lead>This link does not lead to a questionnaire that is open for responses.</Lead>
      </ScreenHeading>
      <Aside>Check the link for typing mistakes. If your clinic sent it to you, ask them for a current one.</Aside>
    </ScreenLayout>
  );
}

export function EntryFailedScreen() {
  return (
    <ScreenLayout>
      <StatusBadge>
        <circle cx="12" cy="12" r="10" />
        <path d="M12 8v4" />
        <path d="M12 16h.01" />
      </StatusBadge>
      <ScreenHeading title="Something went wrong">
        <Lead>The questionnaire could not be loaded. Any answers saved on this device are kept.</Lead>
      </ScreenHeading>
      <Aside>Reload the page to try again.</Aside>
    </ScreenLayout>
  );
}
