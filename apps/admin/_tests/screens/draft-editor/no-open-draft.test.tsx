import { jsonResponse, problemResponse } from "@qp/ui/testing";
import { screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { smoke } from "../../support/builders";
import { draftResponse } from "../../support/http";
import { DRAFT_URL, LIST_URL } from "../../support/routes";
import { aDraftOf, placed, promptsInOrder, renderEditor, summary } from "./harness";

afterEach(() => vi.restoreAllMocks());

describe("the draft editor, with no open draft", () => {
  it("offers to open the next one, which loads the editor", async () => {
    const opened = aDraftOf([placed("itm_smoke", smoke)]);
    const { requests } = renderEditor({
      overrides: {
        [`GET ${DRAFT_URL}`]: () => problemResponse("resource/not-found"),
        [`GET ${LIST_URL}`]: () => jsonResponse(200, [{ ...summary, hasDraft: false }]),
        [`POST ${DRAFT_URL}`]: () => draftResponse(opened, 1, 201),
      },
    });

    expect(await screen.findByText("Smoking history has no open draft.")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "Open the next draft" }));

    expect(await promptsInOrder()).toEqual(["Do you smoke?"]);
    expect(requests.some(({ method, url }) => method === "POST" && url === DRAFT_URL)).toBe(true);
  });

  it("says a questionnaire that is not listed does not exist", async () => {
    renderEditor({
      overrides: {
        [`GET ${DRAFT_URL}`]: () => problemResponse("resource/not-found"),
        [`GET ${LIST_URL}`]: () => jsonResponse(200, []),
      },
    });
    expect(await screen.findByText("This questionnaire does not exist.")).toBeInTheDocument();
  });
});
