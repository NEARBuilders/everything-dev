// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it } from "vitest";
import {
  createDataTableColumnHelper,
  DataTable,
  type RowSelectionState,
  TablePagination,
} from "./data-table";

interface Person {
  id: string;
  name: string;
  role: string;
  locked?: boolean;
}

const helper = createDataTableColumnHelper<Person>();
const columns = [
  helper.accessor("name", { header: "Name", sortFn: "text" }),
  helper.accessor("role", { header: "Role", enableSorting: false }),
];

const people: Person[] = [
  { id: "1", name: "Carol", role: "admin" },
  { id: "2", name: "Alice", role: "member" },
  { id: "3", name: "Bob", role: "member", locked: true },
];

afterEach(cleanup);

function rowNames() {
  return screen
    .getAllByRole("row")
    .slice(1)
    .map((row) => within(row).getAllByRole("cell").at(0)?.textContent);
}

describe("DataTable", () => {
  it("filters rows by the search term across eligible columns", () => {
    const { rerender } = render(
      <DataTable testId="t" columns={columns} data={people} getRowId={(p) => p.id} />,
    );
    expect(rowNames()).toEqual(["Carol", "Alice", "Bob"]);

    rerender(
      <DataTable testId="t" columns={columns} data={people} getRowId={(p) => p.id} search="ali" />,
    );
    expect(rowNames()).toEqual(["Alice"]);
  });

  it("sorts by a sortable column and leaves non-sortable headers as plain text", () => {
    render(<DataTable testId="t" columns={columns} data={people} getRowId={(p) => p.id} />);

    expect(screen.queryByTestId("sort-role")).toBeNull();
    fireEvent.click(screen.getByTestId("sort-name"));
    expect(rowNames()).toEqual(["Alice", "Bob", "Carol"]);
    fireEvent.click(screen.getByTestId("sort-name"));
    expect(rowNames()).toEqual(["Carol", "Bob", "Alice"]);
  });

  it("shows the empty state when nothing matches", () => {
    render(
      <DataTable
        testId="t"
        columns={columns}
        data={people}
        getRowId={(p) => p.id}
        search="zzz"
        empty="Nobody here"
      />,
    );
    expect(screen.getByText("Nobody here")).toBeTruthy();
  });

  it("selects rows, skips unselectable ones on select-all, and reports ids", () => {
    let latest: RowSelectionState = {};
    function Harness() {
      const [selection, setSelection] = useState<RowSelectionState>({});
      latest = selection;
      return (
        <DataTable
          testId="t"
          columns={columns}
          data={people}
          getRowId={(p) => p.id}
          selectable
          selection={selection}
          onSelectionChange={setSelection}
          isRowSelectable={(p) => !p.locked}
        />
      );
    }
    render(<Harness />);

    fireEvent.click(screen.getByTestId("t.select-all"));
    expect(Object.keys(latest).sort()).toEqual(["1", "2"]);

    fireEvent.click(screen.getByTestId("t.select-all"));
    expect(Object.keys(latest)).toEqual([]);
  });
});

describe("TablePagination", () => {
  it("hides when everything fits on one page", () => {
    const { container } = render(
      <TablePagination testId="p" offset={0} pageSize={20} total={20} onOffsetChange={() => {}} />,
    );
    expect(container.textContent).toBe("");
  });

  it("pages forward and back within bounds", () => {
    const offsets: number[] = [];
    render(
      <TablePagination
        testId="p"
        offset={20}
        pageSize={20}
        total={45}
        onOffsetChange={(offset) => offsets.push(offset)}
      />,
    );

    expect(screen.getByTestId("p").textContent).toContain("21–40 of 45");
    fireEvent.click(screen.getByTestId("p.prev"));
    fireEvent.click(screen.getByTestId("p.next"));
    expect(offsets).toEqual([0, 40]);
  });
});
