import { useRef, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  Calendar03Icon,
  Folder01Icon,
  Tag01Icon,
  Tick02Icon,
  Loading02Icon,
  Search01Icon,
  ArrowRight01Icon,
} from "@hugeicons/core-free-icons";
import type { SSHConnection } from "../../shared/types";
import {
  daysRemaining,
  nextDueDate,
  renewalValid,
  type Renewal,
  type ServerCatalog,
} from "../../shared/serverManagement";
import { useManagementText } from "../../hooks/useManagementText";
import { InlinePopover } from "../ui/inline-popover";
import { cn } from "../../lib/utils";
import { tagColor } from "./tagColors";

export const managementInput =
  "h-9 w-full rounded-xl border border-input/70 bg-background/60 px-2.5 text-xs text-foreground outline-none transition-colors focus:border-primary";
export const managementButton =
  "rounded-lg border border-border px-2.5 py-1.5 text-xs transition-all duration-150 hover:bg-accent active:scale-[0.97] disabled:opacity-40 disabled:cursor-not-allowed";
export type CreateCategory = (
  kind: "groups" | "tags",
  name: string,
) => Promise<string>;
interface Props {
  value: Partial<SSHConnection>;
  catalog: ServerCatalog;
  onChange: (patch: Partial<SSHConnection>) => void | Promise<void>;
  onCreateCategory: CreateCategory;
  today?: string;
  className?: string;
}

function CategoryPicker({
  kind,
  value,
  catalog,
  onChange,
  onCreateCategory,
  close,
}: Props & { kind: "groups" | "tags"; close: () => void }) {
  const t = useManagementText();
  const [query, setQuery] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const items = catalog[kind].filter((item) =>
    item.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()),
  );
  const run = async (action: () => Promise<void>) => {
    if (lock.current) return;
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch {
      setError(t("error"));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  const choose = async (id: string) => {
    await onChange(
      kind === "groups"
        ? { groupId: id || undefined }
        : {
            tagIds: value.tagIds?.includes(id)
              ? value.tagIds.filter((tag) => tag !== id)
              : [...(value.tagIds ?? []), id],
          },
    );
    close();
  };
  const create = () =>
    void run(async () => {
      const id = await onCreateCategory(kind, query.trim());
      // Creation always attaches the category, including when another operation already created it.
      await onChange(
        kind === "groups"
          ? { groupId: id }
          : { tagIds: [...new Set([...(value.tagIds ?? []), id])] },
      );
      setQuery("");
      close();
    });
  return (
    <div className="space-y-1">
      <div className="relative mb-2">
        <HugeiconsIcon
          icon={Search01Icon}
          className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground"
        />
        <input
          className={cn(managementInput, "pl-8")}
          placeholder={t(kind === "groups" ? "groupName" : "tagName")}
          aria-label={t(kind === "groups" ? "groupName" : "tagName")}
          value={query}
          disabled={busy}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              const match = items.find(
                (item) =>
                  item.name.toLocaleLowerCase() ===
                  query.trim().toLocaleLowerCase(),
              );
              if (match) void run(() => choose(match.id));
              else if (query.trim()) create();
            }
          }}
        />
      </div>
      <div className="max-h-48 overflow-y-auto">
        {[
          ...(kind === "groups" && !query.trim()
            ? [{ id: "", name: t("ungrouped") }]
            : []),
          ...items,
        ].map((item) => {
          const selected =
            kind === "groups"
              ? (value.groupId ?? "") === item.id
              : value.tagIds?.includes(item.id);
          return (
            <button
              type="button"
              key={item.id}
              disabled={busy}
              aria-pressed={Boolean(selected)}
              className={cn(
                "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-xs transition-all duration-150 hover:bg-accent active:scale-[0.98] disabled:opacity-50",
                selected && "bg-accent/60",
                item.id && tagColor(item.id),
              )}
              onClick={() => void run(() => choose(item.id))}
            >
              <HugeiconsIcon
                icon={kind === "groups" ? Folder01Icon : Tag01Icon}
                className="h-3.5 w-3.5 text-muted-foreground"
              />
              <span className="min-w-0 flex-1 truncate">{item.name}</span>
              <HugeiconsIcon
                icon={Tick02Icon}
                className={cn(
                  "h-3.5 w-3.5 transition-[opacity,transform] duration-150",
                  selected ? "scale-100 opacity-100" : "scale-75 opacity-0",
                )}
              />
            </button>
          );
        })}
      </div>
      {query.trim() &&
        !catalog[kind].some(
          (item) =>
            item.name.toLocaleLowerCase() === query.trim().toLocaleLowerCase(),
        ) && (
          <button
            type="button"
            disabled={busy}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-xs text-primary transition-colors hover:bg-primary/10"
            onClick={create}
          >
            <HugeiconsIcon icon={Add01Icon} className="h-3.5 w-3.5" />
            {t("add")} “{query.trim()}”
          </button>
        )}
      {busy && (
        <div role="status" className="flex justify-center py-1">
          <HugeiconsIcon
            icon={Loading02Icon}
            className="h-3.5 w-3.5 animate-spin"
          />
        </div>
      )}
      {error && (
        <p role="alert" className="px-2 py-1 text-xs text-destructive">
          {error}
        </p>
      )}
    </div>
  );
}

