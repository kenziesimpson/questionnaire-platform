import { Button } from "@qp/ui/primitives/button";
import { useState } from "react";
import { QuestionEditorDialog } from "./question-editor/question-editor-dialog";
import { ScreenStub } from "./screen-stub";

export function QuestionBankScreen() {
  const [creating, setCreating] = useState(false);
  return (
    <ScreenStub title="Question bank">
      <div className="pt-3">
        <Button type="button" onClick={() => setCreating(true)}>
          New question
        </Button>
      </div>
      <QuestionEditorDialog open={creating} onOpenChange={setCreating} onSaved={() => undefined} />
    </ScreenStub>
  );
}
