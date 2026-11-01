import { createContext, ReactNode, useContext } from "react";

interface SidebarToggleContextValue {
  expanded: boolean;
  toggle: () => void;
}

const SidebarToggleContext = createContext<SidebarToggleContextValue | null>(null);

export function SidebarToggleProvider({
  children,
  value,
}: {
  children: ReactNode;
  value: SidebarToggleContextValue;
}) {
  return (
    <SidebarToggleContext.Provider value={value}>
      {children}
    </SidebarToggleContext.Provider>
  );
}

interface PageHeaderProps {
  title: ReactNode;
  subtitle?: ReactNode;
  onBack?: () => void;
  actions?: ReactNode;
  className?: string;
}

export default function PageHeader({
  title,
  subtitle,
  onBack,
  actions,
  className = "",
}: PageHeaderProps) {
  const sidebar = useContext(SidebarToggleContext);

  return (
    <div className={`page-header ${className}`}>
      <div className="page-header-main">
        {sidebar && (
          <button
            type="button"
            className="page-header-toggle"
            onClick={sidebar.toggle}
            title={sidebar.expanded ? "Recolher menu" : "Expandir menu"}
            aria-label={sidebar.expanded ? "Recolher menu" : "Expandir menu"}
            aria-expanded={sidebar.expanded}
          >
            <span aria-hidden="true">{sidebar.expanded ? "«" : "»"}</span>
          </button>
        )}
        <div className="page-header-copy">
          <div className="page-header-title-line">
            {onBack && (
              <button
                type="button"
                onClick={onBack}
                className="page-header-back"
                aria-label="Voltar"
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" aria-hidden="true">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="m15 19-7-7 7-7" />
                </svg>
              </button>
            )}
            <h1>{title}</h1>
          </div>
          {subtitle && <p>{subtitle}</p>}
        </div>
      </div>
      {actions && <div className="page-header-actions">{actions}</div>}
    </div>
  );
}
