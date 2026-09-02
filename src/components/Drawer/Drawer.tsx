"use client";

import * as Dialog from "@radix-ui/react-dialog";
import type { ReactNode } from "react";
import styles from "./Drawer.module.css";

export type DrawerProps = {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  idLabel: string;
  children: ReactNode;
};

/**
 * Right-hand detail drawer. Wraps @radix-ui/react-dialog, which supplies the
 * focus trap, Escape-to-close, scrim-click-to-close (via onOpenChange) and
 * unmounts the tree when `open` is false. Styling is the ported prototype CSS.
 */
export function Drawer({
  open,
  onClose,
  title,
  idLabel,
  children,
}: DrawerProps) {
  return (
    <Dialog.Root
      open={open}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className={styles.scrim} data-testid="drawer-scrim" />
        <Dialog.Content
          className={styles.drawer}
          aria-label={idLabel}
          aria-describedby={undefined}
        >
          <div className={styles.drHead}>
            <div>
              <div className={styles.drId}>{idLabel}</div>
              <Dialog.Title className={styles.drTitle}>{title}</Dialog.Title>
            </div>
            <Dialog.Close className={styles.drClose} aria-label="Close">
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" />
              </svg>
            </Dialog.Close>
          </div>
          <div className={styles.drBody}>{children}</div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
