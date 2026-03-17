import React from 'react';
import {
    LayoutDashboard, Calendar, FileEdit, Crosshair,
    Users, Mail, Phone, Settings, Zap, ChevronLeft, ChevronRight
} from 'lucide-react';


export type TabId =
    | 'dashboard' | 'content-planner' | 'content-generator'
    | 'post-interceptor' | 'lead-crm' | 'outreach' | 'outreach-engine' | 'dialer' | 'settings';

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
            { id: 'content-planner' as TabId, label: 'Content Planner', icon: Calendar },
            { id: 'content-generator' as TabId, label: 'Post Generator', icon: FileEdit },
        ],
    },
    {
        label: 'Outbound Engine',
        items: [
            { id: 'post-interceptor' as TabId, label: 'Post Interceptor', icon: Crosshair, badge: 'New' },
            { id: 'lead-crm' as TabId, label: 'Lead CRM', icon: Users },
            { id: 'outreach' as TabId, label: 'Message Studio', icon: Mail },
            { id: 'outreach-engine' as TabId, label: 'Outreach Engine', icon: Zap },
            { id: 'dialer' as TabId, label: 'Power Dialer', icon: Phone },
        ],
    },
    {
        label: 'System',
        items: [
            { id: 'settings' as TabId, label: 'Settings', icon: Settings },
        ],
    },
];

const Sidebar: React.FC<SidebarProps> = ({ activeTab, onTabChange, collapsed, setCollapsed }) => {
    return (
        <aside
            className={[
                'fixed left-0 top-0 z-50 h-screen flex flex-col',
                'border-r border-white/[0.07]',
                'transition-all duration-300 ease-[cubic-bezier(0.4,0,0.2,1)]',
                collapsed ? 'w-[68px]' : 'w-[230px]',
            ].join(' ')}
            style={{ background: '#0e0e10' }}
        >
            {/* Logo area */}
            <div className={[
                'flex items-center gap-3 border-b border-white/[0.07] shrink-0',
                collapsed ? 'h-[60px] justify-center px-3' : 'h-[60px] px-4',
            ].join(' ')}>
                <div className="w-8 h-8 rounded-lg flex items-center justify-center shrink-0 relative"
                    style={{
                        background: 'linear-gradient(135deg, #3b82f6, #6366f1)',
                        boxShadow: '0 0 16px rgba(99,102,241,0.4)',
                    }}>
                    <Zap size={15} className="text-white" />
                </div>
                {!collapsed && (
                    <div className="overflow-hidden">
                        <p className="text-[14px] font-bold text-white tracking-tight whitespace-nowrap leading-none">
                            Command Center
                        </p>
                        <p className="text-[10px] text-slate-500 mt-0.5 whitespace-nowrap">Content & Outbound</p>
                    </div>
                )}
            </div>

            {/* Nav groups */}
            <nav className="flex-1 overflow-y-auto py-4 px-2 flex flex-col gap-5 min-h-0">
                {groups.map((group, gi) => (
                    <div key={gi} className="flex flex-col gap-0.5">
                        {!collapsed && (
                            <span className="text-[9.5px] font-bold text-slate-600 tracking-[0.08em] px-2 pb-1.5 uppercase">
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
                                        'relative flex items-center gap-2.5 w-full rounded-lg text-left',
                                        'transition-all duration-150 cursor-pointer focus-ring',
                                        'group',
                                        collapsed ? 'justify-center px-0 py-2.5' : 'px-2.5 py-2',
                                        isActive
                                            ? 'text-white'
                                            : 'text-slate-400 hover:text-slate-200',
                                    ].join(' ')}
                                    style={isActive ? {
                                        background: 'rgba(59,130,246,0.12)',
                                    } : {}}
                                >
                                    {/* Active left accent */}
                                    {isActive && (
                                        <span
                                            className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 rounded-r-full"
                                            style={{ background: 'linear-gradient(180deg,#3b82f6,#6366f1)' }}
                                        />
                                    )}

                                    <item.icon
                                        size={16}
                                        strokeWidth={isActive ? 2.5 : 1.8}
                                        className={[
                                            'shrink-0 transition-colors',
                                            isActive ? 'text-blue-400' : 'text-slate-500 group-hover:text-slate-300',
                                        ].join(' ')}
                                    />

                                    {!collapsed && (
                                        <>
                                            <span className="text-[13px] font-medium flex-1 whitespace-nowrap">
                                                {item.label}
                                            </span>
                                            {'badge' in item && item.badge && (
                                                <span className="text-[9px] font-bold bg-blue-500/20 text-blue-400 px-1.5 py-0.5 rounded-md uppercase tracking-wide border border-blue-500/20">
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

            {/* Collapse Toggle */}
            <div className="shrink-0 px-2 py-3 border-t border-white/[0.06]">
                <button
                    onClick={() => setCollapsed(!collapsed)}
                    className={[
                        'flex items-center gap-2 w-full rounded-lg px-2.5 py-2',
                        'text-slate-600 hover:text-slate-400',
                        'hover:bg-white/[0.04]',
                        'transition-all duration-150 cursor-pointer',
                        collapsed ? 'justify-center' : '',
                    ].join(' ')}
                >
                    {collapsed ? <ChevronRight size={15} /> : <ChevronLeft size={15} />}
                    {!collapsed && <span className="text-[12px] font-medium">Collapse</span>}
                </button>
            </div>
        </aside>
    );
};

export default Sidebar;
