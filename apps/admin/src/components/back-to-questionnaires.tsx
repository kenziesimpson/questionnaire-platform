import { Button } from "@qp/ui/primitives/button";
import { Link } from "@tanstack/react-router";
import { ArrowLeftIcon } from "./icons";

export function BackToQuestionnaires() {
  return (
    <Button asChild variant="ghost" size="icon-sm">
      <Link to="/questionnaires" aria-label="Back to questionnaires" title="Back to questionnaires">
        <ArrowLeftIcon />
      </Link>
    </Button>
  );
}
