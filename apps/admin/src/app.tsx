import { Button } from "@qp/ui/primitives/button";

export function App() {
  return (
    <main className="mx-auto flex min-h-svh max-w-2xl flex-col gap-4 p-6">
      <h1 className="text-2xl font-semibold">Questionnaire admin</h1>
      <Button type="button">New questionnaire</Button>
    </main>
  );
}
