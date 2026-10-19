// @vitest-environment jsdom
import { act, render } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { PrintPreview } from "@/components/app/print-preview";

afterEach(() => vi.restoreAllMocks());

describe("responsive paper previews", () => {
    it.each([320, 375, 390, 430, 1024])(
        "fits A4 into a %ipx screen without changing paper geometry",
        (width) => {
            vi.spyOn(
                HTMLElement.prototype,
                "clientWidth",
                "get",
            ).mockReturnValue(width);
            vi.spyOn(
                HTMLElement.prototype,
                "offsetWidth",
                "get",
            ).mockReturnValue(794);
            vi.spyOn(
                HTMLElement.prototype,
                "offsetHeight",
                "get",
            ).mockReturnValue(1123);
            const { container } = render(
                <PrintPreview paper="a4">
                    <article className="a4-sheet">Document</article>
                </PrintPreview>,
            );
            const scale = Math.min(1, width / 794);
            expect(
                container.querySelector(".paper-preview-content"),
            ).toHaveStyle({ transform: `scale(${scale})` });
            expect(
                parseFloat(
                    (
                        container.querySelector(
                            ".paper-preview-page",
                        ) as HTMLElement
                    ).style.height,
                ),
            ).toBeCloseTo(1123 * scale, 2);
            expect(container.querySelector("article")).toHaveClass("a4-sheet");
        },
    );

    it("recalculates after rotation and when asynchronous content changes height", () => {
        let width = 375;
        let height = 1123;
        let notify: (() => void) | undefined;
        const disconnect = vi.fn();
        vi.stubGlobal(
            "ResizeObserver",
            class {
                constructor(callback: () => void) {
                    notify = callback;
                }
                observe() {}
                disconnect = disconnect;
            },
        );
        vi.spyOn(
            HTMLElement.prototype,
            "clientWidth",
            "get",
        ).mockImplementation(() => width);
        vi.spyOn(HTMLElement.prototype, "offsetWidth", "get").mockReturnValue(
            794,
        );
        vi.spyOn(
            HTMLElement.prototype,
            "offsetHeight",
            "get",
        ).mockImplementation(() => height);
        const { container, unmount } = render(
            <PrintPreview paper="a4">
                <article>Document</article>
            </PrintPreview>,
        );
        width = 700;
        height = 2246;
        act(() => notify?.());
        expect(
            parseFloat(
                (container.querySelector(".paper-preview-page") as HTMLElement)
                    .style.height,
            ),
        ).toBeCloseTo((2246 * 700) / 794, 2);
        unmount();
        expect(disconnect).toHaveBeenCalled();
        vi.unstubAllGlobals();
    });
});
