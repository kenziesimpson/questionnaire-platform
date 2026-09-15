import { getRouteApi } from "@tanstack/react-router";
import { ScreenStub } from "./screen-stub";

const route = getRouteApi("/questionnaires/$questionnaireId/draft");

export function DraftEditorScreen() {
  const { questionnaireId } = route.useParams();
  return (
    <ScreenStub title="Draft editor">
      <p className="font-mono text-xs text-muted-foreground">{questionnaireId}</p>
    </ScreenStub>
  );
}
