import { useEffect, useMemo, useState } from "react";
import { HugeiconsIcon } from "@hugeicons/react";
import {
  Add01Icon,
  ArrowRight01Icon,
  Cancel01Icon,
  Copy01Icon,
  Delete02Icon,
  Folder01Icon,
  PencilIcon,
  Search01Icon,
  ServerStack01Icon,
  Settings01Icon,
  Tag01Icon,
  Tick02Icon,
  ArrowDown01Icon,
  ArrowUpRight01Icon,
  Link01Icon,
  Globe02Icon,
} from "@hugeicons/core-free-icons";
import { useHostProbes } from "../hooks/useHostProbes";
import { useHomePreferences } from "../hooks/useHomePreferences";
import { useManagementText } from "../hooks/useManagementText";
import {
  aggregateStatus,
  localDate,
  type ServerCatalog,
} from "../shared/serverManagement";
import type { Session, SSHConnection } from "../shared/types";
import { cn } from "../lib/utils";
import { normalizeProviderUrl } from "../shared/providerUrl";
import { tagColor } from "./home/tagColors";
import { Modal } from "./ui/modal";
import { Input } from "./ui/input";
import {
  ManagementFields,
  type CreateCategory,
  managementButton as button,
  managementInput as input,
} from "./home/ManagementFields";

type Data = { connections: SSHConnection[]; catalog: ServerCatalog };
interface Props extends Data {
  sessions: Session[];
  updateManagement: (change: (current: Data) => Data) => Promise<void>;
  onConnect: (connection: SSHConnection) => void;
  onNew: () => void;
  onEdit: (connection: SSHConnection) => void;
  onDelete: (connection: SSHConnection) => Promise<void>;
  onCreateCategory: CreateCategory;
}
const iconButton =
  "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-muted-foreground transition-colors hover:bg-accent hover:text-foreground disabled:opacity-40";

