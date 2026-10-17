// @vitest-environment jsdom
import { render, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { DataTable, type Column } from "@/components/app/data-table";

interface Row {
    id: number;
    name: string;
    destination: string;
    internalNote: string;
}

const rows: Row[] = [
    {
        id: 1,
        name: "TRP-001",
        destination: "Jakarta",
        internalNote: "Internal A",
    },
    {
        id: 2,
        name: "TRP-002",
        destination: "Bandung",
        internalNote: "Internal B",
    },
];

const columns: Column<Row>[] = [
    {
        key: "name",
        header: "Transport",
        primary: true,
        render: (row) => row.name,
    },
    {
        key: "destination",
        header: "Destination",
        render: (row) => row.destination,
    },
    {
        key: "internalNote",
        header: "Internal note",
        hideOnMobile: true,
        render: (row) => row.internalNote,
    },
];

function renderCard(row: Row) {
    return (
        <article aria-label={`Card ${row.name}`}>
            {row.name} to {row.destination}
        </article>
    );
}

describe("DataTable responsive cards", () => {
    it("keeps the default md table and stacked column-based cards", () => {
        render(<DataTable columns={columns} rows={rows} />);

        const table = screen.getByRole("table");
        expect(table.parentElement).toHaveClass("hidden", "md:block");
        expect(table.parentElement).not.toHaveClass("xl:block");
        expect(
            within(table)
                .getAllByRole("columnheader")
                .map((header) => header.textContent),
        ).toEqual(["Transport", "Destination", "Internal note"]);
        expect(within(table).getAllByRole("row")).toHaveLength(3);
        expect(within(table).getByText("Internal A")).toBeInTheDocument();

        const cards = table.parentElement!.nextElementSibling as HTMLElement;
        expect(cards).toHaveClass("space-y-2.5", "md:hidden");
        expect(cards).not.toHaveClass("grid", "xl:hidden");
        expect(cards.children).toHaveLength(rows.length);
        rows.forEach((row, index) => {
            const card = within(cards.children[index] as HTMLElement);
            expect(card.getByText(row.name)).toBeInTheDocument();
            expect(card.getByText("Destination")).toBeInTheDocument();
            expect(card.getByText(row.destination)).toBeInTheDocument();
            expect(card.queryByText("Transport")).not.toBeInTheDocument();
            expect(card.queryByText("Internal note")).not.toBeInTheDocument();
            expect(card.queryByText(row.internalNote)).not.toBeInTheDocument();
        });
    });

    it("renders row-specific custom cards without changing the default md breakpoint or table", () => {
        render(
            <DataTable columns={columns} rows={rows} renderCard={renderCard} />,
        );

        const table = screen.getByRole("table");
        expect(table.parentElement).toHaveClass("md:block");
        expect(
            within(table).getByRole("cell", { name: "Jakarta" }),
        ).toBeInTheDocument();
        expect(
            within(table).getByRole("cell", { name: "Bandung" }),
        ).toBeInTheDocument();
        const cards = table.parentElement!.nextElementSibling as HTMLElement;
        expect(cards).toHaveClass(
            "grid",
            "gap-4",
            "md:grid-cols-2",
            "md:hidden",
        );
        expect(within(cards).getAllByRole("article")).toHaveLength(rows.length);
        rows.forEach((row) => {
            expect(
                within(cards).getByRole("article", {
                    name: `Card ${row.name}`,
                }),
            ).toHaveTextContent(`${row.name} to ${row.destination}`);
        });
        expect(
            within(cards).queryByText("Destination"),
        ).not.toBeInTheDocument();
        expect(within(cards).queryByRole("definition")).not.toBeInTheDocument();
    });

    it("uses xl visibility classes and a responsive grid for custom cards", () => {
        render(
            <DataTable
                columns={columns}
                rows={rows}
                renderCard={renderCard}
                desktopBreakpoint="xl"
            />,
        );

        const table = screen.getByRole("table");
        expect(table.parentElement).toHaveClass("hidden", "xl:block");
        expect(table.parentElement).not.toHaveClass("md:block");
        const cards = table.parentElement!.nextElementSibling as HTMLElement;
        expect(cards).toHaveClass(
            "grid",
            "gap-4",
            "md:grid-cols-2",
            "xl:hidden",
        );
        expect(cards).not.toHaveClass("md:hidden", "space-y-2.5");
        expect(within(cards).getAllByRole("article")).toHaveLength(rows.length);
    });

    it("allows xl visibility with the existing column-based cards when renderCard is omitted", () => {
        render(
            <DataTable columns={columns} rows={rows} desktopBreakpoint="xl" />,
        );

        const table = screen.getByRole("table");
        expect(table.parentElement).toHaveClass("xl:block");
        expect(table.parentElement).not.toHaveClass("md:block");
        const cards = table.parentElement!.nextElementSibling as HTMLElement;
        expect(cards).toHaveClass("space-y-2.5", "xl:hidden");
        expect(cards).not.toHaveClass("grid", "md:hidden");
        expect(within(cards).getAllByText("Destination")).toHaveLength(
            rows.length,
        );
    });

    it.each([
        { state: "populated", loadingRows: rows },
        { state: "empty", loadingRows: [] },
    ])(
        "preserves loading skeletons with $state rows instead of rendering content",
        ({ loadingRows }) => {
            const customCard = vi.fn(renderCard);
            const { container } = render(
                <DataTable
                    columns={columns}
                    rows={loadingRows}
                    loading
                    renderCard={customCard}
                    desktopBreakpoint="xl"
                />,
            );

            expect(
                container.querySelectorAll('[data-slot="skeleton"]'),
            ).toHaveLength(4);
            expect(screen.queryByRole("table")).not.toBeInTheDocument();
            expect(screen.queryByRole("article")).not.toBeInTheDocument();
            expect(
                screen.queryByText("Belum ada data."),
            ).not.toBeInTheDocument();
            expect(customCard).not.toHaveBeenCalled();
        },
    );

    it("preserves the default empty message without the optional props", () => {
        render(<DataTable columns={columns} rows={[]} />);

        expect(screen.getByText("Belum ada data.")).toBeInTheDocument();
        expect(screen.queryByRole("table")).not.toBeInTheDocument();
    });

    it("preserves a custom empty message and action without invoking renderCard", () => {
        const customCard = vi.fn(renderCard);
        const { container } = render(
            <DataTable
                columns={columns}
                rows={[]}
                renderCard={customCard}
                desktopBreakpoint="xl"
                emptyMessage="No transports found."
                emptyAction={<button>Add transport</button>}
            />,
        );

        expect(screen.getByText("No transports found.")).toBeInTheDocument();
        expect(
            screen.getByRole("button", { name: "Add transport" }),
        ).toBeInTheDocument();
        expect(screen.queryByText("Belum ada data.")).not.toBeInTheDocument();
        expect(screen.queryByRole("table")).not.toBeInTheDocument();
        expect(screen.queryByRole("article")).not.toBeInTheDocument();
        expect(
            container.querySelector('[data-slot="skeleton"]'),
        ).not.toBeInTheDocument();
        expect(customCard).not.toHaveBeenCalled();
    });
});
