import { Uuid } from "@qp/shared";
import { Value } from "typebox/value";

const QUESTIONNAIRE_PATH = /^\/q\/([^/]+)\/?$/;

function decodedSegment(segment: string): string | undefined {
  try {
    return decodeURIComponent(segment);
  } catch {
    return undefined;
  }
}

export function questionnaireIdFromPath(pathname: string): string | undefined {
  const segment = QUESTIONNAIRE_PATH.exec(pathname)?.[1];
  const questionnaireId = segment === undefined ? undefined : decodedSegment(segment);
  return questionnaireId !== undefined && Value.Check(Uuid, questionnaireId) ? questionnaireId : undefined;
}
