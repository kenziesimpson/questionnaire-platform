import { describe, expect, it } from "vitest";
import { isCurrentDraft } from "../../../src/db/definition/draft-precondition.js";

const versionId = "01a0950e-56a0-73d6-b936-4a1e10eff8c0";
const otherVersionId = "01a0950e-56a0-73d6-b936-4a1e10eff8c1";

describe("isCurrentDraft", () => {
  it("requires both the draft version id and the revision to match", () => {
    const current = { versionId, draftRevision: 0 };

    expect(isCurrentDraft({ versionId, draftRevision: 0 }, current)).toBe(true);
    expect(isCurrentDraft({ versionId, draftRevision: 1 }, current)).toBe(false);
    expect(isCurrentDraft({ versionId: otherVersionId, draftRevision: 0 }, current)).toBe(false);
  });
});
