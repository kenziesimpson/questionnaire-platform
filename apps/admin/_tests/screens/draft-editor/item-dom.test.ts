import { afterEach, describe, expect, it } from "vitest";
import { itemDomId, rulesEditorOf } from "../../../src/screens/draft-editor/item-dom";

afterEach(() => {
  document.body.innerHTML = "";
});

describe("itemDomId", () => {
  it("prefixes the item id so it is safe to use as an element id", () => {
    expect(itemDomId("itm_smoke")).toBe("draft-item-itm_smoke");
  });
});

describe("rulesEditorOf", () => {
  it("finds the rules editor nested under the item's row", () => {
    document.body.innerHTML = `
      <li id="${itemDomId("itm_smoke")}">
        <div data-rules-editor tabindex="-1"></div>
      </li>
    `;
    expect(rulesEditorOf("itm_smoke")).toBe(document.querySelector("[data-rules-editor]"));
  });

  it("returns null when the item's row is not in the document", () => {
    expect(rulesEditorOf("itm_missing")).toBeNull();
  });

  it("returns null when the row has no rules editor open", () => {
    document.body.innerHTML = `<li id="${itemDomId("itm_smoke")}"></li>`;
    expect(rulesEditorOf("itm_smoke")).toBeNull();
  });
});
