import React from 'react';

const iconProps = {
  className: "w-5 h-5",
  strokeWidth: 2,
  fill: "none",
  stroke: "currentColor",
  viewBox: "0 0 24 24"
};

const smallIconProps = {
    ...iconProps,
    className: "w-4 h-4"
}

export const DashboardIcon = () => (
    <svg {...smallIconProps} strokeWidth="2.5">
        <rect x="3" y="3" width="7" height="7"></rect>
        <rect x="14" y="3" width="7" height="7"></rect>
        <rect x="14" y="14" width="7" height="7"></rect>
        <rect x="3" y="14" width="7" height="7"></rect>
    </svg>
);


export const NewProjectIcon = () => (
  <svg {...iconProps}>
    <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
    <polyline points="14 2 14 8 20 8"></polyline>
    <line x1="12" y1="18" x2="12" y2="12"></line>
    <line x1="9" y1="15" x2="15" y2="15"></line>
  </svg>
);

export const UndoIcon = () => (
    <svg {...iconProps}>
        <path d="M21 13.5A8.5 8.5 0 1 1 12.5 5H18"></path>
        <polyline points="15 2 18 5 15 8"></polyline>
    </svg>
);
  
export const RedoIcon = () => (
    <svg {...iconProps}>
        <path d="M3 13.5A8.5 8.5 0 1 0 11.5 5H6"></path>
        <polyline points="9 2 6 5 9 8"></polyline>
    </svg>
);

export const CriticalPathIcon = () => (
  <svg {...iconProps}>
    <path d="M21.5 12H18l-2.5 5-2.5-10-2.5 5H3"></path>
  </svg>
);

export const DayViewIcon = () => <span>D</span>;
export const WeekViewIcon = () => <span>W</span>;
export const MonthViewIcon = () => <span>M</span>;
export const YearViewIcon = () => <span>Y</span>;

export const ExportIcon = () => (
  <svg {...iconProps}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
    <polyline points="17 8 12 3 7 8"></polyline>
    <line x1="12" y1="3" x2="12" y2="15"></line>
  </svg>
);

export const SaveIcon = () => (
  <svg {...iconProps} className="w-4 h-4">
    <path d="M19 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h11l5 5v11a2 2 0 0 1-2 2z"></path>
    <polyline points="17 21 17 13 7 13 7 21"></polyline>
    <polyline points="7 3 7 8 15 8"></polyline>
  </svg>
);

export const ImportIcon = () => (
  <svg {...iconProps}>
    <path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"></path>
    <polyline points="7 10 12 15 17 10"></polyline>
    <line x1="12" y1="15" x2="12" y2="3"></line>
  </svg>
);

export const CalendarIcon = () => (
    <svg {...iconProps}>
        <rect x="3" y="4" width="18" height="18" rx="2" ry="2"></rect>
        <line x1="16" y1="2" x2="16" y2="6"></line>
        <line x1="8" y1="2" x2="8" y2="6"></line>
        <line x1="3" y1="10" x2="21" y2="10"></line>
    </svg>
);

export const ResourceIcon = () => (
    <svg {...iconProps}>
        <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"></path>
        <circle cx="9" cy="7" r="4"></circle>
        <path d="M23 21v-2a4 4 0 0 0-3-3.87"></path>
        <path d="M16 3.13a4 4 0 0 1 0 7.75"></path>
    </svg>
);

export const ReportIcon = () => (
    <svg {...iconProps}>
        <line x1="18" y1="20" x2="18" y2="10"></line>
        <line x1="12" y1="20" x2="12" y2="4"></line>
        <line x1="6" y1="20" x2="6" y2="14"></line>
    </svg>
);

export const ColumnsIcon = () => (
    <svg {...smallIconProps}>
       <path d="M12 3h7a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2h-7m0-18H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h7m0-18v18"></path>
    </svg>
);

export const BaselineIcon = () => (
    <svg {...iconProps}>
        <path d="M4 15s1-1 4-1 5 2 8 2 4-1 4-1V3s-1 1-4 1-5-2-8-2-4 1-4 1z"></path>
        <line x1="4" y1="22" x2="4" y2="15"></line>
    </svg>
);