export function ServerHome({
  connections,
  catalog,
  sessions,
  updateManagement,
  onConnect,
  onNew,
  onEdit,
  onDelete,
  onCreateCategory,
}: Props) {
  const t = useManagementText();
  const [today, setToday] = useState(localDate());
  useEffect(() => {
    const refresh = () => setToday(localDate());
    const timer = setInterval(refresh, 60_000);
    window.addEventListener("focus", refresh);
    return () => {
      clearInterval(timer);
      window.removeEventListener("focus", refresh);
    };
  }, []);
  const {
    query,
    setQuery,
    group,
    setGroup,
    tags,
    setTags,
    limit,
    setLimit,
    listRef,
    onScroll,
  } = useHomePreferences(connections.length);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState("");
  const [managing, setManaging] = useState(false);
  const [kind, setKind] = useState<"groups" | "tags">("groups");
  const [editingId, setEditingId] = useState("");
  const [name, setName] = useState("");
  const [confirmation, setConfirmation] = useState<{
    text: string;
    action: () => Promise<void>;
  } | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase();
    return connections.filter((c) => {
      const category = catalog.groups.find((g) => g.id === c.groupId);
      const labels = catalog.tags.filter((tag) => c.tagIds?.includes(tag.id));
      return (
        (!group || (group === "ungrouped" ? !category : c.groupId === group)) &&
        (!tags.length || tags.some((id) => c.tagIds?.includes(id))) &&
        (!needle ||
          [
            c.name,
            c.host,
            c.username,
            c.providerUrl,
            c.domain,
            category?.name,
            ...labels.map((tag) => tag.name),
          ].some((value) => value?.toLocaleLowerCase().includes(needle)))
      );
    });
  }, [connections, catalog, query, group, tags]);
  const visible = useMemo(() => filtered.slice(0, limit), [filtered, limit]);
  const probes = useHostProbes(visible);
  const run = async (action: () => Promise<void>) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      await action();
    } catch {
      setError(t("error"));
    } finally {
      setBusy(false);
    }
  };
  const resetEditor = () => {
    setEditingId("");
    setName("");
  };
  const saveCategory = () => {
    const trimmed = name.trim();
    if (
      !trimmed ||
      catalog[kind].some(
        (c) =>
          c.id !== editingId &&
          c.name.toLocaleLowerCase() === trimmed.toLocaleLowerCase(),
      )
    ) {
      setError(t("nameRequired"));
      return;
    }
    void run(async () => {
      await updateManagement((current) => ({
        ...current,
        catalog: {
          ...current.catalog,
          [kind]: editingId
            ? current.catalog[kind].map((c) =>
                c.id === editingId ? { ...c, name: trimmed } : c,
              )
            : [
                ...current.catalog[kind],
                { id: crypto.randomUUID(), name: trimmed },
              ],
        },
      }));
      resetEditor();
    });
  };
  const removeCategory = (id: string) =>
    setConfirmation({
      text: t("deleteCategory"),
      action: async () => {
        await updateManagement((current) => ({
          catalog: {
            ...current.catalog,
            [kind]: current.catalog[kind].filter((c) => c.id !== id),
          },
          connections: current.connections.map((c) =>
            kind === "groups"
              ? c.groupId === id
                ? { ...c, groupId: undefined }
                : c
              : { ...c, tagIds: c.tagIds?.filter((tag) => tag !== id) },
          ),
        }));
        if (kind === "groups" && group === id) setGroup("");
        if (kind === "tags")
          setTags((current) => current.filter((tag) => tag !== id));
        resetEditor();
      },
    });

  return (
    <main className="relative z-10 flex h-full flex-col overflow-hidden">
      <div className="mx-auto flex h-full w-full max-w-[1440px] flex-col px-5 py-5 lg:px-7">
        <header className="mb-5 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <HugeiconsIcon
              icon={ServerStack01Icon}
              className="h-5 w-5 text-muted-foreground"
            />
            <h1 className="text-lg font-semibold tracking-tight">
              {t("title")}
            </h1>
            <span className="text-xs tabular-nums text-muted-foreground">
              {connections.length}
            </span>
          </div>
          <div className="flex items-center gap-2">
            <div className="relative">
              <HugeiconsIcon
                icon={Search01Icon}
                className="pointer-events-none absolute left-3 top-2.5 h-4 w-4 text-muted-foreground"
              />
              <Input
                aria-label={t("search")}
                placeholder={t("search")}
                value={query}
                onChange={(e) => {
                  setQuery(e.target.value);
                  setLimit(50);
                }}
                className="h-9 w-[180px] rounded-xl bg-background/50 pl-9 text-xs sm:w-[260px]"
              />
            </div>
            <button
              onClick={onNew}
              className="flex h-9 items-center gap-1.5 rounded-xl bg-foreground px-3 text-xs font-medium text-background hover:bg-foreground/90"
            >
              <HugeiconsIcon icon={Add01Icon} className="h-4 w-4" />
              <span>{t("new")}</span>
            </button>
          </div>
        </header>
        <div className="mb-4 space-y-2">
          <div className="flex items-start gap-3">
            <HugeiconsIcon
              icon={Folder01Icon}
              className="mt-2 h-4 w-4 shrink-0 text-muted-foreground"
            />
            <div className="flex min-w-0 flex-1 flex-wrap gap-1">
              {[
                { id: "", name: t("all") },
                ...catalog.groups,
                { id: "ungrouped", name: t("ungrouped") },
              ].map((g) => (
                <button
                  key={g.id}
                  aria-pressed={group === g.id}
                  onClick={() => {
                    setGroup(g.id);
                    setLimit(50);
                  }}
                  className={cn(
                    "rounded-lg px-3 py-1.5 text-xs transition-colors",
                    group === g.id
                      ? "bg-foreground text-background"
                      : "text-muted-foreground hover:bg-accent hover:text-foreground",
                    g.id && g.id !== "ungrouped" && tagColor(g.id),
                    g.id &&
                      g.id !== "ungrouped" &&
                      group === g.id &&
                      "ring-1 ring-current font-medium",
                  )}
                >
                  {g.name}
                </button>
              ))}
            </div>
            <button
              className={iconButton}
              title={t("manage")}
              aria-label={t("manage")}
              onClick={() => {
                setError("");
                setManaging(true);
              }}
            >
              <HugeiconsIcon icon={Settings01Icon} className="h-4 w-4" />
            </button>
          </div>
          {catalog.tags.length > 0 && (
            <div className="flex items-start gap-3">
              <HugeiconsIcon
                icon={Tag01Icon}
                className="mt-1.5 h-4 w-4 shrink-0 text-muted-foreground"
              />
              <div className="flex flex-wrap gap-1.5">
                {catalog.tags.map((tag) => (
                  <button
                    key={tag.id}
                    aria-pressed={tags.includes(tag.id)}
                    onClick={() => {
                      setTags((current) =>
                        current.includes(tag.id)
                          ? current.filter((id) => id !== tag.id)
                          : [...current, tag.id],
                      );
                      setLimit(50);
                    }}
                    className={cn(
                      "flex items-center gap-1 rounded-md px-2 py-1 text-[11px] transition-colors",
                      tagColor(tag.id),
                      tags.includes(tag.id)
                        ? "font-medium ring-1 ring-current"
                        : "hover:opacity-75",
                    )}
                  >
                    {tags.includes(tag.id) && (
                      <HugeiconsIcon icon={Tick02Icon} className="h-3 w-3" />
                    )}
                    {tag.name}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
        {error && !managing && !confirmation && (
          <p role="alert" className="mb-3 text-xs text-destructive">
            {error}
          </p>
        )}
        <div
          ref={listRef}
          onScroll={onScroll}
          className="min-h-0 flex-1 overflow-y-auto rounded-xl border border-border/60 bg-background/25"
        >
          <ul className="divide-y divide-border/45">
            {visible.map((c) => {
              const status = aggregateStatus(sessions, c.id) ?? "idle";
              const probe = probes[c.id];
              const providerLink = normalizeProviderUrl(c.providerUrl);
              return (
                <li
                  key={c.id}
                  className="group flex min-h-[84px] flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2 transition-colors hover:bg-accent/30 sm:px-4 xl:grid xl:grid-cols-[36px_minmax(100px,1fr)_200px_324px_40px_184px]"
                >
                  <span className="relative flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-foreground/[0.04]">
                    <HugeiconsIcon
                      icon={ServerStack01Icon}
                      className="h-[18px] w-[18px] text-muted-foreground"
                    />
                    <span
                      title={t(status)}
                      className={cn(
                        "absolute bottom-0 right-0 h-2 w-2 rounded-full ring-2 ring-background",
                        status === "connected"
                          ? "bg-primary"
                          : status === "connecting"
                            ? "bg-amber-500"
                            : "bg-muted-foreground/40",
                      )}
                    />
                  </span>
                  <button
                    className="min-w-0 flex-1 text-left"
                    onClick={() => onConnect(c)}
                  >
                    <div
                      className="truncate text-[13px] font-medium"
                      title={c.name}
                    >
                      {c.name}
                    </div>
                    <div className="mt-0.5 truncate font-mono text-[10px] text-muted-foreground">
                      {c.username}@{c.host}:{c.port}
                    </div>
                  </button>
                  <div
                    className={cn(
                      "order-last min-w-0 w-full pl-[48px] xl:order-none xl:w-full xl:pl-0",
                      !providerLink && !c.domain?.trim() && "hidden xl:block",
                    )}
                  >
                    {providerLink && (
                      <a
                        href={providerLink}
                        title={providerLink}
                        aria-label={`${t("provider")} · ${providerLink}`}
                        onClick={(event) => {
                          event.preventDefault();
                          void window.electron
                            .openExternal(providerLink)
                            .catch(() => setError(t("error")));
                        }}
                        className="flex w-56 max-w-full items-center gap-1.5 rounded-md px-1 py-1 text-xs text-muted-foreground transition-colors hover:bg-accent hover:text-foreground hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                      >
                        <HugeiconsIcon
                          icon={Link01Icon}
                          className="h-3.5 w-3.5 shrink-0"
                        />
                        <span className="min-w-0 flex-1 truncate">
                          {c.providerUrl?.trim()}
                        </span>
                        <HugeiconsIcon
                          icon={ArrowUpRight01Icon}
                          className="h-3.5 w-3.5 shrink-0"
                        />
                      </a>
                    )}
                    {c.domain?.trim() && (
                      <span
                        title={`${t("domain")} · ${c.domain.trim()}`}
                        className="flex w-56 max-w-full items-center gap-1.5 px-1 py-1 text-xs text-muted-foreground"
                      >
                        <HugeiconsIcon
                          icon={Globe02Icon}
                          className="h-3.5 w-3.5 shrink-0"
                        />
                        <span className="min-w-0 truncate">
                          {c.domain.trim()}
                        </span>
                      </span>
                    )}
                  </div>
                  <ManagementFields
                    className="order-last w-full pl-[48px] xl:order-none xl:grid xl:grid-cols-[76px_112px_128px] xl:gap-1 xl:pl-0 [&>button]:min-w-0 [&>button]:max-w-full [&>button]:justify-self-start [&>button]:overflow-hidden"
                    value={c}
                    catalog={catalog}
                    today={today}
                    onCreateCategory={onCreateCategory}
                    onChange={(patch) =>
                      updateManagement((current) => ({
                        ...current,
                        connections: current.connections.map((item) =>
                          item.id === c.id ? { ...item, ...patch } : item,
                        ),
                      }))
                    }
                  />
                  <span className="hidden text-right text-[10px] tabular-nums text-muted-foreground xl:block">
                    {status === "connected"
                      ? t("connected")
                      : probe?.ms !== null && probe?.ms !== undefined
                        ? `${probe.ms} ms`
                        : t(status)}
                  </span>
                  <div className="flex shrink-0 items-center gap-0.5">
                    <button
                      className={iconButton}
                      title={copied === c.id ? t("copied") : t("copy")}
                      aria-label={`${c.name} ${t("copy")}`}
                      onClick={() =>
                        void navigator.clipboard
                          .writeText(`${c.username}@${c.host}`)
                          .then(() => {
                            setCopied(c.id);
                            setTimeout(() => setCopied(""), 1500);
                          })
                          .catch(() => setError(t("error")))
                      }
                    >
                      <HugeiconsIcon
                        icon={copied === c.id ? Tick02Icon : Copy01Icon}
                        className="h-3.5 w-3.5"
                      />
                    </button>
                    <button
                      className={iconButton}
                      disabled={busy}
                      title={t("edit")}
                      aria-label={`${c.name} ${t("edit")}`}
                      onClick={() => onEdit(c)}
                    >
                      <HugeiconsIcon
                        icon={PencilIcon}
                        className="h-3.5 w-3.5"
                      />
                    </button>
                    <button
                      className={cn(iconButton, "hover:text-destructive")}
                      disabled={busy}
                      title={t("delete")}
                      aria-label={`${c.name} ${t("delete")}`}
                      onClick={() =>
                        setConfirmation({
                          text: `${c.name}: ${t("deleteServer")}`,
                          action: () => onDelete(c),
                        })
                      }
                    >
                      <HugeiconsIcon
                        icon={Delete02Icon}
                        className="h-3.5 w-3.5"
                      />
                    </button>
                    <button
                      className="ml-2 flex h-8 min-w-[72px] shrink-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg bg-foreground/[0.06] px-3 text-xs font-medium hover:bg-foreground/[0.1]"
                      onClick={() => onConnect(c)}
                    >
                      {t(
                        sessions.some((s) => s.connection.id === c.id)
                          ? "open"
                          : "connect",
                      )}
                      <HugeiconsIcon
                        icon={ArrowRight01Icon}
                        className="h-3.5 w-3.5"
                      />
                    </button>
                  </div>
                </li>
              );
            })}
          </ul>
          {!visible.length && (
            <div className="flex min-h-48 flex-col items-center justify-center gap-3 text-muted-foreground">
              <HugeiconsIcon
                icon={ServerStack01Icon}
                className="h-8 w-8 opacity-50"
              />
              <p className="text-xs">{t("none")}</p>
              {(query || group || tags.length > 0) && (
                <button
                  className="flex items-center gap-1 text-xs hover:text-foreground"
                  onClick={() => {
                    setQuery("");
                    setGroup("");
                    setTags([]);
                  }}
                >
                  <HugeiconsIcon icon={Cancel01Icon} className="h-3.5 w-3.5" />
                  {t("clear")}
                </button>
              )}
            </div>
          )}
          {filtered.length > visible.length && (
            <button
              className="flex w-full items-center justify-center gap-2 border-t border-border/50 py-3 text-xs text-muted-foreground hover:bg-accent"
              onClick={() => setLimit((n) => n + 50)}
            >
              {t("more")}
              <HugeiconsIcon icon={ArrowDown01Icon} className="h-4 w-4" />
            </button>
          )}
        </div>
      </div>
      <Modal
        isOpen={managing && !confirmation}
        onClose={() => !busy && setManaging(false)}
        title={t("manage")}
      >
        <div className="space-y-4">
          <div className="flex gap-1 rounded-xl bg-accent/40 p-1">
            {(["groups", "tags"] as const).map((key) => (
              <button
                key={key}
                className={cn(
                  "flex flex-1 items-center justify-center gap-2 rounded-lg py-2 text-xs",
                  kind === key
                    ? "bg-background font-medium"
                    : "text-muted-foreground",
                )}
                onClick={() => {
                  setKind(key);
                  resetEditor();
                }}
              >
                <HugeiconsIcon
                  icon={key === "groups" ? Folder01Icon : Tag01Icon}
                  className="h-3.5 w-3.5"
                />
                {t(key)}
              </button>
            ))}
          </div>
          <div className="space-y-1">
            {catalog[kind].map((c) => (
              <div
                key={c.id}
                className="flex items-center gap-2 rounded-lg px-2 py-1 text-xs"
              >
                <HugeiconsIcon
                  icon={kind === "groups" ? Folder01Icon : Tag01Icon}
                  className="h-3.5 w-3.5 text-muted-foreground"
                />
                <span className="min-w-0 flex-1 truncate">{c.name}</span>
                <button
                  className={iconButton}
                  disabled={busy}
                  aria-label={`${c.name} ${t("rename")}`}
                  onClick={() => {
                    setEditingId(c.id);
                    setName(c.name);
                  }}
                >
                  <HugeiconsIcon icon={PencilIcon} className="h-3.5 w-3.5" />
                </button>
                <button
                  className={iconButton}
                  disabled={busy}
                  aria-label={`${c.name} ${t("delete")}`}
                  onClick={() => removeCategory(c.id)}
                >
                  <HugeiconsIcon icon={Delete02Icon} className="h-3.5 w-3.5" />
                </button>
              </div>
            ))}
          </div>
          <form
            className="flex items-center gap-2"
            onSubmit={(e) => {
              e.preventDefault();
              saveCategory();
            }}
          >
            <input
              className={input}
              aria-label={t(kind === "groups" ? "groupName" : "tagName")}
              placeholder={t(kind === "groups" ? "groupName" : "tagName")}
              value={name}
              onChange={(e) => setName(e.target.value)}
            />
            <button
              className={cn(button, "flex shrink-0 items-center gap-1")}
              disabled={busy}
            >
              <HugeiconsIcon
                icon={editingId ? Tick02Icon : Add01Icon}
                className="h-3.5 w-3.5"
              />
              {t(editingId ? "save" : "add")}
            </button>
            {editingId && (
              <button
                type="button"
                className={iconButton}
                title={t("cancel")}
                aria-label={t("cancel")}
                onClick={resetEditor}
              >
                <HugeiconsIcon icon={Cancel01Icon} className="h-4 w-4" />
              </button>
            )}
          </form>
          {error && (
            <p role="alert" className="text-xs text-destructive">
              {error}
            </p>
          )}
        </div>
      </Modal>
      <Modal
        isOpen={Boolean(confirmation)}
        onClose={() => !busy && setConfirmation(null)}
        title={t("delete")}
      >
        <p className="mb-4 text-sm">{confirmation?.text}</p>
        {error && (
          <p role="alert" className="mb-3 text-xs text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <button
            className={button}
            disabled={busy}
            onClick={() => setConfirmation(null)}
          >
            {t("cancel")}
          </button>
          <button
            className={cn(button, "flex items-center gap-1 text-destructive")}
            disabled={busy}
            onClick={() =>
              void run(async () => {
                await confirmation?.action();
                setConfirmation(null);
              })
            }
          >
            <HugeiconsIcon icon={Delete02Icon} className="h-3.5 w-3.5" />
            {t("delete")}
          </button>
        </div>
      </Modal>
    </main>
  );
}
