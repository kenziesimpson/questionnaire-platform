import { render, screen, within } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import {
  Table,
  TableBody,
  TableCaption,
  TableCell,
  TableFooter,
  TableHead,
  TableHeader,
  TableRow,
} from "../../src/primitives/table";
import { violationsIn } from "../axe";

function QuestionnaireTable() {
  return (
    <Table>
      <TableCaption>Questionnaires</TableCaption>
      <TableHeader>
        <TableRow>
          <TableHead>Name</TableHead>
          <TableHead>Current version</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        <TableRow>
          <TableCell>Patient intake</TableCell>
          <TableCell>2</TableCell>
        </TableRow>
        <TableRow>
          <TableCell>Follow-up</TableCell>
          <TableCell>1</TableCell>
        </TableRow>
      </TableBody>
      <TableFooter>
        <TableRow>
          <TableCell colSpan={2}>2 questionnaires</TableCell>
        </TableRow>
      </TableFooter>
    </Table>
  );
}

describe("Table", () => {
  it("renders a native table named by its caption, with column headers and one row per body row", () => {
    render(<QuestionnaireTable />);

    const table = screen.getByRole("table", { name: "Questionnaires" });
    expect(table.tagName).toBe("TABLE");
    expect(within(table).getAllByRole("columnheader").map((header) => header.textContent)).toEqual(["Name", "Current version"]);
    expect(within(table).getAllByRole("row")).toHaveLength(4);
    expect(within(table).getByRole("cell", { name: "Patient intake" })).toBeInTheDocument();
  });

  it("passes className through to the table element", () => {
    render(
      <Table className="custom-table">
        <TableBody>
          <TableRow>
            <TableCell>Only</TableCell>
          </TableRow>
        </TableBody>
      </Table>,
    );

    expect(screen.getByRole("table")).toHaveClass("custom-table");
  });

  it("finds no axe violations", async () => {
    const { container } = render(<QuestionnaireTable />);

    expect(await violationsIn(container)).toEqual([]);
  });
});
