/**
 * @qp/shared — types and logic shared between the backend and the frontend.
 *
 * This will grow to hold:
 *  - Wire types for questionnaire/question/rule definitions (design-doc §5).
 *  - The conditional-branching rule engine, so the client (rendering) and the
 *    server (submit-time authority) evaluate the exact same logic (design-doc §7, §8).
 *
 * Intentionally empty scaffolding until those decisions land — see
 * docs/2-design-doc.md and docs/4-implementation-plan.md.
 */

export const SHARED_PACKAGE_NAME = "@qp/shared";
