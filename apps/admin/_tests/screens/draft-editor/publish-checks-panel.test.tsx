import { componentAxeViolations, jsonResponse, problemResponse } from "@qp/ui/testing";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { smoke } from "../../support/builders";
import { deferred } from "../../support/http";
import { DRAFT_URL, PUBLISH_URL, VALIDATE_URL } from "../../support/routes";
import {
  aDraftOf,
  itemList,
  notes,
  perDay,
  placed,
  puts,
  renderEditor,
  rowOf,
  started,
  validations,
  type Validation,
} from "./harness";

afterEach(() => vi.restoreAllMocks());

const panel = () => screen.getByRole("region", { name: "Publish checks" });
const liveRegion = () => {
  const region = panel().querySelector('[aria-live="polite"]');
  if (region === null) throw new Error("no live region");
  return region;
};
const publishButton = () => screen.getByRole("button", { name: /^Publish(ing…)?$/ });

const failing = aDraftOf([
  placed("itm_per_day", perDay, {
    all: [{ type: "single_choice", itemId: "itm_smoke", op: "isAnyOf", optionIds: ["yes", "maybe"] }],
  }),
  placed("itm_smoke", smoke),
  placed("itm_started", started),
  placed("itm_notes", notes),
]);

const fourProblems: Validation = {
  valid: false,
  items: [
    { itemId: "itm_per_day", code: "predicate/forward-reference" },
    { itemId: "itm_per_day", code: "predicate/unknown-option" },
    { itemId: "itm_notes", code: "draft/question-version-unknown" },
    { itemId: "itm_gone", code: "draft/unreachable" },
  ],
};

function inOrder(...responses: (() => Response | Promise<Response>)[]) {
  return () => {
    const next = responses.length > 1 ? responses.shift() : responses[0];
    if (next === undefined) throw new Error("no validation response left");
    return next();
  };
}

function groupsShown() {
  return within(within(panel()).getByRole("list", { name: "Problems" }))
    .getAllByRole("listitem")
    .filter((group) => group.hasAttribute("data-problem-item"));
}