function RenewalEditor({
  value,
  onChange,
  close,
}: Pick<Props, "value" | "onChange"> & { close: () => void }) {
  const t = useManagementText();
  const [renewal, setRenewal] = useState<Renewal>(() => ({
    cycle: 0,
    currency: "CNY",
    ...value.renewal,
  }));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const lock = useRef(false);
  const [extending, setExtending] = useState(false);
  const save = async () => {
    if (lock.current) return;
    if (!renewalValid(renewal)) {
      setError(t("invalid"));
      return;
    }
    if (extending && (daysRemaining(renewal.dueDate) ?? -1) < 0) {
      setError(t("past"));
      return;
    }
    lock.current = true;
    setBusy(true);
    setError("");
    try {
      await onChange({ renewal });
      close();
    } catch {
      setError(t("error"));
    } finally {
      lock.current = false;
      setBusy(false);
    }
  };
  return (
    <div className="space-y-3 p-1">
      <label className="block space-y-1.5 text-xs">
        {t("date")}
        <input
          className={managementInput}
          type="date"
          min="1900-01-01"
          max="9999-12-31"
          value={renewal.dueDate ?? ""}
          disabled={busy}
          onChange={(e) =>
            setRenewal({ ...renewal, dueDate: e.target.value || undefined })
          }
        />
      </label>
      <fieldset disabled={busy}>
        <legend className="mb-1.5 text-xs">{t("cycle")}</legend>
        <div className="flex flex-wrap gap-1">
          {([0, 1, 3, 6, 12] as const).map((cycle, i) => (
            <button
              type="button"
              aria-pressed={renewal.cycle === cycle}
              key={cycle}
              className={cn(
                "rounded-lg px-2 py-1.5 text-[11px] transition-all duration-150 active:scale-95",
                renewal.cycle === cycle
                  ? "bg-foreground text-background"
                  : "bg-accent/40 text-muted-foreground hover:bg-accent",
              )}
              onClick={() => setRenewal({ ...renewal, cycle })}
            >
              {t(
                (["manual", "monthly", "quarterly", "half", "yearly"] as const)[
                  i
                ],
              )}
            </button>
          ))}
        </div>
      </fieldset>
      <div className="grid grid-cols-[1fr_80px] gap-2">
        <label className="space-y-1.5 text-xs">
          {t("amount")}
          <input
            type="number"
            min="0"
            step="any"
            className={managementInput}
            value={renewal.amount ?? ""}
            disabled={busy}
            onChange={(e) =>
              setRenewal({
                ...renewal,
                amount:
                  e.target.value === "" ? undefined : Number(e.target.value),
              })
            }
          />
        </label>
        <label className="space-y-1.5 text-xs">
          {t("currency")}
          <input
            className={managementInput}
            maxLength={3}
            value={renewal.currency}
            disabled={busy}
            onChange={(e) =>
              setRenewal({ ...renewal, currency: e.target.value.toUpperCase() })
            }
          />
        </label>
      </div>
      {value.renewal?.dueDate && renewal.cycle > 0 && (
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            setExtending(true);
            setRenewal({
              ...renewal,
              dueDate: nextDueDate(value.renewal?.dueDate, renewal.cycle),
            });
          }}
          className="flex w-full items-center justify-between rounded-lg bg-accent/50 px-2.5 py-2 text-xs transition-colors hover:bg-accent"
        >
          {t("renew")}
          <span className="flex items-center gap-1 text-muted-foreground">
            {nextDueDate(value.renewal.dueDate, renewal.cycle)}
            <HugeiconsIcon icon={ArrowRight01Icon} className="h-3.5 w-3.5" />
          </span>
        </button>
      )}
      {error && (
        <p role="alert" className="text-xs text-destructive">
          {error}
        </p>
      )}
      <div className="flex justify-end gap-2">
        <button
          type="button"
          className={managementButton}
          onClick={close}
          disabled={busy}
        >
          {t("cancel")}
        </button>
        <button
          type="button"
          className={cn(
            managementButton,
            "flex items-center gap-1.5 bg-foreground text-background hover:bg-foreground/90",
          )}
          disabled={busy}
          onClick={() => void save()}
        >
          <HugeiconsIcon
            icon={busy ? Loading02Icon : Tick02Icon}
            className={cn("h-3.5 w-3.5", busy && "animate-spin")}
          />
          {t("save")}
        </button>
      </div>
    </div>
  );
}

