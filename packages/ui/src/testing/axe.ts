import axe from "axe-core";

const JSDOM_CANNOT_EVALUATE: axe.RuleObject = { "color-contrast": { enabled: false } };

const A_COMPONENT_IS_NOT_A_PAGE: axe.RuleObject = { ...JSDOM_CANNOT_EVALUATE, region: { enabled: false } };

async function violations(context: Element, rules: axe.RuleObject) {
  const results = await axe.run(context, { rules });
  return results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) }));
}

export function axeViolations(context: Element = document.body) {
  return violations(context, JSDOM_CANNOT_EVALUATE);
}

export function componentAxeViolations(context: Element = document.body) {
  return violations(context, A_COMPONENT_IS_NOT_A_PAGE);
}
