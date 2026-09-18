import { axeViolations } from "@qp/ui/testing";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";
import { aBankQuestion, smoke } from "./support/builders";
import { fakeDefinitionApi } from "./support/http";
import { renderAppAt } from "./support/render-app";

afterEach(() => vi.restoreAllMocks());

function renderApp() {
  const api = fakeDefinitionApi({ bank: [aBankQuestion(smoke)] });
  const { router, container } = renderAppAt("/questionnaires");
  return { ...api, router, container };
}

async function landOn(heading: string) {
  return screen.findByRole("heading", { level: 1, name: heading });
}

async function expectNoAxeViolations(container: HTMLElement) {
  expect(await axeViolations(container)).toEqual([]);
}

function currentNav() {
  return within(screen.getByRole("navigation", { name: "Main" }))
    .getAllByRole("link")
    .filter((link) => link.getAttribute("aria-current") === "page")
    .map((link) => link.textContent);
}

function pageLinksMarkedCurrent() {
  return within(screen.getByRole("main"))
    .queryAllByRole("link")
    .filter((link) => link.hasAttribute("aria-current"));
}

async function waitForPublishable() {
  const checks = await screen.findByRole("region", { name: "Publish checks" });
  await within(checks).findByText(/No problems found/);
  const publish = screen.getByRole("button", { name: "Publish" });
  await waitFor(() => expect(publish).toBeEnabled());
  return publish;
}

describe("the authoring flow, across every screen", () => {
  it("creates a questionnaire, builds and publishes its draft, then reaches the version from history and from the bank, with focus back on Add question after each pick", async () => {
    const { router, container, requests } = renderApp();
    const path = () => router.state.location.pathname;

    await landOn("Questionnaires");
    expect(await screen.findByText("No questionnaires yet")).toBeInTheDocument();
    expect(document.title).toBe("Questionnaires · Questionnaire admin");
    await expectNoAxeViolations(container);

    await userEvent.click(screen.getByRole("button", { name: "New questionnaire" }));
    const create = await screen.findByRole("dialog", { name: "New questionnaire" });
    await userEvent.type(within(create).getByRole("textbox", { name: "Name" }), "Smoking history");
    await userEvent.type(within(create).getByRole("textbox", { name: "Title" }), "Your smoking history");
    await userEvent.click(within(create).getByRole("button", { name: "Create questionnaire" }));

    await landOn("Smoking history");
    const [questionnaireId] = path().match(/[0-9a-f-]{36}/) ?? [];
    expect(path()).toBe(`/questionnaires/${questionnaireId}/draft`);
    expect(document.title).toBe("Draft editor · Questionnaire admin");
    expect(currentNav()).toEqual(["Questionnaires"]);
    expect(pageLinksMarkedCurrent()).toEqual([]);
    expect(await screen.findByText(/No questions yet/)).toBeInTheDocument();

    await userEvent.click(screen.getByRole("button", { name: "Add question" }));
    const picker = await screen.findByRole("dialog", { name: "Add a question" });
    await userEvent.click(await within(picker).findByRole("button", { name: "Add “Do you smoke?”, version 1" }));
    expect(await screen.findByRole("heading", { level: 2, name: "1 question" })).toBeInTheDocument();
    await waitFor(() => expect(screen.getByRole("button", { name: "Add question" })).toHaveFocus());

    await userEvent.click(screen.getByRole("button", { name: "Add question" }));
    const secondPicker = await screen.findByRole("dialog", { name: "Add a question" });
    await within(secondPicker).findByRole("list", { name: "Active questions in the bank" });
    await userEvent.click(within(secondPicker).getByRole("button", { name: "New question" }));
    const editor = await screen.findByRole("dialog", { name: "New question" });
    await userEvent.type(within(editor).getByRole("textbox", { name: "Prompt" }), "How many a day?");
    await userEvent.click(within(editor).getByRole("button", { name: "Save as version 1" }));
    expect(await screen.findByRole("heading", { level: 2, name: "2 questions" })).toBeInTheDocument();
    await waitFor(() => expect(screen.queryByRole("dialog")).not.toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("button", { name: "Add question" })).toHaveFocus());

    await userEvent.click(screen.getByRole("button", { name: "Rules for question 2" }));
    await userEvent.click(screen.getByRole("button", { name: "Add condition" }));
    await waitFor(() =>
      expect(requests.filter(({ method }) => method === "PUT").at(-1)?.body).toMatchObject({
        items: [
          { questionId: smoke.questionId, visibleWhen: null },
          { visibleWhen: { all: [{ type: "single_choice", op: "is", optionId: "yes" }] } },
        ],
      }),
    );

    await expectNoAxeViolations(container);
    await userEvent.click(await waitForPublishable());

    await landOn("Version history");
    expect(path()).toBe(`/questionnaires/${questionnaireId}/versions`);
    expect(document.title).toBe("Version history · Questionnaire admin");
    const version1 = (await screen.findByText("Version 1")).closest("tr");
    expect(version1).not.toBeNull();
    expect(within(version1!).getByText("2 questions")).toBeInTheDocument();
    expect(currentNav()).toEqual(["Questionnaires"]);
    expect(pageLinksMarkedCurrent()).toEqual([]);
    await expectNoAxeViolations(container);

    await userEvent.click(screen.getByRole("link", { name: "Preview version 1" }));
    await landOn("Preview of version 1");
    expect(document.title).toBe("Preview of version 1 · Questionnaire admin");
    expect(await screen.findByRole("heading", { level: 2, name: "Your smoking history" })).toBeInTheDocument();
    expect(currentNav()).toEqual(["Questionnaires"]);
    expect(pageLinksMarkedCurrent()).toEqual([]);

    await userEvent.click(screen.getByRole("link", { name: "Back to version history" }));
    await landOn("Version history");
    await userEvent.click(await screen.findByRole("button", { name: "Open the next draft" }));
    await landOn("Smoking history");
    expect(path()).toBe(`/questionnaires/${questionnaireId}/draft`);
    expect(await screen.findByRole("heading", { level: 2, name: "2 questions" })).toBeInTheDocument();

    await userEvent.click(screen.getByRole("link", { name: "Back to questionnaires" }));
    await landOn("Questionnaires");
    const row = (await screen.findByText("Smoking history")).closest("tr");
    expect(row).not.toBeNull();
    expect(within(row!).getByText("Published v1")).toBeInTheDocument();
    expect(within(row!).getByText("Draft open")).toBeInTheDocument();
    expect(within(row!).getByRole("link", { name: "History of Smoking history" })).toHaveAttribute(
      "href",
      `/admin/questionnaires/${questionnaireId}/versions`,
    );

    await userEvent.click(screen.getByRole("link", { name: "Question bank" }));
    await landOn("Question bank");
    expect(currentNav()).toEqual(["Question bank"]);
    const usage = await screen.findByRole("list", { name: "Published versions using Do you smoke?" });
    await userEvent.click(within(usage).getByRole("link", { name: "Preview Smoking history v1, which uses question v1" }));
    await landOn("Preview of version 1");
    expect(path()).toBe(`/questionnaires/${questionnaireId}/versions/1`);
    expect(currentNav()).toEqual(["Questionnaires"]);
  });
});
