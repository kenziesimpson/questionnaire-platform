import { intakeDefinition, type VersionSummary } from "@qp/shared";
import { createMemoryHistory } from "@tanstack/react-router";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import axe from "axe-core";
import { describe, expect, it } from "vitest";
import { App } from "../../src/app";
import { createAppRouter } from "../../src/router";
import {
  QUESTIONNAIRE_ID,
  deferred,
  jsonResponse,
  problemResponse,
  stubFetch,
  testQueryClient,
  type FetchHandler,
} from "../fixtures";

const JSDOM_CANNOT_EVALUATE = { "color-contrast": { enabled: false } };

const VERSIONS_URL = `/api/definition/questionnaires/${QUESTIONNAIRE_ID}/versions`;
const snapshotUrl = (version: number) => `${VERSIONS_URL}/${version}`;

const intakeV2 = intakeDefinition(2);

const versionSummaries: VersionSummary[] = [2, 1].map((version) => ({
  questionnaireId: QUESTIONNAIRE_ID,
  version,
  publishedAt: `2026-09-1${version}T09:00:00.000Z`,
  publishedBy: null,
  itemCount: 4,
  formatVersion: 1,
}));

const serveIntake: FetchHandler = ({ url }) => {
  if (url === VERSIONS_URL) return jsonResponse(200, versionSummaries);
  if (url === snapshotUrl(2)) return jsonResponse(200, intakeV2);
  return problemResponse("resource/not-found");
};

function renderPreview(handler: FetchHandler, version = 2) {
  const requests = stubFetch(handler);
  const queryClient = testQueryClient();
  const router = createAppRouter({
    queryClient,
    history: createMemoryHistory({ initialEntries: [`/admin/questionnaires/${QUESTIONNAIRE_ID}/versions/${version}`] }),
  });
  const { container } = render(<App queryClient={queryClient} router={router} />);
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

async function chooseSample(group: string, option: string) {
  const fieldset = within(samplePanel()).getByRole("group", { name: group });
  await userEvent.click(within(fieldset).getByRole("radio", { name: option }));
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
    expect(panel.getByRole("group", { name: "1. Do you have a medical condition?" })).toBeInTheDocument();
    expect(panel.getByRole("radio", { name: "Unanswered" })).toBeChecked();
    expect(panel.getByRole("textbox", { name: "4. Preferred pharmacy" })).toBeInTheDocument();
    expect(hiddenPrompts()).toEqual(["2. Which condition?", "3. When were you diagnosed?"]);
  });

  it("reveals the branch in the renderer and the panel when the gating sample answer is yes, and hides and lists it again on no", async () => {
    await renderLoadedIntake();

    await chooseSample("1. Do you have a medical condition?", "Yes");

    expect(renderedItemIds()).toEqual(["itm_01", "itm_02", "itm_03", "itm_04"]);
    expect(within(respondentView()).getByRole("radio", { name: "Yes" })).toBeChecked();
    expect(within(samplePanel()).getByRole("group", { name: "2. Which condition?" })).toBeInTheDocument();
    expect(within(samplePanel()).getByLabelText("3. When were you diagnosed?")).toHaveAttribute("type", "date");
    expect(hiddenPrompts()).toEqual([]);
    expect(within(hiddenByRules()).getByText("The current sample answers hide no questions.")).toBeInTheDocument();

    await chooseSample("1. Do you have a medical condition?", "No");

    expect(renderedItemIds()).toEqual(["itm_01", "itm_04"]);
    expect(within(respondentView()).getByRole("radio", { name: "No" })).toBeChecked();
    expect(within(samplePanel()).queryByRole("group", { name: "2. Which condition?" })).not.toBeInTheDocument();
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
    expect(within(samplePanel()).getByRole("radio", { name: "Unanswered" })).toBeChecked();
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
      `GET ${snapshotUrl(2)}`,
    ]);
    expect(requests.some(({ url }) => url.includes("/api/run"))).toBe(false);
  });

  it("shows a loading state until the snapshot arrives", async () => {
    const snapshot = deferred<Response>();
    renderPreview(({ url }) => (url === snapshotUrl(2) ? snapshot.promise : jsonResponse(200, versionSummaries)));

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
      url === snapshotUrl(2) ? (snapshots.shift() ?? problemResponse("internal", { detail: "extra" })) : jsonResponse(200, versionSummaries),
    );

    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("Version 2 could not be loaded");
    expect(alert).not.toHaveTextContent("trace-1");

    await userEvent.click(within(alert).getByRole("button", { name: "Retry" }));

    expect(await screen.findByRole("heading", { level: 2, name: "Patient Intake" })).toBeInTheDocument();
    expect(requests.filter(({ url }) => url === snapshotUrl(2))).toHaveLength(2);
  });

  it("treats a snapshot that fails the shared PublishedDefinition schema as an error, not a preview", async () => {
    renderPreview(({ url }) =>
      url === snapshotUrl(2) ? jsonResponse(200, { ...intakeV2, formatVersion: 99 }) : jsonResponse(200, versionSummaries),
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

    const results = await axe.run(container, { rules: JSDOM_CANNOT_EVALUATE });

    expect(results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) }))).toEqual([]);
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

    const results = await axe.run(container, { rules: JSDOM_CANNOT_EVALUATE });

    expect(results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) }))).toEqual([]);
  });
});