export const ThemeIcon = () => (
    <svg {...iconProps}>
        <path d="M12 2.69l5.66 5.66a8 8 0 1 1-11.31 0z"></path>
    </svg>
);

export const ProgressIcon = () => (
  <svg {...iconProps}>
    <line x1="19" y1="5" x2="5" y2="19"></line>
    <circle cx="6.5" cy="6.5" r="2.5"></circle>
    <circle cx="17.5" cy="17.5" r="2.5"></circle>
  </svg>
);

export const TemplateIcon = () => (
    <svg {...iconProps}>
        <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path>
        <polyline points="14 2 14 8 20 8"></polyline>
        <path d="M12 18l-2-2 2-2 2 2-2 2z"></path>
        <path d="M12 12l2-2-2-2-2 2 2 2z"></path>
    </svg>
);


export const EditIcon = () => (
  <svg {...smallIconProps}>
    <path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path>
    <path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path>
  </svg>
);

export const DeleteIcon = () => (
  <svg {...smallIconProps}>
    <polyline points="3 6 5 6 21 6"></polyline>
    <path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path>
    <line x1="10" y1="11" x2="10" y2="17"></line>
    <line x1="14" y1="11" x2="14" y2="17"></line>
  </svg>
);

export const AddIcon = () => (
  <svg {...iconProps} className="w-4 h-4">
      <line x1="12" y1="5" x2="12" y2="19"></line>
      <line x1="5" y1="12" x2="19" y2="12"></line>
  </svg>
);

export const IndentIcon = () => (
    <svg {...smallIconProps}>
        <line x1="21" y1="6" x2="3" y2="6"></line>
        <line x1="21" y1="12" x2="3" y2="12"></line>
        <line x1="21" y1="18" x2="3" y2="18"></line>
        <polyline points="15 9 18 12 15 15"></polyline>
    </svg>
);

export const OutdentIcon = () => (
    <svg {...smallIconProps}>
        <line x1="21" y1="6" x2="3" y2="6"></line>
        <line x1="21" y1="12" x2="3" y2="12"></line>
        <line x1="21" y1="18" x2="3" y2="18"></line>
        <polyline points="9 9 6 12 9 15"></polyline>
    </svg>
);

export const ChevronLeftIcon = () => (
    <svg {...smallIconProps} strokeWidth="3">
        <polyline points="15 18 9 12 15 6"></polyline>
    </svg>
);

export const ChevronRightIcon = () => (
    <svg {...smallIconProps} strokeWidth="3">
        <polyline points="9 18 15 12 9 6"></polyline>
    </svg>
);

export const ChevronDownIcon = () => (
    <svg {...smallIconProps} strokeWidth="3">
        <polyline points="6 9 12 15 18 9"></polyline>
    </svg>
);

export const MilestoneIcon = () => (
    <svg {...smallIconProps} fill="currentColor" stroke="currentColor" strokeWidth="1" viewBox="0 0 24 24">
        <path d="M12 2L2 12l10 10 10-12L12 2z"></path>
    </svg>
);

export const WarningIcon = ({ className }: { className?: string }) => (
    <svg {...smallIconProps} viewBox="0 0 24 24" fill="currentColor" className={className || "w-4 h-4 text-amber-400"}>
      <path d="M1 21h22L12 2 1 21zm12-3h-2v-2h2v2zm0-4h-2v-4h2v4z"></path>
    </svg>
  );

export const ThermometerIcon = () => (
    <svg {...iconProps}>
        <path d="M14 14.76V3.5a2.5 2.5 0 0 0-5 0v11.26a4.5 4.5 0 1 0 5 0z" />
    </svg>
);

export const GaugeIcon = () => (
    <svg {...iconProps}>
        <path d="M12 12 L12 2" />
        <path d="M20 12 A8 8 0 0 0 4 12" />
        <path d="M18 12 A6 6 0 0 0 6 12" stroke="none" fill="currentColor" />
    </svg>
);