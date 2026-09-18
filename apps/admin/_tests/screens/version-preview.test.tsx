import type { VersionSummary } from "@qp/shared";
import { intakeDefinition } from "@qp/shared/demo";
import { axeViolations, jsonResponse, problemResponse, stubFetch, type Reply } from "@qp/ui/testing";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it } from "vitest";
import { QUESTIONNAIRE_ID } from "../support/builders";
import { deferred } from "../support/http";
import { renderAppAt } from "../support/render-app";
import { VERSIONS_URL, versionUrl } from "../support/routes";

const intakeV2 = intakeDefinition(2);

const versionSummaries: VersionSummary[] = [2, 1].map((version) => ({
  questionnaireId: QUESTIONNAIRE_ID,
  version,
  publishedAt: `2026-09-1${version}T09:00:00.000Z`,
  publishedBy: null,
  itemCount: 4,
  formatVersion: 1,
}));

const serveIntake: Reply = ({ url }) => {
  if (url === VERSIONS_URL) return jsonResponse(200, versionSummaries);
  if (url === versionUrl(2)) return jsonResponse(200, intakeV2);
  return problemResponse("resource/not-found");
};

function renderPreview(handler: Reply, version = 2) {
  const requests = stubFetch(handler);
  const { container } = renderAppAt(`/questionnaires/${QUESTIONNAIRE_ID}/versions/${version}`);
  return { requests, container };
}

async function renderLoadedIntake() {
  const rendered = renderPreview(serveIntake);
  await screen.findByRole("heading", { level: 2, name: "Patient Intake" });
  return rendered;
}

const respondentView = () => screen.getByRole("region", { name: "Patient Intake" });
const samplePanel = () => screen.getByRole("region", { name: "Sample answers" });
const hiddenByRules = () => screen.getByRole("region", { name: /Hidden by rules/ });

function renderedItemIds() {
  return Array.from(respondentView().querySelectorAll<HTMLElement>("[data-item-id]"), (element) => element.dataset.itemId);
}

