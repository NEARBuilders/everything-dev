import { CaretDownIcon, CaretUpDownIcon, CaretUpIcon } from "@phosphor-icons/react";
import {
  type ColumnDef,
  columnFilteringFeature,
  createColumnHelper,
  createFilteredRowModel,
  createSortedRowModel,
  filterFn_includesString,
  globalFilteringFeature,
  type Header,
  type ReactTable,
  type RowData,
  type RowSelectionState,
  rowSelectionFeature,
  rowSortingFeature,
  sortFn_alphanumeric,
  sortFn_datetime,
  sortFn_text,
  tableFeatures,
  useTable,
} from "@tanstack/react-table";
import { cn } from "cn";
import type { ReactNode } from "react";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

export const dataTableFeatures = tableFeatures({
  rowSortingFeature,
  sortedRowModel: createSortedRowModel(),
  sortFns: {
    alphanumeric: sortFn_alphanumeric,
    text: sortFn_text,
    datetime: sortFn_datetime,
  },
  columnFilteringFeature,
  globalFilteringFeature,
  filteredRowModel: createFilteredRowModel(),
  filterFns: { includesString: filterFn_includesString },
  rowSelectionFeature,
});

export type DataTableFeatures = typeof dataTableFeatures;

export type DataTableColumnDef<TData extends RowData> = ColumnDef<DataTableFeatures, TData, any>;

export function createDataTableColumnHelper<TData extends RowData>() {
  return createColumnHelper<DataTableFeatures, TData>();
}

export type { RowSelectionState };

export interface DataTableProps<TData extends RowData> {
  columns: DataTableColumnDef<TData>[];
  data: TData[];
  getRowId: (row: TData) => string;
  testId: string;
  search?: string;
  selectable?: boolean;
  selection?: RowSelectionState;
  onSelectionChange?: (selection: RowSelectionState) => void;
  isRowSelectable?: (row: TData) => boolean;
  empty?: ReactNode;
}

const NO_SELECTION: RowSelectionState = {};

export function DataTable<TData extends RowData>({
  columns,
  data,
  getRowId,
  testId,
  search = "",
  selectable = false,
  selection = NO_SELECTION,
  onSelectionChange,
  isRowSelectable,
  empty,
}: DataTableProps<TData>) {
  const table = useTable({
    features: dataTableFeatures,
    columns,
    data,
    getRowId,
    globalFilterFn: "includesString",
    enableRowSelection: selectable
      ? (row) => (isRowSelectable ? isRowSelectable(row.original) : true)
      : false,
    state: { globalFilter: search, rowSelection: selection },
    onRowSelectionChange: (updater) => {
      const next = typeof updater === "function" ? updater(selection) : updater;
      onSelectionChange?.(next);
    },
  });

  const rows = table.getRowModel().rows;

  return (
    <div className="overflow-x-auto rounded-2xl border border-border" data-testid={testId}>
      <Table>
        <TableHeader>
          {table.getHeaderGroups().map((group) => (
            <TableRow key={group.id}>
              {selectable && (
                <TableHead className="w-10">
                  <Checkbox
                    aria-label="Select all rows"
                    checked={table.getIsAllRowsSelected()}
                    indeterminate={table.getIsSomeRowsSelected()}
                    onCheckedChange={(checked) => table.toggleAllRowsSelected(checked)}
                    data-testid={`${testId}.select-all`}
                  />
                </TableHead>
              )}
              {group.headers.map((header) => (
                <TableHead key={header.id}>
                  {header.isPlaceholder ? null : <SortableHeader table={table} header={header} />}
                </TableHead>
              ))}
            </TableRow>
          ))}
        </TableHeader>
        <TableBody>
          {rows.length === 0 ? (
            <TableRow>
              <TableCell
                colSpan={columns.length + (selectable ? 1 : 0)}
                className="h-24 text-center"
              >
                <div className="text-muted-foreground">{empty ?? "No results."}</div>
              </TableCell>
            </TableRow>
          ) : (
            rows.map((row) => (
              <TableRow
                key={row.id}
                data-state={row.getIsSelected() ? "selected" : undefined}
                data-testid={`${testId}.row-${row.id}`}
              >
                {selectable && (
                  <TableCell className="w-10">
                    <Checkbox
                      aria-label="Select row"
                      checked={row.getIsSelected()}
                      disabled={!row.getCanSelect()}
                      onCheckedChange={(checked) => row.toggleSelected(checked)}
                    />
                  </TableCell>
                )}
                {row.getAllCells().map((cell) => (
                  <TableCell key={cell.id}>
                    <table.FlexRender cell={cell} />
                  </TableCell>
                ))}
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>
    </div>
  );
}

function SortableHeader<TData extends RowData>({
  table,
  header,
}: {
  table: ReactTable<DataTableFeatures, TData>;
  header: Header<DataTableFeatures, TData>;
}) {
  const content = <table.FlexRender header={header} />;
  if (!header.column.getCanSort()) return content;
  const sorted = header.column.getIsSorted();
  const Icon = sorted === "asc" ? CaretUpIcon : sorted === "desc" ? CaretDownIcon : CaretUpDownIcon;
  return (
    <Button
      variant="ghost"
      size="sm"
      className="-ml-3"
      onClick={header.column.getToggleSortingHandler()}
      data-testid={`sort-${header.column.id}`}
    >
      {content}
      <Icon className={cn("size-3.5", !sorted && "text-muted-foreground")} />
    </Button>
  );
}

export function TablePagination({
  offset,
  pageSize,
  total,
  onOffsetChange,
  testId,
}: {
  offset: number;
  pageSize: number;
  total: number;
  onOffsetChange: (offset: number) => void;
  testId: string;
}) {
  if (total <= pageSize) return null;
  return (
    <div className="flex items-center justify-end gap-2" data-testid={testId}>
      <span className="text-sm text-muted-foreground tabular-nums">
        {offset + 1}–{Math.min(offset + pageSize, total)} of {total}
      </span>
      <Button
        variant="outline"
        size="sm"
        disabled={offset === 0}
        onClick={() => onOffsetChange(Math.max(0, offset - pageSize))}
        data-testid={`${testId}.prev`}
      >
        Previous
      </Button>
      <Button
        variant="outline"
        size="sm"
        disabled={offset + pageSize >= total}
        onClick={() => onOffsetChange(offset + pageSize)}
        data-testid={`${testId}.next`}
      >
        Next
      </Button>
    </div>
  );
}
