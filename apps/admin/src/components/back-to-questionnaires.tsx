import { ArrowLeftIcon } from "@qp/ui/icons";
import { Button } from "@qp/ui/primitives/button";
import { Link } from "@tanstack/react-router";

export function BackToQuestionnaires() {
  return (
    <Button asChild variant="ghost" size="icon-sm">
      <Link to="/questionnaires" activeOptions={{ exact: true }} aria-label="Back to questionnaires" title="Back to questionnaires">
        <ArrowLeftIcon size={18} aria-hidden="true" />
      </Link>
    </Button>
  );
}
