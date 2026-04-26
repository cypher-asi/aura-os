import { PanelSearch } from "../PanelSearch";
import { useActiveApp } from "../../hooks/use-active-app";
import { useSidebarSearch } from "../../hooks/use-sidebar-search";

export function SidebarSearchInput() {
  const { query, setQuery, action } = useSidebarSearch();
  const activeApp = useActiveApp();

  return (
    <PanelSearch
      placeholder={activeApp.searchPlaceholder ?? "Search"}
      value={query}
      onChange={setQuery}
      action={action}
    />
  );
}
