"use client";
import { gameErrorKey } from "@/i18n/game-messages";

import { useTranslations, useFormatter } from "next-intl";

import {
  useEffect,
  useId,
  useRef,
  useState,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode
} from "react";
import { createPortal } from "react-dom";

export function Button({
  variant = "primary",
  className = "",
  type = "button",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "danger";
}) {
  return (
    <button
      type={type}
      className={`yk-button yk-button-${variant} ${className}`}
      {...props}
    />
  );
}
export function Chip({
  active = false,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { active?: boolean }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      className={`yk-chip ${className}`}
      {...props}
    />
  );
}
export { Pagination } from "@/components/ui/pagination";
export function StatusPill({
  children,
  tone = "gold"
}: {
  children: ReactNode;
  tone?: "gold" | "success" | "danger" | "info" | "neutral";
}) {
  const tones = {
    gold: "bg-accent-gold/14 text-karas",
    success: "bg-success/14 text-success",
    danger: "bg-danger/14 text-danger-ink",
    info: "bg-accent-neon/14 text-accent-neon",
    neutral: "bg-veil text-ink-3"
  };
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-semibold ${tones[tone]}`}
    >
      {children}
    </span>
  );
}
export function Karas({
  amount,
  className = ""
}: {
  amount?: number | null;
  className?: string;
}) {
  const tu = useTranslations("collectionShared");
  const format = useFormatter();
  return (
    <span
      className={`yk-karas inline-flex items-center gap-2 text-karas tabular-nums ${className}`}
      aria-label={
        amount == null
          ? tu("karasBalanceUnavailable")
          : `${format.number(amount)} Karas`
      }
    >
      <span aria-hidden="true" className="yk-karas-gem" />
      {amount == null ? "—" : format.number(amount)}
    </span>
  );
}
export function SelectionModeButton({
  active,
  onClick,
  className = "",
  inactiveLabel = "Select cards",
  activeLabel = "Exit selection"
}: {
  active: boolean;
  onClick: () => void;
  className?: string;
  inactiveLabel?: string;
  activeLabel?: string;
}) {
  const tu = useTranslations("collectionShared");
  return (
    <Button
      variant="secondary"
      className={`yk-selection-mode ${className}`}
      aria-pressed={active}
      onClick={onClick}
    >
      <svg
        aria-hidden="true"
        className="yk-selection-mode-icon"
        width="20"
        height="20"
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <circle cx="12" cy="12" r="8.5" />
        {active && <path d="m8.5 12.2 2.3 2.3 4.7-4.9" />}
      </svg>
      <span className="yk-selection-mode-label">
        {active
          ? activeLabel === "Exit selection"
            ? tu("exitSelection")
            : activeLabel
          : inactiveLabel === "Select cards"
            ? tu("selectCards")
            : inactiveLabel}
      </span>
    </Button>
  );
}
export function SelectionBar({
  count,
  value,
  busy,
  error,
  itemLabel = "carte",
  actions,
  onAll,
  onNone,
  onDestroy,
  onClose
}: {
  count: number;
  value?: number;
  busy?: boolean;
  error?: string;
  itemLabel?: "carte" | "exemplaire";
  actions?: ReactNode;
  onAll: () => void;
  onNone: () => void;
  onDestroy: () => void;
  onClose: () => void;
}) {
  const tError = useTranslations();
  const tu = useTranslations("collectionShared");
  const format = useFormatter();
  return (
    <div className="yk-selection-bar">
      <span className="text-sm">
        <strong>{format.number(count)}</strong>{" "}
        {itemLabel === "carte"
          ? count === 1
            ? tu("countPluralOneCardOtherCards", { count: count })
            : tu("countPluralOneCardOtherCards", { count: count })
          : count === 1
            ? tu("countPluralOneCopyOtherCopies", { count: count })
            : tu("countPluralOneCopyOtherCopies", { count: count })}{" "}
        {tu("selected", { item: itemLabel, count })}
      </span>
      <Karas amount={value} />
      <button
        type="button"
        disabled={busy}
        className="text-xs text-ink-2"
        onClick={onAll}
      >
        {tu("all")}
      </button>
      <button
        type="button"
        disabled={busy}
        className="text-xs text-ink-2"
        onClick={onNone}
      >
        {tu("none")}
      </button>
      {actions}
      {error && (
        <span role="alert" className="text-xs text-danger">
          {tError(gameErrorKey(error))}
        </span>
      )}
      <Button variant="danger" disabled={!count || busy} onClick={onDestroy}>
        {busy ? tu("destroying") : tu("destroySelected")}
      </Button>
      <button
        type="button"
        disabled={busy}
        aria-label={tu("exitMultiSelect")}
        title={tu("exitMultiSelect")}
        className="flex size-9 shrink-0 items-center justify-center rounded-full border border-veil text-lg leading-none text-ink-2 transition-colors hover:border-veil-strong hover:bg-veil hover:text-ink"
        onClick={onClose}
      >
        ×
      </button>
    </div>
  );
}
export function Avatar({
  name,
  image,
  online,
  onlineLabel,
  size = 40
}: {
  name: string | null | undefined;
  image?: string;
  online?: boolean;
  onlineLabel?: string;
  size?: number;
}) {
  const displayName = name || "Deleted player";
  return (
    <span
      className="relative inline-flex shrink-0 items-center justify-center rounded-full border border-accent-gold/40 bg-veil font-display font-semibold text-accent-gold"
      style={{ width: size, height: size }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      {image ? (
        <img
          src={image}
          alt={displayName}
          width={size}
          height={size}
          loading="lazy"
          decoding="async"
          className="size-full rounded-full object-cover"
        />
      ) : (
        <span aria-label={displayName}>
          {displayName.slice(0, 1).toLocaleUpperCase("en-US") || "?"}
        </span>
      )}
      {online !== undefined && (
        <span
          aria-label={onlineLabel ?? (online ? "Online" : "Offline")}
          className={`absolute right-0 bottom-0 size-2.5 rounded-full border-2 border-night ${online ? "bg-success" : "bg-ink-3"}`}
        />
      )}
    </span>
  );
}
let modalLockCount = 0;
let bodyOverflowBeforeModal = "";

function lockModalScroll() {
  if (modalLockCount === 0)
    bodyOverflowBeforeModal = document.body.style.overflow;
  modalLockCount += 1;
  document.body.style.overflow = "hidden";
}

function unlockModalScroll() {
  modalLockCount = Math.max(0, modalLockCount - 1);
  if (modalLockCount === 0)
    document.body.style.overflow = bodyOverflowBeforeModal;
}

export function Modal({
  open,
  onClose,
  title,
  hideTitle = false,
  children,
  className = ""
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  hideTitle?: boolean;
  children: ReactNode;
  className?: string;
}) {
  const t = useTranslations("common");
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current;
    if (!open || !dialog) return;
    const trigger = document.activeElement as HTMLElement | null;
    if (!dialog.open) dialog.showModal();
    lockModalScroll();
    return () => {
      if (dialog.open) dialog.close();
      unlockModalScroll();
      if (trigger?.isConnected) trigger.focus({ preventScroll: true });
    };
  }, [open]);
  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className={`yk-modal ${className}`}
      onKeyDown={event => {
        if (
          (event.target as HTMLElement).closest("dialog") !==
          event.currentTarget
        )
          return;
        if (event.key !== "Tab") return;
        const controls = Array.from(
          event.currentTarget.querySelectorAll<HTMLElement>(
            'button:not(:disabled),a[href],input:not(:disabled),select:not(:disabled),textarea:not(:disabled),[tabindex]:not([tabindex="-1"])'
          )
        ).filter(element => element.getClientRects().length > 0);
        const first = controls[0];
        const last = controls.at(-1);
        if (!first) return;
        if (
          event.shiftKey &&
          (document.activeElement === first ||
            !event.currentTarget.contains(document.activeElement))
        ) {
          event.preventDefault();
          last?.focus();
        } else if (
          !event.shiftKey &&
          (document.activeElement === last ||
            !event.currentTarget.contains(document.activeElement))
        ) {
          event.preventDefault();
          first.focus();
        }
      }}
      onCancel={e => {
        e.stopPropagation();
        e.preventDefault();
        onClose();
      }}
      onClose={() => {
        if (open && !ref.current?.open) onClose();
      }}
      onClick={e => {
        if (e.target !== e.currentTarget) return;
        const r = e.currentTarget.getBoundingClientRect();
        if (
          e.clientX < r.left ||
          e.clientX > r.right ||
          e.clientY < r.top ||
          e.clientY > r.bottom
        )
          onClose();
      }}
    >
      <div
        className={`mb-6 flex items-center gap-4 ${hideTitle ? "justify-end" : "justify-between"}`}
      >
        <h2
          id={titleId}
          className={
            hideTitle ? "sr-only" : "font-display text-xl font-semibold"
          }
        >
          {title}
        </h2>
        <button
          type="button"
          autoFocus
          onClick={onClose}
          aria-label={t("close")}
          className="size-9 shrink-0 rounded-full border border-veil text-ink-2 hover:bg-veil"
        >
          ✕
        </button>
      </div>
      {open && children}
    </dialog>
  );
}
export function Toast({
  message,
  onDismiss
}: {
  message: string;
  onDismiss: () => void;
}) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setMounted(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(onDismiss, 2600);
    return () => clearTimeout(timer);
  }, [message, onDismiss]);
  return mounted && message
    ? createPortal(
        <div role="status" className="yk-toast">
          {message}
        </div>,
        document.body
      )
    : null;
}

export function Field({
  label,
  error,
  hint,
  className = "",
  id,
  ...props
}: InputHTMLAttributes<HTMLInputElement> & {
  label: string;
  error?: string;
  hint?: string;
}) {
  const generatedId = useId();
  const controlId = id ?? generatedId;
  const descriptionId = error || hint ? `${controlId}-description` : undefined;
  return (
    <label className={`block ${className}`} htmlFor={controlId}>
      <span className="yk-field-label">{label}</span>
      <input
        id={controlId}
        className="yk-field-control"
        aria-invalid={!!error}
        aria-describedby={descriptionId}
        {...props}
      />
      {(error || hint) && (
        <span
          id={descriptionId}
          className={`yk-field-help ${error ? "yk-field-error" : ""}`}
        >
          {error ?? hint}
        </span>
      )}
    </label>
  );
}

export type TabItem = {
  id: string;
  label: string;
  disabled?: boolean;
  badge?: ReactNode;
};
export function Tabs({
  items,
  value,
  onChange,
  label = "Onglets"
}: {
  items: TabItem[];
  value: string;
  onChange: (value: string) => void;
  label?: string;
}) {
  return (
    <div className="yk-tabs" role="tablist" aria-label={label}>
      {items.map(item => (
        <button
          key={item.id}
          type="button"
          role="tab"
          className="yk-tab"
          aria-selected={item.id === value}
          disabled={item.disabled}
          onClick={() => onChange(item.id)}
        >
          {item.label}
          {item.badge}
        </button>
      ))}
    </div>
  );
}

export function Skeleton({
  className = "",
  label = "Loading"
}: {
  className?: string;
  label?: string;
}) {
  return (
    <span
      role="status"
      aria-label={label}
      className={`yk-skeleton block ${className}`}
    />
  );
}

export function Feedback({
  tone,
  title,
  children
}: {
  tone: "success" | "error";
  title: string;
  children?: ReactNode;
}) {
  return (
    <div
      role={tone === "error" ? "alert" : "status"}
      className={`yk-feedback yk-feedback-${tone}`}
    >
      <span className="yk-feedback-icon" aria-hidden="true">
        {tone === "success" ? "✓" : "!"}
      </span>
      <span>
        <strong className="block text-sm text-ink">{title}</strong>
        {children && (
          <span className="mt-1 block text-xs text-ink-2">{children}</span>
        )}
      </span>
    </div>
  );
}