describe("the publish checks panel", () => {
  it("groups problems by question in item order, with catalogue titles and details and no codes in view", async () => {
    renderEditor({ draft: failing, validation: fourProblems });
    await itemList();

    expect(await within(panel()).findByText("4 problems")).toBeInTheDocument();
    expect(within(panel()).getByText("Fix 4 problems in 3 questions to publish.")).toBeInTheDocument();
    expect(groupsShown().map((group) => group.getAttribute("data-problem-item"))).toEqual(["itm_per_day", "itm_notes", "itm_gone"]);

    const [first, second, orphan] = groupsShown();
    if (first === undefined || second === undefined || orphan === undefined) throw new Error("expected three groups");
    expect(within(first).getByRole("button", { name: "Go to question 1, “How many a day?”" })).toBeInTheDocument();
    expect(Array.from(first.querySelectorAll("[data-code]"), (message) => message.getAttribute("data-code"))).toEqual([
      "predicate/forward-reference",
      "predicate/unknown-option",
    ]);
    expect(first).toHaveTextContent(
      "Rule uses a later questionA condition reads the answer to question 2, which now comes after this one. Rules can only use questions above. Move question 2 above this one, or change the condition in Rules.",
    );
    expect(first).toHaveTextContent("A condition on question 2, “Do you smoke?”, uses an option that its version 1 no longer has.");
    expect(within(second).getByRole("button", { name: "Go to question 4, “Anything else?”" })).toBeInTheDocument();
    expect(second).toHaveTextContent("Question version not found");
    expect(orphan).toHaveTextContent("A question no longer in this draft");
    expect(orphan).toHaveTextContent("Can never be reached");
    expect(within(orphan).queryByRole("button")).not.toBeInTheDocument();
    expect(panel()).not.toHaveTextContent(/predicate\/|draft\//);
    expect(panel()).toHaveTextContent("Rechecked after each saved change, with the same rules publishing uses.");

    expect(publishButton()).toBeDisabled();
    expect(publishButton()).toHaveAccessibleDescription("4 problems under Publish checks are blocking publishing.");
    await userEvent.click(screen.getByRole("button", { name: "Publish checks" }));
    expect(within(panel()).getByRole("heading", { name: "Publish checks" })).toHaveFocus();

    expect(await componentAxeViolations()).toEqual([]);
  });

  it("jumps to a rule problem with Rules open and focused, and to any other problem by focusing its named row", async () => {
    renderEditor({ draft: failing, validation: fourProblems });
    await itemList();
    await within(panel()).findByText("4 problems");

    await userEvent.click(within(panel()).getByRole("button", { name: "Go to question 1, “How many a day?”" }));
    expect(within(rowOf("itm_per_day")).getByRole("button", { name: "Rules for question 1" })).toHaveAttribute("aria-expanded", "true");
    expect(within(rowOf("itm_per_day")).getByRole("group", { name: "Rules for question 1" })).toHaveFocus();
    expect(rowOf("itm_per_day")).toHaveAttribute("data-jumped", "true");
    expect(groupsShown()[0]).toHaveAttribute("data-active", "true");

    await userEvent.click(within(panel()).getByRole("button", { name: "Go to question 4, “Anything else?”" }));
    expect(rowOf("itm_per_day")).not.toHaveAttribute("data-jumped");
    expect(rowOf("itm_notes")).toHaveFocus();
    expect(rowOf("itm_notes")).toHaveAccessibleName("Question 4, Anything else?");
    expect(within(rowOf("itm_notes")).getByRole("button", { name: "Rules for question 4" })).toHaveAttribute("aria-expanded", "false");
    expect(rowOf("itm_notes")).toHaveAttribute("data-jumped", "true");
    expect(groupsShown()[1]).toHaveAttribute("data-active", "true");

    await userEvent.click(within(rowOf("itm_per_day")).getByRole("button", { name: "Rules for question 1" }));
    expect(rowOf("itm_notes")).not.toHaveAttribute("data-jumped");
    expect(within(rowOf("itm_per_day")).getByRole("button", { name: "Rules for question 1" })).toHaveAttribute("aria-expanded", "false");
  });

  it("shows a first check, then checks that could not run with Publish waiting on them, and a retry that clears", async () => {
    const first = deferred<Response>();
    const retry = deferred<Response>();
    renderEditor({ overrides: { [`POST ${VALIDATE_URL}`]: inOrder(() => first.promise, () => retry.promise) } });
    await itemList();

    expect(within(panel()).getByText("Checking the draft…")).toBeInTheDocument();
    expect(within(panel()).queryByText(/problem|Ready/)).not.toBeInTheDocument();

    first.resolve(problemResponse("internal", { detail: "trace-1" }));
    expect(await within(panel()).findByText("The checks could not run, so publishing waits until they can.")).toBeInTheDocument();
    expect(within(panel()).getByText("Not run")).toBeInTheDocument();
    expect(publishButton()).toBeDisabled();
    expect(publishButton()).toHaveAccessibleDescription("Publishing waits until Publish checks can run.");
    expect(liveRegion()).toHaveTextContent("");

    await userEvent.click(within(panel()).getByRole("button", { name: "Run checks again" }));
    expect(await within(panel()).findByText("Checking the draft…")).toBeInTheDocument();
    retry.resolve(jsonResponse(200, { valid: true, items: [] }));

    expect(await within(panel()).findByText("No problems found. Publishing creates version 3.")).toBeInTheDocument();
    expect(within(panel()).getByText("Ready")).toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent("Publish checks: no problems. Ready to publish.");
    expect(publishButton()).toBeEnabled();
    expect(await componentAxeViolations()).toEqual([]);
  });

  it("keeps the last results while a change saves and rechecks, disables Publish, and announces only the new count", async () => {
    const recheck = deferred<Response>();
    const twoProblems: Validation = {
      valid: false,
      items: [
        { itemId: "itm_per_day", code: "predicate/forward-reference" },
        { itemId: "itm_notes", code: "draft/question-version-unknown" },
      ],
    };
    const { requests } = renderEditor({
      draft: failing,
      overrides: { [`POST ${VALIDATE_URL}`]: inOrder(() => jsonResponse(200, twoProblems), () => recheck.promise) },
    });
    await itemList();
    await within(panel()).findByText("2 problems");

    await userEvent.click(within(rowOf("itm_smoke")).getByRole("checkbox", { name: "Required" }));
    await waitFor(() => expect(puts(requests)).toHaveLength(1));
    await waitFor(() => expect(validations(requests)).toHaveLength(2));

    expect(within(panel()).getByText("Checking your latest change…")).toBeInTheDocument();
    expect(within(panel()).getByText("2 problems")).toBeInTheDocument();
    expect(within(panel()).getByRole("list", { name: "Problems" })).toHaveAttribute("aria-busy", "true");
    expect(groupsShown()).toHaveLength(2);
    expect(publishButton()).toBeDisabled();
    expect(publishButton()).toHaveAccessibleDescription("Publishing waits until Publish checks have run on the saved draft.");
    expect(liveRegion()).toHaveTextContent("");
    expect(await componentAxeViolations()).toEqual([]);

    recheck.resolve(jsonResponse(200, { valid: false, items: [{ itemId: "itm_per_day", code: "predicate/forward-reference" }] }));

    expect(await within(panel()).findByText("Fix 1 problem to publish.")).toBeInTheDocument();
    expect(within(panel()).getByText("1 problem")).toBeInTheDocument();
    expect(liveRegion()).toHaveTextContent("Publish checks: 1 fixed, 1 left.");
    expect(within(panel()).getByRole("list", { name: "Problems" })).not.toHaveAttribute("aria-busy");
    expect(publishButton()).toHaveAccessibleDescription("1 problem under Publish checks is blocking publishing.");
  });

  it("says an empty draft has no questions yet instead of Ready, and still lets it publish", async () => {
    renderEditor({ draft: aDraftOf([]) });

    expect(await within(await screen.findByRole("region", { name: "Publish checks" })).findByText("No problems found, but this draft has no questions yet.")).toBeInTheDocument();
    expect(within(panel()).queryByText("Ready")).not.toBeInTheDocument();
    expect(publishButton()).toBeEnabled();
  });

  it("on a publish refused as invalid shows the refused problems at once, moves focus to the panel heading, and points the notice at the panel", async () => {
    const refused = { valid: false, items: [{ itemId: "itm_notes", code: "draft/question-version-unknown" }] } as const;
    const recheck = deferred<Response>();
    renderEditor({
      overrides: {
        [`POST ${VALIDATE_URL}`]: inOrder(() => jsonResponse(200, { valid: true, items: [] }), () => recheck.promise),
        [`POST ${PUBLISH_URL}`]: () => problemResponse("questionnaire/draft-invalid", { items: [...refused.items] }),
      },
    });
    await itemList();
    await within(panel()).findByText("Ready");

    await userEvent.click(publishButton());

    const heading = within(panel()).getByRole("heading", { name: "Publish checks" });
    await waitFor(() => expect(heading).toHaveFocus());
    expect(within(panel()).getByText("1 problem")).toBeInTheDocument();
    expect(groupsShown().map((group) => group.getAttribute("data-problem-item"))).toEqual(["itm_notes"]);
    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("The draft was not published");
    expect(alert).toHaveTextContent("Publishing found 1 problem. It is listed under Publish checks.");
    expect(within(alert).queryByRole("listitem")).not.toBeInTheDocument();
    expect(alert).toHaveAttribute("data-problem", "questionnaire/draft-invalid");
    expect(alert).not.toHaveTextContent(/questionnaire\/|422/);
    expect(await componentAxeViolations()).toEqual([]);

    recheck.resolve(jsonResponse(200, refused));
    await within(panel()).findByText("Fix 1 problem to publish.");
    await userEvent.click(within(rowOf("itm_smoke")).getByRole("button", { name: "Rules for question 1" }));
    await userEvent.click(within(alert).getByRole("button", { name: "Show problems" }));
    expect(heading).toHaveFocus();
  });

  it("rechecks the draft after a stale conflict reloads someone else's version", async () => {
    let stale = false;
    const { requests } = renderEditor({
      overrides: {
        [`PUT ${DRAFT_URL}`]: () => {
          stale = true;
          return problemResponse("questionnaire/draft-stale");
        },
      },
    });
    await itemList();
    await within(panel()).findByText("Ready");
    expect(validations(requests)).toHaveLength(1);

    await userEvent.click(within(rowOf("itm_smoke")).getByRole("checkbox", { name: "Required" }));

    await screen.findByRole("alert");
    expect(stale).toBe(true);
    await waitFor(() => expect(validations(requests)).toHaveLength(2));
  });

  it("shows an option a many-option condition uses but its question no longer has as a disabled Unknown option, dropped by the next tick", async () => {
    const { requests } = renderEditor({
      draft: aDraftOf([
        placed("itm_smoke", smoke),
        placed("itm_notes", notes, { all: [{ type: "single_choice", itemId: "itm_smoke", op: "isAnyOf", optionIds: ["yes", "maybe"] }] }),
      ]),
    });
    await itemList();

    await userEvent.click(screen.getByRole("button", { name: "Rules for question 2" }));
    const operand = within(rowOf("itm_notes")).getByRole("group", { name: "Condition 1: value" });
    const unknown = within(operand).getByRole("checkbox", { name: "Unknown option" });
    expect(unknown).toBeChecked();
    expect(unknown).toBeDisabled();
    expect(within(operand).getByRole("checkbox", { name: "Yes" })).toBeDisabled();

    await userEvent.click(within(operand).getByRole("checkbox", { name: "No" }));
    await waitFor(() => expect(puts(requests)).toHaveLength(1));
    expect(puts(requests)[0]?.body).toMatchObject({
      items: [
        expect.anything(),
        expect.objectContaining({
          visibleWhen: { all: [{ type: "single_choice", itemId: "itm_smoke", op: "isAnyOf", optionIds: ["yes", "no"] }] },
        }),
      ],
    });
  });
});