export function ManagementFields(props: Props) {
  const { value, catalog, today } = props;
  const t = useManagementText();
  const group = catalog.groups.find((g) => g.id === value.groupId);
  const tags = catalog.tags.filter((tag) => value.tagIds?.includes(tag.id));
  const days = daysRemaining(value.renewal?.dueDate, today);
  const status =
    days === null
      ? t("date")
      : days < 0
        ? t("late", { n: -days })
        : days === 0
          ? t("today")
          : t("remaining", { n: days });
  const color =
    days === null || days > 30
      ? ""
      : days <= 0
        ? "text-rose-600 dark:text-rose-300 bg-rose-500/10"
        : days <= 7
          ? "text-orange-600 dark:text-orange-300 bg-orange-500/10"
          : "text-amber-700 dark:text-amber-300 bg-amber-500/10";
  return (
    <div className={cn("flex flex-wrap items-center gap-1", props.className)}>
      <InlinePopover
        label={`${t("groups")}${value.name ? ` · ${value.name}` : ""}`}
        className={group ? tagColor(group.id) : undefined}
        trigger={
          <>
            <HugeiconsIcon
              icon={Folder01Icon}
              className="h-3.5 w-3.5 shrink-0"
            />
            <span className="max-w-24 truncate">
              {group?.name ?? t("ungrouped")}
            </span>
          </>
        }
      >
        {(close) => <CategoryPicker {...props} kind="groups" close={close} />}
      </InlinePopover>
      <InlinePopover
        label={`${t("tags")}${value.name ? ` · ${value.name}` : ""}`}
        trigger={
          <>
            <HugeiconsIcon icon={Tag01Icon} className="h-3.5 w-3.5 shrink-0" />
            {tags.length ? (
              <span
                className="flex min-w-0 items-center gap-1"
                title={tags.map((tag) => tag.name).join(" · ")}
              >
                {tags.slice(0, 2).map((tag) => (
                  <span
                    key={tag.id}
                    className={cn(
                      "max-w-24 truncate rounded-md px-1.5 py-0.5",
                      tagColor(tag.id),
                    )}
                  >
                    {tag.name}
                  </span>
                ))}
                {tags.length > 2 && (
                  <span className="text-[10px]">+{tags.length - 2}</span>
                )}
              </span>
            ) : (
              <span>{t("addTag")}</span>
            )}
          </>
        }
      >
        {(close) => <CategoryPicker {...props} kind="tags" close={close} />}
      </InlinePopover>
      <InlinePopover
        label={`${t("date")}${value.name ? ` · ${value.name}` : ""}`}
        className={color}
        trigger={
          <>
            <HugeiconsIcon
              icon={Calendar03Icon}
              className="h-3.5 w-3.5 shrink-0"
            />
            <span className="min-w-0 text-left tabular-nums">
              <span className="block">{status}</span>
              {value.renewal?.dueDate && (
                <span className="block text-[10px] opacity-70">
                  {value.renewal.dueDate}
                </span>
              )}
              {value.renewal?.amount != null && (
                <span
                  className="block truncate text-[10px] font-medium"
                  title={`${value.renewal.currency} ${value.renewal.amount}`}
                >
                  {value.renewal.currency} {value.renewal.amount}
                  {value.renewal.cycle > 0 &&
                    ` / ${t(value.renewal.cycle === 1 ? "monthly" : value.renewal.cycle === 3 ? "quarterly" : value.renewal.cycle === 6 ? "half" : "yearly")}`}
                </span>
              )}
            </span>
          </>
        }
      >
        {(close) => (
          <RenewalEditor
            value={value}
            onChange={props.onChange}
            close={close}
          />
        )}
      </InlinePopover>
    </div>
  );
}
