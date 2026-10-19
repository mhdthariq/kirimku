"use client";

import {
    Children,
    useLayoutEffect,
    useRef,
    useState,
    type ReactNode,
} from "react";
import { paginatePaper } from "@/presentation/paginate-paper";
import { createPortal } from "react-dom";

/** Scale paper on screen only; print keeps the original document geometry. */
export function PrintPreview({
    children,
    paper,
}: {
    children: ReactNode;
    paper: "a4" | "label";
}) {
    if (paper === "a4") return <A4Preview>{children}</A4Preview>;
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

function A4Preview({ children }: { children: ReactNode }) {
    const source = useRef<HTMLIFrameElement>(null);
    const [sourceBody, setSourceBody] = useState<HTMLElement | null>(null);
    const [pages, setPages] = useState<string[]>([]);
    useLayoutEffect(() => {
        const document = source.current?.contentDocument;
        if (!document) return;
        document.documentElement.className = window.document.documentElement.className;
        document.body.className = window.document.body.className;
        document.body.style.margin = "0";
        for (const style of window.document.querySelectorAll('style, link[rel="stylesheet"]')) document.head.append(style.cloneNode(true));
        setSourceBody(document.body);
    }, []);
    useLayoutEffect(() => {
        let disposed = false;
        const measure = () => {
            const sheet = sourceBody?.firstElementChild as HTMLElement | null;
            if (!sheet || disposed) return;
            const next = paginatePaper(sheet);
            setPages(previous => JSON.stringify(previous) === JSON.stringify(next) ? previous : next);
        };
        measure();
        void sourceBody?.ownerDocument.fonts?.ready.then(measure);
        const links = Array.from(sourceBody?.ownerDocument.querySelectorAll('link[rel="stylesheet"]') ?? []);
        links.forEach(link => link.addEventListener("load", measure));
        const observer = typeof ResizeObserver === "undefined" ? null : new ResizeObserver(measure);
        if (sourceBody) observer?.observe(sourceBody);
        window.addEventListener("beforeprint", measure);
        return () => { disposed = true; observer?.disconnect(); links.forEach(link => link.removeEventListener("load", measure)); window.removeEventListener("beforeprint", measure); };
    }, [children, sourceBody]);
    return <div className="paper-preview" data-paper="a4">
        <iframe ref={source} title="Mesin tata letak dokumen" data-paper-source aria-hidden="true" tabIndex={-1} style={{ position: "fixed", left: "-100000px", top: 0, width: "210mm", height: "297mm", visibility: "hidden", pointerEvents: "none", border: 0 }} />
        {sourceBody && createPortal(children, sourceBody)}
        {pages.map((markup, index) => <PreviewPage key={index}><div className="paper-page-markup" dangerouslySetInnerHTML={{ __html: markup }} /></PreviewPage>)}
    </div>;
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
