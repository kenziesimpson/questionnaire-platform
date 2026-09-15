import axe from "axe-core";

const JSDOM_CANNOT_EVALUATE = { "color-contrast": { enabled: false } };

export async function axeViolations(context: Element = document.body) {
  const results = await axe.run(context, { rules: JSDOM_CANNOT_EVALUATE });
  return results.violations.map(({ id, nodes }) => ({ id, targets: nodes.map((node) => node.target) }));
}
