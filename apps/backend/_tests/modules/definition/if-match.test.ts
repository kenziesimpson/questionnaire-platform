import { formatDraftEtag } from "@qp/shared";
import { describe, expect, it } from "vitest";
import { draftPreconditionOf, MalformedDraftPrecondition } from "../../../src/modules/definition/if-match.js";

const versionId = "01a0950e-56a0-73d6-b936-4a1e10eff8c0";

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
