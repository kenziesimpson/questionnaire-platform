import type { QuestionnaireDraft, VersionSummary } from "@qp/shared";
import { QueryClientProvider, useQuery, type QueryClient } from "@tanstack/react-query";
import { act, renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it } from "vitest";
import { questionnaireQueries } from "../../src/api/queries";
import { useDraftMutation, type PublishOutcome } from "../../src/api/use-draft-mutation";
import {
  QUESTIONNAIRE_ID,
  aDraft,
  deferred,
  draftResponse,
  etagAt,
  jsonResponse,
  problemResponse,
  respondInOrder,
  stubFetch,
  testQueryClient,
  type FetchHandler,
} from "../fixtures";

const draftQuery = questionnaireQueries.draft(QUESTIONNAIRE_ID);
const validationQuery = questionnaireQueries.draftValidation(QUESTIONNAIRE_ID);
const DRAFT_URL = `/api/definition/questionnaires/${QUESTIONNAIRE_ID}/draft`;

const swapFirstTwo = (draft: QuestionnaireDraft): QuestionnaireDraft => {
  const [first, second, ...rest] = draft.items;
  return first && second ? { ...draft, items: [second, first, ...rest] } : draft;
};

const dropLast = (draft: QuestionnaireDraft): QuestionnaireDraft => ({ ...draft, items: draft.items.slice(0, -1) });

function itemIdsIn(queryClient: QueryClient) {
  return queryClient.getQueryData(draftQuery.queryKey)?.draft.items.map(({ itemId }) => itemId);
}

function renderDraftMutation(handler: FetchHandler, loaded = aDraft(["itm_01", "itm_02", "itm_03"]), revision = 1) {
  const requests = stubFetch(handler);
  const queryClient = testQueryClient();
  queryClient.setQueryData(draftQuery.queryKey, { draft: loaded, etag: etagAt(revision) });
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  );
  const { result } = renderHook(
    () => {
      useQuery({ ...draftQuery, staleTime: Infinity });
      return useDraftMutation(QUESTIONNAIRE_ID);
    },
    { wrapper },
  );
  return { requests, queryClient, result };
}

