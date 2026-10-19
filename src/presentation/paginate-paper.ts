/** Paginate sanitized React-rendered paper markup using actual browser geometry.
 * Repeated table headings and footers are cloned; every data row occurs once.
 */
export function paginatePaper(source: HTMLElement): string[] {
  if (!source.offsetHeight || !source.children.length) return [source.outerHTML]; // SSR / jsdom
  const document = source.ownerDocument;
  const workspace = document.createElement("div");
  workspace.style.cssText = "position:fixed;left:-100000px;top:0;width:210mm;visibility:hidden;pointer-events:none";
  document.body.append(workspace);
  const originalFlow = source.querySelector<HTMLElement>("[data-paper-flow]") ?? source;
  const blocks = Array.from(originalFlow.children) as HTMLElement[];
  const header = blocks.shift();
  const footerIndex = blocks.findIndex(block => block.matches("footer, .invoice-print-footer, .manifest-print-footer"));
  const footer = footerIndex >= 0 ? blocks.splice(footerIndex, 1)[0] : null;
  const pages: HTMLElement[] = [];
  let sheet: HTMLElement;
  let flow: HTMLElement;
  let pageFooter: HTMLElement | null;
  function newPage() {
    sheet = source.cloneNode(false) as HTMLElement;
    sheet.removeAttribute("id");
    sheet.style.margin = "0";
    workspace.append(sheet);
    flow = originalFlow === source ? sheet : originalFlow.cloneNode(false) as HTMLElement;
    if (flow !== sheet) sheet.append(flow);
    if (header) flow.append(header.cloneNode(true));
    pageFooter = footer ? footer.cloneNode(true) as HTMLElement : null;
    if (pageFooter) flow.append(pageFooter);
    pages.push(sheet);
  }
  function append(block: HTMLElement) { flow.insertBefore(block, pageFooter); }
  function fits() {
    const bottom = sheet.getBoundingClientRect().bottom - parseFloat(getComputedStyle(sheet).paddingBottom);
    return Array.from(flow.children).every(child => child.getBoundingClientRect().bottom <= bottom + 0.5);
  }
  function appendBlock(block: HTMLElement) {
    append(block);
    if (!fits()) {
      block.remove();
      newPage(); append(block);
      if (!fits()) sheet.dataset.paperOverflow = "true";
    }
  }
  try {
    newPage();
    for (const original of blocks) {
      const table = original.matches("table") ? original as HTMLTableElement : original.querySelector("table");
      const rows = table?.tBodies[0] ? Array.from(table.tBodies[0].rows) : [];
      if (!table || rows.length === 0) { appendBlock(original.cloneNode(true) as HTMLElement); continue; }
      let shell: HTMLElement;
      let body: HTMLTableSectionElement;
      function startTable() {
        shell = original.cloneNode(true) as HTMLElement;
        const nextTable = shell.matches("table") ? shell as HTMLTableElement : shell.querySelector("table")!;
        body = nextTable.tBodies[0]; body.replaceChildren();
        nextTable.tFoot?.remove();
        append(shell);
      }
      startTable();
      for (const row of rows) {
        const copy = row.cloneNode(true) as HTMLTableRowElement;
        body!.append(copy);
        if (!fits()) {
          copy.remove();
          if (body!.rows.length === 0) shell!.remove();
          newPage(); startTable(); body!.append(copy);
          if (!fits()) sheet!.dataset.paperOverflow = "true";
        }
      }
      if (table.tFoot) {
        const totals = table.tFoot.cloneNode(true) as HTMLTableSectionElement;
        body!.parentElement!.append(totals);
        if (!fits()) { totals.remove(); newPage(); startTable(); body!.parentElement!.append(totals); }
      }
    }
    return pages.map((page, index) => {
      page.dataset.paperPage = String(index + 1);
      return page.outerHTML;
    });
  } finally { workspace.remove(); }
}
