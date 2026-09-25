import { IconAlertTriangle, IconCircleCheck, IconX } from "@tabler/icons-react";
import { useEffect } from "react";
import { act, useUi } from "@/lib/store";

export function Toast() {
  const toast = useUi((s) => s.toast);
  const appError = useUi((s) => s.app?.error ?? null);
  const setToast = useUi((s) => s.setToast);
  const message = toast ?? appError;
  // Only a toast set as "info" is a plain confirmation; the app's errors always warn.
  const info = useUi((s) => s.toastTone === "info") && Boolean(toast);

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
      <div role={info ? "status" : "alert"} className="translucent-popup pointer-events-auto flex max-w-lg items-start gap-2.5 rounded-xl px-3.5 py-2.5 text-ui">
        {info ? (
          <IconCircleCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        ) : (
          <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
        )}
        <span className="min-w-0 flex-1 text-foreground/90">{message}</span>
        <button type="button" onClick={dismiss} className="sidebar-icon-button size-5 rounded-md" aria-label="Chiudi">
          <IconX className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
