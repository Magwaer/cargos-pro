export function Icon({ name, size = 18 }) {
  const common = { width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor', strokeWidth: 1.7, strokeLinecap: 'round', strokeLinejoin: 'round', 'aria-hidden': true }
  const paths = {
    home: <path d="M4 11.5 12 4l8 7.5V20a1 1 0 0 1-1 1h-5v-6H10v6H5a1 1 0 0 1-1-1z" />,
    chart: <><path d="M4 19h16" /><path d="M7 16v-5" /><path d="M12 16V7" /><path d="M17 16v-3" /></>,
    building: <><path d="M4 20h16" /><path d="M6 20V6h8v14" /><path d="M14 10h4v10" /><path d="M9 9h2M9 13h2" /></>,
    users: <><path d="M16 20v-1a3 3 0 0 0-3-3H7a3 3 0 0 0-3 3v1" /><circle cx="10" cy="8" r="3" /><path d="M20 20v-1a3 3 0 0 0-2.2-2.9" /><path d="M16 5.1a3 3 0 0 1 0 5.8" /></>,
    kanban: <><rect x="4" y="4" width="5" height="16" rx="1.5" /><rect x="10" y="4" width="5" height="10" rx="1.5" /><rect x="16" y="4" width="4" height="13" rx="1.5" /></>,
    check: <><rect x="4" y="4" width="16" height="16" rx="3" /><path d="m8 12 3 3 5-6" /></>,
    box: <><path d="M3 8 12 4l9 4-9 4z" /><path d="M3 8v8l9 4 9-4V8" /><path d="M12 12v8" /></>,
    columns: <><rect x="3" y="4" width="7" height="16" rx="1.5" /><rect x="14" y="4" width="7" height="16" rx="1.5" /></>,
    truck: <><path d="M3 7h11v8H3z" /><path d="M14 10h4l3 3v2h-7z" /><circle cx="7" cy="17" r="1.6" /><circle cx="17" cy="17" r="1.6" /></>,
    invoice: <><path d="M7 3h8l4 4v14H7z" /><path d="M15 3v4h4" /><path d="M9 12h6M9 16h4" /></>,
    expense: <><rect x="5" y="4" width="14" height="16" rx="2" /><path d="M9 9h6M9 13h4" /></>,
    file: <><path d="M7 3h7l5 5v13H7z" /><path d="M14 3v5h5" /></>,
    zap: <path d="M13 2 4 14h7l-1 8 9-12h-7z" />,
    settings: <><circle cx="12" cy="12" r="3" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></>,
    search: <><circle cx="11" cy="11" r="6" /><path d="m20 20-3.5-3.5" /></>,
    sun: <><circle cx="12" cy="12" r="3.5" /><path d="M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M18.4 5.6 17 7M7 17l-1.4 1.4" /></>,
    moon: <path d="M16 3a8 8 0 1 0 5 13 7 7 0 1 1-5-13z" />,
    chat: <path d="M5 6.5A2.5 2.5 0 0 1 7.5 4h9A2.5 2.5 0 0 1 19 6.5v7A2.5 2.5 0 0 1 16.5 16H9l-4 3.5V6.5z" />,
    bell: <><path d="M6 9a6 6 0 0 1 12 0c0 7 2 7 2 9H4c0-2 2-2 2-9" /><path d="M10 20a2 2 0 0 0 4 0" /></>,
    mail: <><rect x="3" y="6" width="18" height="12" rx="2" /><path d="m4 8 8 5 8-5" /></>,
    clock: <><circle cx="12" cy="12" r="8" /><path d="M12 8v5l3 2" /></>,
    branch: <><circle cx="6" cy="6" r="2" /><circle cx="6" cy="18" r="2" /><circle cx="18" cy="12" r="2" /><path d="M8 6h4a4 4 0 0 1 4 4v2M8 18h4a4 4 0 0 0 4-4" /></>,
    pencil: <path d="M13 5 19 11 8 22H4v-4zM11 7l6 6" />,
    webhook: <><circle cx="7" cy="8" r="2.4" /><circle cx="17" cy="8" r="2.4" /><circle cx="12" cy="17" r="2.4" /><path d="M9 9.2 10.6 14M15 9.2 13.4 14M9.2 8h5.6" /></>,
    grip: <><circle cx="9" cy="7" r="1.2" fill="currentColor" stroke="none" /><circle cx="15" cy="7" r="1.2" fill="currentColor" stroke="none" /><circle cx="9" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="15" cy="12" r="1.2" fill="currentColor" stroke="none" /><circle cx="9" cy="17" r="1.2" fill="currentColor" stroke="none" /><circle cx="15" cy="17" r="1.2" fill="currentColor" stroke="none" /></>,
    play: <path d="M8 6v12l10-6z" />,
  }
  return <svg {...common}>{paths[name] || paths.box}</svg>
}

export function Mark() {
  return (
    <svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true">
      <rect width="32" height="32" rx="10" fill="currentColor" />
      <circle cx="9" cy="11" r="2.1" fill="var(--surface)" />
      <circle cx="23" cy="21" r="2.1" fill="var(--surface)" />
      <path d="M11 12c4.2 0 5 8 10 8" stroke="var(--surface)" strokeWidth="1.7" fill="none" strokeLinecap="round" />
    </svg>
  )
}
