/**
 * One-shot seed runner, invoked by the `migrate` compose service after
 * migrations succeed. Will insert the mandatory branching demo questionnaire
 * (medical-condition yes/no → conditional follow-ups) once the questionnaire
 * schema and authoring service exist — see docs/2-design-doc.md "Mandatory
 * branching demo" and §5/§6/§7.
 *
 * Placeholder for now: no schema to seed against yet.
 */

async function main() {
  console.log("Seed: no domain schema yet — nothing to seed. See docs/4-implementation-plan.md Phase 0.");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
