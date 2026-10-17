'use client';

import { createContext, useContext, ReactNode } from 'react';

interface SidebarContextType {
    sidebarCollapsed: boolean;
}

const SidebarContext = createContext<SidebarContextType | undefined>(undefined);

export function useSidebar() {
    const context = useContext(SidebarContext);
    if (context === undefined) {
        // Return default value if not in a sidebar context
        return { sidebarCollapsed: false };
    }
    return context;
}

interface SidebarProviderProps {
    children: ReactNode;
    collapsed: boolean;
}

export function SidebarProvider({ children, collapsed }: SidebarProviderProps) {
    return (
        <SidebarContext.Provider value={{ sidebarCollapsed: collapsed }}>
            {children}
        </SidebarContext.Provider>
    );
}
