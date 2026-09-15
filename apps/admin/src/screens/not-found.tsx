import { Link } from "@tanstack/react-router";
import { pageTitle } from "../page-title";

export function NotFoundScreen() {
  return (
    <section className="flex flex-col gap-2">
      <title>{pageTitle("Page not found")}</title>
      <h1 className="text-xl font-semibold tracking-tight">Page not found</h1>
      <p className="text-sm text-muted-foreground">
        Nothing lives at this address. <Link to="/questionnaires" activeOptions={{ exact: true }} className="font-medium text-foreground underline underline-offset-4">Back to questionnaires</Link>
      </p>
    </section>
  );
}
