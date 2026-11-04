import { Search } from "lucide-react";
import type { ReactNode } from "react";

export function Sidebar({ title, action, search, onSearch, children, testId }: {
  title: string;
  action?: ReactNode;
  search?: string;
  onSearch?: (v: string) => void;
  children: ReactNode;
  testId?: string;
}) {
  return (
    <aside className="sidebar" data-testid={testId}>
      <div className="sidebar-head">
        <h2>{title}</h2>
        {action}
      </div>
      {onSearch && (
        <label className="sidebar-search">
          <Search size={14} />
          <input value={search ?? ""} onChange={(e) => onSearch(e.target.value)} placeholder="Search" aria-label={`Search ${title}`} />
        </label>
      )}
      <div className="sidebar-scroll">{children}</div>
    </aside>
  );
}

export function SidebarGroup({ label, action }: { label: string; action?: ReactNode }) {
  return <div className="sidebar-group">{label}{action}</div>;
}