describe("useDraftMutation", () => {
  it("applies the change locally before the PUT, sends the cached ETag as If-Match and stores the saved draft and its new ETag", async () => {
    const response = deferred<Response>();
    const { requests, queryClient, result } = renderDraftMutation(() => response.promise);

    act(() => result.current.change(swapFirstTwo));

    expect(itemIdsIn(queryClient)).toEqual(["itm_02", "itm_01", "itm_03"]);
    await waitFor(() => expect(requests).toHaveLength(1));
    expect(requests[0]).toMatchObject({ method: "PUT", url: DRAFT_URL });
    expect(requests[0]?.headers.get("if-match")).toBe(etagAt(1));
    expect(requests[0]?.body).toEqual({ title: "Patient Intake", items: aDraft(["itm_02", "itm_01", "itm_03"]).items });
    expect(result.current.isSaving).toBe(true);

    const saved = { ...aDraft(["itm_02", "itm_01", "itm_03"]), updatedAt: "2026-09-14T09:05:00.000Z" };
    response.resolve(draftResponse(saved, 2));

    await waitFor(() => expect(result.current.isSaving).toBe(false));
    expect(queryClient.getQueryData(draftQuery.queryKey)).toEqual({ draft: saved, etag: etagAt(2) });
    expect(result.current.rejection).toBeNull();
  });

  it("runs two quick changes one after the other, the second sending the ETag the first one's response carried", async () => {
    const first = deferred<Response>();
    const second = deferred<Response>();
    const responses = [first.promise, second.promise];
    const { requests, queryClient, result } = renderDraftMutation(() => responses.shift() ?? Promise.reject(new Error("extra")));

    act(() => {
      result.current.change(swapFirstTwo);
      result.current.change(dropLast);
    });

    expect(itemIdsIn(queryClient)).toEqual(["itm_02", "itm_01"]);
    await waitFor(() => expect(requests).toHaveLength(1));

    first.resolve(draftResponse(aDraft(["itm_02", "itm_01", "itm_03"]), 2));
    await waitFor(() => expect(requests).toHaveLength(2));
    expect(itemIdsIn(queryClient)).toEqual(["itm_02", "itm_01"]);
    expect(requests.map(({ headers }) => headers.get("if-match"))).toEqual([etagAt(1), etagAt(2)]);
    expect(requests[1]?.body).toEqual({ title: "Patient Intake", items: aDraft(["itm_02", "itm_01"]).items });

    second.resolve(draftResponse(aDraft(["itm_02", "itm_01"]), 3));
    await waitFor(() => expect(result.current.isSaving).toBe(false));
    expect(queryClient.getQueryData(draftQuery.queryKey)).toEqual({ draft: aDraft(["itm_02", "itm_01"]), etag: etagAt(3) });
  });

  it("on 409 questionnaire/draft-stale rolls the change back, refetches the draft and exposes a stale conflict", async () => {
    const theirs = aDraft(["itm_03", "itm_01", "itm_02"]);
    const { requests, queryClient, result } = renderDraftMutation(
      respondInOrder(problemResponse("questionnaire/draft-stale"), draftResponse(theirs, 7)),
    );
    const refetched = deferred<void>();
    queryClient.getQueryCache().subscribe((event) => {
      if (event.type === "updated" && event.action.type === "success") refetched.resolve();
    });

    queryClient.setQueryData(validationQuery.queryKey, { valid: true, items: [] });

    act(() => result.current.change(swapFirstTwo));

    await waitFor(() => expect(result.current.rejection?.kind).toBe("stale"));
    expect(queryClient.getQueryState(validationQuery.queryKey)?.isInvalidated).toBe(true);
    await refetched.promise;
    expect(requests.map(({ method, url }) => `${method} ${url}`)).toEqual([`PUT ${DRAFT_URL}`, `GET ${DRAFT_URL}`]);
    expect(queryClient.getQueryData(draftQuery.queryKey)).toEqual({ draft: theirs, etag: etagAt(7) });
  });

  it("restores the pre-change draft on 409 before the refetch lands", async () => {
    const refetch = deferred<Response>();
    const responses = [problemResponse("questionnaire/draft-stale")];
    const { queryClient, result } = renderDraftMutation(({ method }) =>
      method === "PUT" ? (responses.shift() ?? Promise.reject(new Error("extra"))) : refetch.promise,
    );

    act(() => result.current.change(swapFirstTwo));

    await waitFor(() => expect(result.current.rejection?.kind).toBe("stale"));
    expect(itemIdsIn(queryClient)).toEqual(["itm_01", "itm_02", "itm_03"]);
    refetch.resolve(draftResponse(aDraft(["itm_01", "itm_02", "itm_03"]), 7));
  });

  it("does not send a change queued behind a rejected one, since it was built on a draft the server refused", async () => {
    const first = deferred<Response>();
    const { requests, queryClient, result } = renderDraftMutation(({ method }) =>
      method === "PUT" ? first.promise : draftResponse(aDraft(["itm_01", "itm_02", "itm_03"]), 7),
    );

    act(() => {
      result.current.change(swapFirstTwo);
      result.current.change(dropLast);
    });
    await waitFor(() => expect(requests).toHaveLength(1));
    first.resolve(problemResponse("questionnaire/draft-stale"));

    await waitFor(() => expect(result.current.isSaving).toBe(false));
    expect(requests.filter(({ method }) => method === "PUT")).toHaveLength(1);
    await waitFor(() => expect(itemIdsIn(queryClient)).toEqual(["itm_01", "itm_02", "itm_03"]));
  });

  it("keeps a 422 questionnaire/draft-invalid apart from a conflict: the change is rolled back, the items are exposed and nothing is refetched", async () => {
    const { requests, queryClient, result } = renderDraftMutation(
      respondInOrder(
        problemResponse("questionnaire/draft-invalid", { items: [{ itemId: "itm_03", code: "draft/question-archived" }] }),
      ),
    );

    act(() => result.current.change(swapFirstTwo));

    await waitFor(() => expect(result.current.rejection).not.toBeNull());
    expect(result.current.rejection).toEqual({
      kind: "invalid",
      problem: expect.objectContaining({
        status: 422,
        items: [{ itemId: "itm_03", code: "draft/question-archived" }],
      }),
    });
    expect(itemIdsIn(queryClient)).toEqual(["itm_01", "itm_02", "itm_03"]);
    await waitFor(() => expect(result.current.isSaving).toBe(false));
    expect(requests.map(({ method }) => method)).toEqual(["PUT"]);
    expect(queryClient.getQueryState(draftQuery.queryKey)?.isInvalidated).toBe(false);
  });

  it("reports any other failure as failed, rolled back and not a conflict", async () => {
    const { queryClient, result } = renderDraftMutation(respondInOrder(problemResponse("internal", { detail: "trace-1" })));

    act(() => result.current.change(swapFirstTwo));

    await waitFor(() => expect(result.current.rejection?.kind).toBe("failed"));
    expect(itemIdsIn(queryClient)).toEqual(["itm_01", "itm_02", "itm_03"]);
    act(() => result.current.dismissRejection());
    expect(result.current.rejection).toBeNull();
  });

  it("publishes with the ETag of the last saved change, after that change has landed", async () => {
    const summary: VersionSummary = {
      questionnaireId: QUESTIONNAIRE_ID,
      version: 1,
      publishedAt: "2026-09-14T09:10:00.000Z",
      publishedBy: null,
      itemCount: 3,
      formatVersion: 1,
    };
    const { requests, queryClient, result } = renderDraftMutation(
      respondInOrder(draftResponse(aDraft(["itm_02", "itm_01", "itm_03"]), 2), jsonResponse(201, summary)),
    );

    let published: Promise<PublishOutcome> = Promise.resolve({ kind: "superseded" });
    act(() => {
      result.current.change(swapFirstTwo);
      published = result.current.publish();
    });

    await expect(published).resolves.toEqual({ kind: "published", version: summary });
    expect(requests.map(({ method, headers }) => `${method} ${headers.get("if-match")}`)).toEqual([
      `PUT ${etagAt(1)}`,
      `POST ${etagAt(2)}`,
    ]);
    expect(queryClient.getQueryData(draftQuery.queryKey)).toBeUndefined();
  });

  it("reports a 409 on publish as a stale conflict and, once the refetch lands, a 422 on publish as invalid", async () => {
    const { requests, queryClient, result } = renderDraftMutation(
      respondInOrder(
        problemResponse("questionnaire/draft-stale"),
        draftResponse(aDraft(), 4),
        problemResponse("questionnaire/draft-invalid", { items: [{ itemId: "itm_02", code: "predicate/unsatisfiable" }] }),
      ),
    );
    queryClient.setQueryData(validationQuery.queryKey, { valid: true, items: [] });

    await act(async () => {
      await expect(result.current.publish()).resolves.toMatchObject({ kind: "refused", rejection: { kind: "stale" } });
    });
    expect(result.current.rejection?.kind).toBe("stale");
    expect(queryClient.getQueryState(validationQuery.queryKey)?.isInvalidated).toBe(true);
    await waitFor(() => expect(queryClient.getQueryData(draftQuery.queryKey)?.etag).toBe(etagAt(4)));

    await act(async () => {
      await expect(result.current.publish()).resolves.toMatchObject({ kind: "refused", rejection: { kind: "invalid" } });
    });
    expect(result.current.rejection?.kind).toBe("invalid");
    expect(queryClient.getQueryData(validationQuery.queryKey)).toEqual({
      valid: false,
      items: [{ itemId: "itm_02", code: "predicate/unsatisfiable" }],
    });
    expect(requests.map(({ method, headers }) => `${method} ${headers.get("if-match")}`)).toEqual([
      `POST ${etagAt(1)}`,
      `GET null`,
      `POST ${etagAt(4)}`,
    ]);
  });
});
