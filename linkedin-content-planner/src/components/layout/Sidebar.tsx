import React from 'react';
import {
    LayoutDashboard, Calendar, FileEdit, Crosshair,
    Users, Mail, Phone, Settings, Zap, ChevronLeft, ChevronRight
} from 'lucide-react';

export type TabId =
    | 'dashboard' | 'content-planner' | 'content-generator'
    | 'post-interceptor' | 'lead-crm' | 'outreach' | 'dialer' | 'settings';

interface SidebarProps {
    activeTab: TabId;
    onTabChange: (tab: TabId) => void;
    collapsed: boolean;
    setCollapsed: (v: boolean) => void;
}

const groups = [
    {
        label: 'Overview',
        items: [
            { id: 'dashboard' as TabId, label: 'Dashboard', icon: LayoutDashboard },
        ],
    },
    {
        label: 'Content Lab',
        items: [
            { id: 'content-planner' as TabId, label: 'Planner', icon: Calendar },
            { id: 'content-generator' as TabId, label: 'Generator', icon: FileEdit },
        ],
    },
    {
        label: 'Outbound Engine',
        items: [
            { id: 'post-interceptor' as TabId, label: 'Post Interceptor', icon: Crosshair, badge: 'New' },
            { id: 'lead-crm' as TabId, label: 'Lead CRM', icon: Users },
            { id: 'outreach' as TabId, label: 'Message Studio', icon: Mail },
            { id: 'dialer' as TabId, label: 'Power Dialer', icon: Phone },
        ],
    },
    {
        label: 'Settings',
        items: [
            { id: 'settings' as TabId, label: 'Global Settings', icon: Settings },
        ],
    },
];

const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange, collapsed, setCollapsed }) => {
    return (
        <aside className={[
            'fixed left-0 top-0 z-50 h-screen flex flex-col',
            'bg-white border-r border-slate-200',
            'transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
            collapsed ? 'w-[72px]' : 'w-[240px]',
        ].join(' ')}>

            {/* Logo */}
            <div className="flex items-center gap-3 px-5 h-[68px] border-b border-slate-200 shrink-0">
                <div className="w-8 h-8 rounded-md bg-blue-600 flex items-center justify-center shrink-0 shadow-sm">
                    <Zap size={16} className="text-white" />
                </div>
                {!collapsed && (
                    <span className="text-[15px] font-bold text-slate-900 tracking-tight whitespace-nowrap overflow-hidden">
                        Command Center
                    </span>
                )}
            </div>

            {/* Nav groups */}
            <nav className="flex-1 overflow-y-auto py-5 px-3 flex flex-col gap-6">
                {groups.map((group, gi) => (
                    <div key={gi} className="flex flex-col gap-1">
                        {!collapsed && (
                            <span className="text-xs font-semibold text-slate-500 tracking-[0.05em] px-3 pb-2 uppercase">
                                {group.label}
                            </span>
                        )}
                        {group.items.map((item) => {
                            const isActive = activeTab === item.id;
                            return (
                                <button
                                    key={item.id}
                                    onClick={() => onTabChange(item.id)}
                                    title={collapsed ? item.label : undefined}
                                    className={[
                                        'relative flex items-center gap-3 w-full px-3 py-2',
                                        'transition-all duration-150 cursor-pointer text-left',
                                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40 rounded-md',
                                        isActive
                                            ? 'bg-blue-50 text-blue-700 font-medium'
                                            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-50',
                                        collapsed ? 'justify-center' : '',
                                    ].join(' ')}
                                >
                                    {/* Active indicator */}
                                    {isActive && (
                                        <span className="absolute left-0 top-0 bottom-0 w-1 bg-blue-600 rounded-r-md" />
                                    )}

                                    <item.icon
                                        size={18}
                                        strokeWidth={isActive ? 2.5 : 2}
                                        className="shrink-0 transition-colors"
                                    />

                                    {!collapsed && (
                                        <>
                                            <span className="text-sm flex-1 whitespace-nowrap">
                                                {item.label}
                                            </span>
                                            {'badge' in item && item.badge && (
                                                <span className="text-[10px] font-bold bg-blue-100 text-blue-700 px-1.5 py-0.5 rounded uppercase tracking-wide">
                                                    {item.badge}
                                                </span>
                                            )}
                                        </>
                                    )}
                                </button>
                            );
                        })}
                    </div>
                ))}
            </nav>

            {/* Collapse toggle */}
            <div className="shrink-0 px-3 py-3 border-t border-slate-200">
                <button
                    onClick={() => setCollapsed(!collapsed)}
                    className={[
                        'flex items-center gap-3 w-full rounded-md px-3 py-2.5',
                        'text-slate-500 hover:text-slate-700 hover:bg-slate-50',
                        'transition-all duration-150 cursor-pointer',
                        collapsed ? 'justify-center' : '',
                    ].join(' ')}
                >
                    {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
                    {!collapsed && <span className="text-sm font-medium">Collapse</span>}
                </button>
            </div>
        </aside>
    );
};

export default Sidebar;