function hiddenPrompts() {
  return within(hiddenByRules())
    .queryAllByRole("listitem")
    .map((item) => item.textContent);
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

async function chooseSample(group: string, option: string) {
  const fieldset = within(samplePanel()).getByRole("radiogroup", { name: new RegExp(`^${escapeRegExp(group)}`) });
  await userEvent.click(within(fieldset).getByRole("radio", { name: option }));
}

function clearButton(label: string) {
  return within(samplePanel()).getByRole("button", { name: `Clear ${label}` });
}

describe("the version preview screen", () => {
  it("renders the intake snapshot through the shared renderer in readonly mode, with the title and publish date", async () => {
    await renderLoadedIntake();

    const title = screen.getByRole("heading", { level: 1, name: "Preview of version 2" });
    const back = screen.getByRole("link", { name: "Back to version history" });
    expect(back).toHaveAttribute("href", `/admin/questionnaires/${QUESTIONNAIRE_ID}/versions`);
    expect(back).toHaveTextContent("");
    expect(back.nextElementSibling).toBe(title);
    expect(screen.queryByRole("link", { name: "Version history" })).not.toBeInTheDocument();
    expect(await screen.findByText(/Patient Intake · published/)).toBeInTheDocument();
    expect(renderedItemIds()).toEqual(["itm_01", "itm_04"]);
    const hasCondition = within(respondentView()).getByRole("radiogroup", { name: /Do you have a medical condition\?/ });
    for (const radio of within(hasCondition).getAllByRole("radio")) expect(radio).toBeDisabled();
    expect(within(respondentView()).getByRole("textbox", { name: /Preferred pharmacy/ })).toHaveAttribute("readonly");
    expect(within(respondentView()).getByRole("button", { name: "Submit answers" })).toBeDisabled();

    await userEvent.click(within(hasCondition).getByRole("radio", { name: "Yes" }));

    expect(renderedItemIds()).toEqual(["itm_01", "itm_04"]);
  });

  it("before any sample answer, offers an input for each shown item and lists the gated branch as hidden by rules", async () => {
    await renderLoadedIntake();

    const panel = within(samplePanel());
    const hasConditionGroup = panel.getByRole("radiogroup", { name: /^1\. Do you have a medical condition\?/ });
    for (const radio of within(hasConditionGroup).getAllByRole("radio")) expect(radio).not.toBeChecked();
    expect(clearButton("1. Do you have a medical condition?")).toBeDisabled();
    expect(panel.getByRole("textbox", { name: "4. Preferred pharmacy" })).toBeInTheDocument();
    expect(clearButton("4. Preferred pharmacy")).toBeDisabled();
    expect(hiddenPrompts()).toEqual(["2. Which condition?", "3. When were you diagnosed?"]);
  });

  it("enters the free-text Other answer through the panel and shows it in the renderer", async () => {
    await renderLoadedIntake();

    await chooseSample("1. Do you have a medical condition?", "Yes");
    const whichConditionPanel = within(samplePanel()).getByRole("radiogroup", { name: /^2\. Which condition\?/ });
    await userEvent.click(within(whichConditionPanel).getByRole("radio", { name: "Other" }));
    await userEvent.type(within(samplePanel()).getByRole("textbox", { name: "Other, please specify" }), "Asthma");

    expect(clearButton("2. Which condition?")).toBeEnabled();
    const whichConditionRespondent = within(respondentView()).getByRole("radiogroup", { name: /Which condition\?/ });
    expect(within(whichConditionRespondent).getByRole("radio", { name: "Other" })).toBeChecked();
    expect(within(respondentView()).getByRole("textbox", { name: "Other, please specify" })).toHaveValue("Asthma");
  });

  it("clears a single sample answer with its Clear button, closing a branch that depended on it", async () => {
    await renderLoadedIntake();

    await chooseSample("1. Do you have a medical condition?", "Yes");
    expect(renderedItemIds()).toEqual(["itm_01", "itm_02", "itm_03", "itm_04"]);
    expect(clearButton("1. Do you have a medical condition?")).toBeEnabled();

    await userEvent.click(clearButton("1. Do you have a medical condition?"));

    expect(renderedItemIds()).toEqual(["itm_01", "itm_04"]);
    const hasConditionGroup = within(samplePanel()).getByRole("radiogroup", { name: /^1\. Do you have a medical condition\?/ });
    for (const radio of within(hasConditionGroup).getAllByRole("radio")) expect(radio).not.toBeChecked();
    expect(clearButton("1. Do you have a medical condition?")).toBeDisabled();
    expect(hiddenPrompts()).toEqual(["2. Which condition?", "3. When were you diagnosed?"]);
  });

  it("reveals the branch in the renderer and the panel when the gating sample answer is yes, and hides and lists it again on no", async () => {
    await renderLoadedIntake();

    await chooseSample("1. Do you have a medical condition?", "Yes");

    expect(renderedItemIds()).toEqual(["itm_01", "itm_02", "itm_03", "itm_04"]);
    expect(within(respondentView()).getByRole("radio", { name: "Yes" })).toBeChecked();
    expect(within(samplePanel()).getByRole("radiogroup", { name: /^2\. Which condition\?/ })).toBeInTheDocument();
    expect(within(samplePanel()).getByLabelText("3. When were you diagnosed?", { exact: false, selector: "input" })).toHaveAttribute(
      "type",
      "date",
    );
    expect(hiddenPrompts()).toEqual([]);
    expect(within(hiddenByRules()).getByText("The current sample answers hide no questions.")).toBeInTheDocument();

    await chooseSample("1. Do you have a medical condition?", "No");

    expect(renderedItemIds()).toEqual(["itm_01", "itm_04"]);
    expect(within(respondentView()).getByRole("radio", { name: "No" })).toBeChecked();
    expect(within(samplePanel()).queryByRole("radiogroup", { name: /^2\. Which condition\?/ })).not.toBeInTheDocument();
    expect(hiddenPrompts()).toEqual(["2. Which condition?", "3. When were you diagnosed?"]);
  });

  it("shows branch sample answers in the renderer and keeps them while the branch is closed", async () => {
    await renderLoadedIntake();

    await chooseSample("1. Do you have a medical condition?", "Yes");
    await chooseSample("2. Which condition?", "High blood pressure (hypertension)");
    await userEvent.type(within(samplePanel()).getByRole("textbox", { name: "4. Preferred pharmacy" }), "Boots");

    const whichCondition = within(respondentView()).getByRole("radiogroup", { name: /Which condition\?/ });
    expect(within(whichCondition).getByRole("radio", { name: "High blood pressure (hypertension)" })).toBeChecked();
    expect(within(respondentView()).getByRole("textbox", { name: /Preferred pharmacy/ })).toHaveValue("Boots");

    await chooseSample("1. Do you have a medical condition?", "No");
    await chooseSample("1. Do you have a medical condition?", "Yes");

    expect(
      within(within(respondentView()).getByRole("radiogroup", { name: /Which condition\?/ })).getByRole("radio", {
        name: "High blood pressure (hypertension)",
      }),
    ).toBeChecked();
  });

  it("resets every sample answer, closing the branch and emptying the renderer's answers", async () => {
    await renderLoadedIntake();
    const reset = within(samplePanel()).getByRole("button", { name: "Reset answers" });
    expect(reset).toBeDisabled();

    await chooseSample("1. Do you have a medical condition?", "Yes");
    await userEvent.type(within(samplePanel()).getByRole("textbox", { name: "4. Preferred pharmacy" }), "Boots");
    await userEvent.click(reset);

    expect(renderedItemIds()).toEqual(["itm_01", "itm_04"]);
    const hasConditionGroup = within(samplePanel()).getByRole("radiogroup", { name: /^1\. Do you have a medical condition\?/ });
    for (const radio of within(hasConditionGroup).getAllByRole("radio")) expect(radio).not.toBeChecked();
    expect(clearButton("1. Do you have a medical condition?")).toBeDisabled();
    expect(within(samplePanel()).getByRole("textbox", { name: "4. Preferred pharmacy" })).toHaveValue("");
    expect(within(respondentView()).getByRole("textbox", { name: /Preferred pharmacy/ })).toHaveValue("");
    for (const radio of within(respondentView()).getAllByRole("radio")) expect(radio).not.toBeChecked();
    expect(hiddenPrompts()).toEqual(["2. Which condition?", "3. When were you diagnosed?"]);
    expect(reset).toBeDisabled();
  });

  it("never calls the execution API: every request goes to /api/definition and none to /api/run", async () => {
    const { requests } = await renderLoadedIntake();

    await chooseSample("1. Do you have a medical condition?", "Yes");
    await chooseSample("1. Do you have a medical condition?", "No");
    await userEvent.click(within(samplePanel()).getByRole("button", { name: "Reset answers" }));

    expect(requests.map(({ method, url }) => `${method} ${url}`).sort()).toEqual([
      `GET ${VERSIONS_URL}`,
      `GET ${versionUrl(2)}`,
    ]);
    expect(requests.some(({ url }) => url.includes("/api/run"))).toBe(false);
  });

  it("shows a loading state until the snapshot arrives", async () => {
    const snapshot = deferred<Response>();
    renderPreview(({ url }) => (url === versionUrl(2) ? snapshot.promise : jsonResponse(200, versionSummaries)));

    expect(await screen.findByText("Loading version 2…")).toHaveAttribute("role", "status");

    snapshot.resolve(jsonResponse(200, intakeV2));

    expect(await screen.findByRole("heading", { level: 2, name: "Patient Intake" })).toBeInTheDocument();
    expect(screen.queryByText("Loading version 2…")).not.toBeInTheDocument();
  });

  it("shows a not-published state for a 404, with the arrow back to version history beside the title and no retry", async () => {
    renderPreview(serveIntake, 9);

    expect(await screen.findByRole("heading", { level: 2, name: "Version 9 is not published" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 1, name: "Preview of version 9" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Back to version history" })).toHaveAttribute(
      "href",
      `/admin/questionnaires/${QUESTIONNAIRE_ID}/versions`,
    );
    expect(screen.queryByRole("link", { name: /published versions/ })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Retry" })).not.toBeInTheDocument();
    expect(screen.queryByRole("region", { name: "Sample answers" })).not.toBeInTheDocument();
  });

  it("shows an error state with a retry for any other failure, and recovers when the retry succeeds", async () => {
    const snapshots = [problemResponse("internal", { detail: "trace-1" }), jsonResponse(200, intakeV2)];
    const { requests } = renderPreview(({ url }) =>
      url === versionUrl(2) ? (snapshots.shift() ?? problemResponse("internal", { detail: "extra" })) : jsonResponse(200, versionSummaries),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Version 2 could not be loaded");
    expect(alert).not.toHaveTextContent("trace-1");

    await userEvent.click(within(alert).getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("heading", { level: 2, name: "Patient Intake" })).toBeInTheDocument();
    expect(requests.filter(({ url }) => url === versionUrl(2))).toHaveLength(2);
  });

  it("treats a snapshot that fails the shared PublishedDefinition schema as an error, not a preview", async () => {
    renderPreview(({ url }) =>
      url === versionUrl(2) ? jsonResponse(200, { ...intakeV2, formatVersion: 99 }) : jsonResponse(200, versionSummaries),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent("Version 2 could not be loaded");
  });

  it.each([
    ["with no sample answers", async () => undefined],
    ["with the branch open", () => chooseSample("1. Do you have a medical condition?", "Yes")],
    ["with the branch closed by no", () => chooseSample("1. Do you have a medical condition?", "No")],
  ])("has no axe violations %s", async (_, act) => {
    const { container } = await renderLoadedIntake();
    await act();

    expect(await axeViolations(container)).toEqual([]);
  });

  it.each([
    ["not-published", serveIntake, 9, () => screen.findByRole("heading", { name: "Version 9 is not published" })],
    [
      "error",
      () => problemResponse("internal", { detail: "trace" }),
      2,
      () => screen.findByRole("alert"),
    ],
  ] as const)("has no axe violations in the %s state", async (_, handler, version, settled) => {
    const { container } = renderPreview(handler, version);
    await settled();
    await waitFor(() => expect(screen.queryByRole("status")).not.toBeInTheDocument());

    expect(await axeViolations(container)).toEqual([]);
  });
});
