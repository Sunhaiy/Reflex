import { useEffect, useLayoutEffect, useRef, useState } from "react";

const KEY = "reflex.home.preferences.v1";
interface Preferences {
  query: string;
  group: string;
  tags: string[];
  limit: number;
  scrollTop: number;
}
const defaults: Preferences = {
  query: "",
  group: "",
  tags: [],
  limit: 50,
  scrollTop: 0,
};

function read(): Preferences {
  try {
    const value = JSON.parse(localStorage.getItem(KEY) ?? "null");
    if (!value || typeof value !== "object") return defaults;
    return {
      query: typeof value.query === "string" ? value.query : "",
      group: typeof value.group === "string" ? value.group : "",
      tags: Array.isArray(value.tags)
        ? value.tags.filter((tag: unknown) => typeof tag === "string")
        : [],
      limit:
        Number.isInteger(value.limit) && value.limit >= 50 ? value.limit : 50,
      scrollTop:
        Number.isFinite(value.scrollTop) && value.scrollTop >= 0
          ? value.scrollTop
          : 0,
    };
  } catch {
    return defaults;
  }
}

function write(value: Preferences) {
  try {
    localStorage.setItem(KEY, JSON.stringify(value));
  } catch (error) {
    console.error("Could not save homepage preferences", error);
  }
}

/** Synchronous local persistence also survives quitting before an IPC/debounce finishes. */
export function useHomePreferences(connectionCount: number) {
  const [initial] = useState(read);
  const [query, setQuery] = useState(initial.query);
  const [group, setGroup] = useState(initial.group);
  const [tags, setTags] = useState(initial.tags);
  const [limit, setLimit] = useState(initial.limit);
  const listRef = useRef<HTMLDivElement>(null);
  const scrollTop = useRef(initial.scrollTop);
  const restoredScroll = useRef(false);
  const current = useRef(initial);
  current.current = { query, group, tags, limit, scrollTop: scrollTop.current };

  useLayoutEffect(() => {
    if (!restoredScroll.current && connectionCount > 0 && listRef.current) {
      listRef.current.scrollTop = scrollTop.current;
      restoredScroll.current = true;
    }
  }, [connectionCount]);

  useEffect(() => {
    write(current.current);
  }, [query, group, tags, limit]);

  const onScroll = () => {
    if (!restoredScroll.current || !listRef.current) return;
    scrollTop.current = listRef.current.scrollTop;
    current.current.scrollTop = scrollTop.current;
    write(current.current);
  };

  return {
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
  };
}
