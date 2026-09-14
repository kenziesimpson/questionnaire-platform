import { formatDraftEtag } from "@qp/shared";
import { describe, expect, it } from "vitest";
import {
  draftPreconditionOf,
  isCurrentDraft,
  MalformedDraftPrecondition,
} from "../../../src/modules/definition/if-match.js";

const versionId = "01a0950e-56a0-73d6-b936-4a1e10eff8c0";
const otherVersionId = "01a0950e-56a0-73d6-b936-4a1e10eff8c1";

describe("draftPreconditionOf", () => {
  it("reads back the ETag the server issues", () => {
    expect(draftPreconditionOf(formatDraftEtag(versionId, 3))).toEqual({ versionId, draftRevision: 3 });
  });

  it.each(["*", "abc", `"${versionId}:3"`, `W/"${versionId}"`, `W/"${versionId}:-1"`])(
    "rejects %s as malformed rather than treating it as unconditional",
    (ifMatch) => {
      expect(() => draftPreconditionOf(ifMatch)).toThrow(MalformedDraftPrecondition);
    },
  );
});

describe("isCurrentDraft", () => {
  it("requires both the draft version id and the revision to match", () => {
    const current = { versionId, draftRevision: 0 };

    expect(isCurrentDraft({ versionId, draftRevision: 0 }, current)).toBe(true);
    expect(isCurrentDraft({ versionId, draftRevision: 1 }, current)).toBe(false);
    expect(isCurrentDraft({ versionId: otherVersionId, draftRevision: 0 }, current)).toBe(false);
  });
});
