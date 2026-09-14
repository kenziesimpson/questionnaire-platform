import axe from "axe-core";

const JSDOM_CANNOT_EVALUATE = { "color-contrast": { enabled: false } };

const A_COMPONENT_IS_NOT_A_PAGE = { region: { enabled: false } };

async function violations(context: Element, rules: axe.RuleObject) {
  const results = await axe.run(context, { rules });
  return results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) }));
}

export function violationsIn(container: Element) {
  return violations(container, JSDOM_CANNOT_EVALUATE);
}

export function violationsInDocumentIncludingPortals() {
  return violations(document.body, { ...JSDOM_CANNOT_EVALUATE, ...A_COMPONENT_IS_NOT_A_PAGE });
}
