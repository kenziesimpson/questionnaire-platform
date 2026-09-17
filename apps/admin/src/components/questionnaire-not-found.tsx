import { Link } from "@tanstack/react-router";
import { Notice } from "./notice";

export function QuestionnaireNotFound() {
  return (
    <Notice>
      <p className="font-medium">This questionnaire does not exist.</p>
      <Link to="/questionnaires" activeOptions={{ exact: true }} className="font-medium underline underline-offset-4">
        Back to questionnaires
      </Link>
    </Notice>
  );
}
