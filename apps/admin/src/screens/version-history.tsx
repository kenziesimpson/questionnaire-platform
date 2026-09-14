import { getRouteApi } from "@tanstack/react-router";
import { ScreenStub } from "./screen-stub";

const route = getRouteApi("/questionnaires/$questionnaireId/versions");

export function VersionHistoryScreen() {
  const { questionnaireId } = route.useParams();
  return (
    <ScreenStub title="Version history">
      <p className="font-mono text-xs text-muted-foreground">{questionnaireId}</p>
    </ScreenStub>
  );
}
