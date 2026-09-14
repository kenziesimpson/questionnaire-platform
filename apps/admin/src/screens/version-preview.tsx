import { getRouteApi } from "@tanstack/react-router";
import { ScreenStub } from "./screen-stub";

const route = getRouteApi("/questionnaires/$questionnaireId/versions/$version");

export function VersionPreviewScreen() {
  const { questionnaireId, version } = route.useParams();
  return (
    <ScreenStub title={`Preview of version ${version}`}>
      <p className="font-mono text-xs text-muted-foreground">{questionnaireId}</p>
    </ScreenStub>
  );
}
