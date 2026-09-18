import { describe, expect, it } from "vitest";
import { publishWaitsFor } from "../../../src/screens/draft-editor/publish-checks";

const settled = { saving: false, checking: false, checksFailed: false, problems: 0 };

describe("publishWaitsFor", () => {
  it("waits on a save in progress before anything else", () => {
    expect(publishWaitsFor({ ...settled, saving: true, checking: true, checksFailed: true, problems: 3 })).toEqual({
      lead: "Publishing waits until your changes are saved.",
      linksToChecks: false,
      trail: "",
    });
  });

  it("waits on the checks to run once saving is done", () => {
    expect(publishWaitsFor({ ...settled, checking: true })).toEqual({
      lead: "Publishing waits until ",
      linksToChecks: true,
      trail: " have run on the saved draft.",
    });
  });

  it("waits on the checks to become available again after a failure", () => {
    expect(publishWaitsFor({ ...settled, checksFailed: true })).toEqual({
      lead: "Publishing waits until ",
      linksToChecks: true,
      trail: " can run.",
    });
  });

  it("names the problem count blocking publishing, singular and plural", () => {
    expect(publishWaitsFor({ ...settled, problems: 1 })).toEqual({
      lead: "1 problem under ",
      linksToChecks: true,
      trail: " is blocking publishing.",
    });
    expect(publishWaitsFor({ ...settled, problems: 2 })).toEqual({
      lead: "2 problems under ",
      linksToChecks: true,
      trail: " are blocking publishing.",
    });
  });

  it("returns null when nothing blocks publishing", () => {
    expect(publishWaitsFor(settled)).toBeNull();
  });
});
