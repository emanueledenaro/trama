import { IconAlertTriangle, IconCircleCheck, IconX } from "@/components/icons";
import { useEffect } from "react";
import { useT } from "@/lib/i18n";
import { act, useUi } from "@/lib/store";

export function Toast() {
  const t = useT();
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
    // Top right, under the 46 px title bar: at the bottom it lay over the composer's tools.
    <div className="pointer-events-none fixed top-14 right-3 z-[70] flex w-[min(32rem,calc(100%-1.5rem))] justify-end">
      <div
        role={info ? "status" : "alert"}
        className="translucent-popup pointer-events-auto flex max-h-[calc(100vh-86px)] min-w-0 max-w-full items-start gap-2.5 overflow-y-auto rounded-xl px-3.5 py-2.5 text-ui"
      >
        {info ? (
          <IconCircleCheck className="mt-0.5 size-4 shrink-0 text-muted-foreground" />
        ) : (
          <IconAlertTriangle className="mt-0.5 size-4 shrink-0 text-warning" />
        )}
        <span className="min-w-0 flex-1 break-words text-foreground/90">{message}</span>
        <button type="button" onClick={dismiss} className="sidebar-icon-button size-5 shrink-0 rounded-md" aria-label={t("toast.close")}>
          <IconX className="size-3.5" />
        </button>
      </div>
    </div>
  );
}
