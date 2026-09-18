import { afterEach, describe, expect, it, vi } from "vitest";
import { focusItem } from "../../src/questionnaire/focus-item";
import { ITEM_ID_ATTRIBUTE } from "../../src/questionnaire/item-id-attribute";

function itemWrapper(itemId: string, innerHTML: string): HTMLDivElement {
  const wrapper = document.createElement("div");
  wrapper.setAttribute(ITEM_ID_ATTRIBUTE, itemId);
  wrapper.innerHTML = innerHTML;
  return wrapper;
}

function containerWith(...wrappers: readonly HTMLElement[]): HTMLElement {
  const container = document.createElement("div");
  for (const wrapper of wrappers) container.append(wrapper);
  document.body.append(container);
  return container;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe("focusItem", () => {
  it("scrolls the item's wrapper into view and focuses its control", () => {
    const wrapper = itemWrapper("itm_01", '<label for="a">Prompt</label><input id="a" />');
    const container = containerWith(wrapper);
    const scrollIntoView = vi.fn();
    wrapper.scrollIntoView = scrollIntoView;

    expect(focusItem(container, "itm_01")).toBe(true);
    expect(document.activeElement).toBe(wrapper.querySelector("#a"));
    expect(scrollIntoView).toHaveBeenCalledExactlyOnceWith({ block: "start" });
  });

  it("skips a disabled control and focuses the next reachable one", () => {
    const wrapper = itemWrapper("itm_02", '<button disabled>Disabled</button><input id="b" />');
    const container = containerWith(wrapper);

    expect(focusItem(container, "itm_02")).toBe(true);
    expect(document.activeElement).toBe(wrapper.querySelector("#b"));
  });

  it("skips a control inside an aria-hidden ancestor", () => {
    const wrapper = itemWrapper(
      "itm_03",
      '<div aria-hidden="true"><input id="hidden-input" /></div><input id="visible-input" />',
    );
    const container = containerWith(wrapper);

    expect(focusItem(container, "itm_03")).toBe(true);
    expect(document.activeElement).toBe(wrapper.querySelector("#visible-input"));
  });

  it("returns false and focuses nothing for an itemId the container does not have", () => {
    const wrapper = itemWrapper("itm_04", '<input id="c" />');
    const container = containerWith(wrapper);

    expect(focusItem(container, "itm_99")).toBe(false);
    expect(document.activeElement).not.toBe(wrapper.querySelector("#c"));
  });

  it("returns false for an item with no keyboard-reachable control", () => {
    const wrapper = itemWrapper("itm_05", "<button disabled>Disabled</button>");
    const container = containerWith(wrapper);

    expect(focusItem(container, "itm_05")).toBe(false);
  });
});
