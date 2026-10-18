"use client";

import {
    Children,
    useLayoutEffect,
    useRef,
    useState,
    type ReactNode,
} from "react";

/** Scale paper on screen only; print keeps the original document geometry. */
export function PrintPreview({
    children,
    paper,
}: {
    children: ReactNode;
    paper: "a4" | "label";
}) {
    return (
        <div className="paper-preview" data-paper={paper}>
            {paper === "label" && (
                <style media="print">
                    {"@page { size: 100mm 100mm; margin: 0; }"}
                </style>
            )}
            {Children.map(
                children,
                (child) => child && <PreviewPage>{child}</PreviewPage>,
            )}
        </div>
    );
}

function PreviewPage({ children }: { children: ReactNode }) {
    const viewport = useRef<HTMLDivElement>(null);
    const content = useRef<HTMLDivElement>(null);
    const [geometry, setGeometry] = useState({ scale: 1, height: 0 });

    useLayoutEffect(() => {
        const frame = viewport.current;
        const sheet = content.current;
        if (!frame || !sheet) return;
        const measure = () => {
            if (!frame.clientWidth || !sheet.offsetWidth) return;
            const scale = Math.min(1, frame.clientWidth / sheet.offsetWidth);
            const height = sheet.offsetHeight * scale;
            setGeometry((previous) =>
                previous.scale === scale && previous.height === height
                    ? previous
                    : { scale, height },
            );
        };
        measure();
        const observer =
            typeof ResizeObserver === "undefined"
                ? null
                : new ResizeObserver(measure);
        observer?.observe(frame);
        observer?.observe(sheet);
        window.addEventListener("resize", measure);
        return () => {
            observer?.disconnect();
            window.removeEventListener("resize", measure);
        };
    }, []);

    return (
        <div
            ref={viewport}
            className="paper-preview-page"
            style={{ height: geometry.height || undefined }}
        >
            <div
                ref={content}
                className="paper-preview-content"
                style={{ transform: `scale(${geometry.scale})` }}
            >
                {children}
            </div>
        </div>
    );
}
