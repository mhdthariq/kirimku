// @vitest-environment jsdom

import { useState } from "react";
import { render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
  DialogTrigger,
} from "./dialog";

function Editor({
  open,
  confirmOnClose,
  onOpenChange,
}: {
  open?: boolean;
  confirmOnClose?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  return (
    <Dialog open={open} confirmOnClose={confirmOnClose} onOpenChange={onOpenChange}>
      <DialogTrigger>Edit shipment</DialogTrigger>
      <DialogContent>
        <DialogTitle>Edit shipment</DialogTitle>
        <DialogDescription>Update shipment details.</DialogDescription>
        <form>
          <label htmlFor="recipient">Recipient</label>
          <input id="recipient" defaultValue="" />
        </form>
      </DialogContent>
    </Dialog>
  );
}

function ControlledEditor({
  confirmOnClose,
  onOpenChange,
}: {
  confirmOnClose?: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Editor
      open={open}
      confirmOnClose={confirmOnClose}
      onOpenChange={(next) => {
        onOpenChange(next);
        setOpen(next);
      }}
    />
  );
}

const confirmationName = "Tutup dan buang isian?";

async function expectClosed() {
  await waitFor(() => {
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
  });
}

describe("Dialog unsaved-input guard", () => {
  it.each(["Close", "Escape"])("dismisses a pristine dialog with %s without confirmation", async (gesture) => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<ControlledEditor onOpenChange={onOpenChange} />);

    await user.click(screen.getByRole("button", { name: "Edit shipment" }));
    expect(screen.getByRole("dialog", { name: "Edit shipment" })).toBeVisible();
    onOpenChange.mockClear();

    if (gesture === "Close") {
      await user.click(screen.getByRole("button", { name: "Close" }));
    } else {
      await user.keyboard("{Escape}");
    }

    await expectClosed();
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(screen.getByRole("button", { name: "Edit shipment" })).toHaveFocus();
  });

  it("keeps dirty input on cancel, then discards and closes on confirmation", async () => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    render(<ControlledEditor onOpenChange={onOpenChange} />);

    await user.click(screen.getByRole("button", { name: "Edit shipment" }));
    await user.type(screen.getByRole("textbox", { name: "Recipient" }), "Ada");
    onOpenChange.mockClear();
    await user.click(screen.getByRole("button", { name: "Close" }));

    const confirmation = await screen.findByRole("alertdialog", { name: confirmationName });
    expect(onOpenChange).not.toHaveBeenCalled();
    await user.click(within(confirmation).getByRole("button", { name: "Lanjut mengisi" }));
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Recipient" })).toHaveValue("Ada");
    expect(onOpenChange).not.toHaveBeenCalled();

    await user.keyboard("{Escape}");
    const reopenedConfirmation = await screen.findByRole("alertdialog", { name: confirmationName });
    await user.click(within(reopenedConfirmation).getByRole("button", { name: "Buang & tutup" }));
    await expectClosed();
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);

    await user.click(screen.getByRole("button", { name: "Edit shipment" }));
    expect(screen.getByRole("textbox", { name: "Recipient" })).toHaveValue("");
    await user.keyboard("{Escape}");
    await expectClosed();
  });

  it.each(["Close", "Escape"])("allows dirty dismissal with %s when confirmOnClose is false", async (gesture) => {
    const user = userEvent.setup();
    render(<Editor confirmOnClose={false} />);

    await user.click(screen.getByRole("button", { name: "Edit shipment" }));
    await user.type(screen.getByRole("textbox", { name: "Recipient" }), "Ada");
    if (gesture === "Close") {
      await user.click(screen.getByRole("button", { name: "Close" }));
    } else {
      await user.keyboard("{Escape}");
    }
    await expectClosed();
  });

  it.each([false, true])("clears the guard after parent-driven close/reopen (confirmation active: %s)", async (showConfirmation) => {
    const user = userEvent.setup();
    const onOpenChange = vi.fn();
    const { rerender } = render(<Editor open onOpenChange={onOpenChange} />);

    await user.type(screen.getByRole("textbox", { name: "Recipient" }), "Ada");
    if (showConfirmation) {
      await user.keyboard("{Escape}");
      expect(await screen.findByRole("alertdialog", { name: confirmationName })).toBeVisible();
    }
    expect(onOpenChange).not.toHaveBeenCalled();

    // Rerender the same root: remounting would hide a stale guard regression.
    rerender(<Editor open={false} onOpenChange={onOpenChange} />);
    await expectClosed();
    expect(onOpenChange).not.toHaveBeenCalled();

    rerender(<Editor open onOpenChange={onOpenChange} />);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "Recipient" })).toHaveValue("");
    await user.click(screen.getByRole("button", { name: "Close" }));
    expect(onOpenChange).toHaveBeenCalledExactlyOnceWith(false);
    expect(screen.queryByRole("alertdialog")).not.toBeInTheDocument();

    rerender(<Editor open={false} onOpenChange={onOpenChange} />);
    await expectClosed();
  });
});
