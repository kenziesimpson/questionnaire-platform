async function main() {
  console.log("Seed: no domain schema yet — nothing to seed. See docs/4-implementation-plan.md Phase 0.");
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});
