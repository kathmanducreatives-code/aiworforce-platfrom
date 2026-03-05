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
        label: 'Main',
        items: [
            { id: 'dashboard' as TabId, label: 'Dashboard', icon: LayoutDashboard },
        ],
    },
    {
        label: 'Content',
        items: [
            { id: 'content-planner' as TabId,   label: 'Planner',   icon: Calendar },
            { id: 'content-generator' as TabId, label: 'Generator', icon: FileEdit },
        ],
    },
    {
        label: 'Growth & Outbound',
        items: [
            { id: 'post-interceptor' as TabId, label: 'Post Interceptor', icon: Crosshair, badge: 'New' },
            { id: 'lead-crm' as TabId,         label: 'Lead CRM',         icon: Users },
            { id: 'outreach' as TabId,          label: 'Outreach Engine',  icon: Mail },
            { id: 'dialer' as TabId,            label: 'Power Dialer',     icon: Phone },
        ],
    },
    {
        label: 'Config',
        items: [
            { id: 'settings' as TabId, label: 'Settings', icon: Settings },
        ],
    },
];

const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange, collapsed, setCollapsed }) => {
    return (
        <aside className={[
            'fixed left-0 top-0 z-50 h-screen flex flex-col',
            'bg-[#0a0a0b] border-r border-white/[0.06]',
            'transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
            collapsed ? 'w-[72px]' : 'w-[240px]',
        ].join(' ')}>

            {/* Logo */}
            <div className="flex items-center gap-3 px-5 h-[68px] border-b border-white/[0.04] shrink-0">
                <div className="w-8 h-8 rounded-lg bg-gradient-to-br from-blue-500 to-violet-600 flex items-center justify-center shadow-[0_0_14px_rgba(59,130,246,0.45)] shrink-0">
                    <Zap size={16} color="white" fill="white" />
                </div>
                {!collapsed && (
                    <span className="text-[15px] font-bold tracking-tight bg-gradient-to-r from-white to-slate-400 bg-clip-text text-transparent whitespace-nowrap overflow-hidden">
                        Command Center
                    </span>
                )}
            </div>

            {/* Nav groups */}
            <nav className="flex-1 overflow-y-auto py-4 px-2.5 flex flex-col gap-5">
                {groups.map((group, gi) => (
                    <div key={gi} className="flex flex-col gap-0.5">
                        {!collapsed && (
                            <span className="text-[10px] font-bold text-slate-600 uppercase tracking-[0.08em] px-3 pb-1.5">
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
                                        'relative flex items-center gap-3 w-full rounded-xl px-3 py-2.5',
                                        'transition-all duration-150 cursor-pointer text-left',
                                        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500/40',
                                        isActive
                                            ? 'bg-blue-500/10 text-blue-400'
                                            : 'text-slate-400 hover:text-slate-200 hover:bg-white/[0.04]',
                                        collapsed ? 'justify-center' : '',
                                    ].join(' ')}
                                >
                                    {/* Active indicator */}
                                    {isActive && (
                                        <span className="absolute left-0 w-[3px] h-5 bg-blue-500 rounded-r-full" />
                                    )}

                                    <item.icon
                                        size={18}
                                        strokeWidth={isActive ? 2.5 : 2}
                                        className={[
                                            'shrink-0 transition-all',
                                            isActive ? 'drop-shadow-[0_0_6px_rgba(59,130,246,0.6)]' : '',
                                        ].join(' ')}
                                    />

                                    {!collapsed && (
                                        <>
                                            <span className={`text-[13px] font-${isActive ? 'semibold' : 'medium'} flex-1 whitespace-nowrap`}>
                                                {item.label}
                                            </span>
                                            {'badge' in item && item.badge && (
                                                <span className="text-[10px] font-bold bg-violet-600 text-white px-1.5 py-0.5 rounded uppercase tracking-wide">
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
            <div className="shrink-0 px-2.5 py-3 border-t border-white/[0.04]">
                <button
                    onClick={() => setCollapsed(!collapsed)}
                    className={[
                        'flex items-center gap-3 w-full rounded-xl px-3 py-2.5',
                        'text-slate-600 hover:text-slate-300 hover:bg-white/[0.04]',
                        'transition-all duration-150 cursor-pointer',
                        collapsed ? 'justify-center' : '',
                    ].join(' ')}
                >
                    {collapsed ? <ChevronRight size={18} /> : <ChevronLeft size={18} />}
                    {!collapsed && <span className="text-[13px] font-medium">Collapse</span>}
                </button>
            </div>
        </aside>
    );
};

export default Sidebar;
