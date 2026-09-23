import { IconAlertTriangle, IconX } from "@tabler/icons-react";
import { useEffect } from "react";
import { act, useUi } from "@/lib/store";

export function Toast() {
  const toast = useUi((s) => s.toast);
  const appError = useUi((s) => s.app?.error ?? null);
  const setToast = useUi((s) => s.setToast);
  const message = toast ?? appError;

  useEffect(() => {
    if (!toast) return;
    const timer = setTimeout(() => setToast(null), 7_000);
    return () => clearTimeout(timer);
  }, [toast, setToast]);

  if (!message) return null;
  const dismiss = () => {
    if (toast) setToast(null);
    else void act("app:dismissError", undefined);
  };
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-[70] flex justify-center px-4">
      <div role="alert" className="translucent-popup pointer-events-auto flex max-w-lg items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-ui">
        <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
        <span className="min-w-0 flex-1 text-foreground/90">{message}</span>
        <button type="button" onClick={dismiss} className="sidebar-icon-button size-5 rounded-md" aria-label="Chiudi">
          <IconX className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
