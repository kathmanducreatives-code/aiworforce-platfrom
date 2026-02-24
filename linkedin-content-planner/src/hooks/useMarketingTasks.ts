import { useState, useEffect } from 'react';
import { supabase } from '../lib/supabase';
import type { MarketingTask, CreateMarketingTaskInput } from '../types/marketing';
import { toast } from 'sonner';

export function useMarketingTasks() {
    const [tasks, setTasks] = useState<MarketingTask[]>([]);
    const [loading, setLoading] = useState(true);

    const fetchTasks = async () => {
        try {
            setLoading(true);
            const { data, error } = await supabase
                .from('marketing_tasks')
                .select('*')
                .order('created_at', { ascending: false });

            if (error) {
                // If table doesn't exist yet, we'll handle gracefully
                if (error.code === '42P01') {
                    console.warn("Table marketing_tasks does not exist yet.");
                    setTasks([]);
                    return;
                }
                throw error;
            }
            setTasks(data || []);
        } catch (err: any) {
            console.error('Error fetching marketing tasks:', err.message);
            toast.error('Failed to load marketing tasks');
        } finally {
            setLoading(false);
        }
    };

    const addTasks = async (newTasks: CreateMarketingTaskInput[]) => {
        try {
            const { data, error } = await supabase
                .from('marketing_tasks')
                .insert(newTasks)
                .select();

            if (error) throw error;
            setTasks(prev => [...(data || []), ...prev]);
            return data;
        } catch (err: any) {
            console.error('Error adding tasks:', err.message);
            toast.error('Failed to save marketing plan');
            throw err;
        }
    };

    const updateTaskStatus = async (taskId: string, status: 'pending' | 'completed') => {
        try {
            const { error } = await supabase
                .from('marketing_tasks')
                .update({ status })
                .eq('id', taskId);

            if (error) throw error;
            setTasks(prev => prev.map(t => t.id === taskId ? { ...t, status } : t));
        } catch (err: any) {
            console.error('Error updating task:', err.message);
            toast.error('Failed to update task status');
            throw err;
        }
    };

    useEffect(() => {
        fetchTasks();
    }, []);

    return {
        tasks,
        loading,
        addTasks,
        updateTaskStatus,
        refreshTasks: fetchTasks
    };
}
