"use client";

import type { ReactNode } from "react";

/** Submit button that asks for confirmation first (for deletes). */
export function ConfirmButton({ message, children, className, formAction }: {
  message: string;
  children: ReactNode;
  className?: string;
  formAction?: (formData: FormData) => void | Promise<void>;
}) {
  return (
    <button
      type="submit"
      formAction={formAction}
      className={className ?? "text-sm text-bad hover:underline"}
      onClick={(e) => {
        if (!window.confirm(message)) e.preventDefault();
      }}
    >
      {children}
    </button>
  );
}
