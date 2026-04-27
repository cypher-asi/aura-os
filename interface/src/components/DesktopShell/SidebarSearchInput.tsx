import { useEffect, useState } from "react";
import { PanelSearch } from "../PanelSearch";
import { useActiveApp } from "../../hooks/use-active-app";
import { useSidebarSearch } from "../../hooks/use-sidebar-search";

export function SidebarSearchInput() {
  const { query, setQuery, action } = useSidebarSearch();
  const activeApp = useActiveApp();
  const [draftQuery, setDraftQuery] = useState(query);

  useEffect(() => {
    setDraftQuery(query);
  }, [query]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setQuery(draftQuery);
    }, 80);
    return () => window.clearTimeout(timeout);
  }, [draftQuery, setQuery]);

  return (
    <PanelSearch
      placeholder={activeApp.searchPlaceholder ?? "Search"}
      value={draftQuery}
      onChange={setDraftQuery}
      action={action}
    />
  );
}
