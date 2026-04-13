'use client';

import { useEffect, useState } from 'react';
import { Icon } from '@iconify/react';
import { useTranslation } from '@/providers/i18n';
import type { Task } from '../../../../types';
import { useUserStore } from '@/store/useUserStore';
import { API_BASE_URL } from '@/config';
import './style.css';

export function TasksList() {
  const { t } = useTranslation();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'active' | 'completed'>('active');

  useEffect(() => {
    const fetchTasks = async () => {
      try {
        const webApp = window.Telegram?.WebApp;
        if (!webApp) return;

        const initData = (webApp as any).initData;
        const endpoint = activeTab === 'active' ? 'active' : 'completed';
        const method = activeTab === 'active' ? 'POST' : 'GET';

        const url = method === 'GET' 
          ? `${API_BASE_URL}/tasks/${endpoint}?initData=${encodeURIComponent(initData)}`
          : `${API_BASE_URL}/tasks/${endpoint}`;

        const response = await fetch(url, {
          method,
          headers: {
            'Content-Type': 'application/json',
          },
          ...(method === 'POST' ? { body: JSON.stringify({ initData }) } : {})
        });

        if (response.ok) {
          const data = await response.json();
          console.log(`Fetched ${activeTab} tasks:`, data);
          setTasks(data);
        }
      } catch (error) {
        console.error('Error fetching tasks:', error);
      } finally {
        setLoading(false);
      }
    };

    fetchTasks();
  }, [activeTab]);

  const handleCollect = async (taskId: string) => {
    try {
      const webApp = window.Telegram?.WebApp;
      if (!webApp) return;

      const initData = (webApp as any).initData;
      const params = new URLSearchParams(initData);
      const userStr = params.get('user');
      
      if (!userStr) {
        throw new Error('No user data found');
      }

      const user = JSON.parse(decodeURIComponent(userStr));
      
      const response = await fetch(`${API_BASE_URL}/tasks/complete`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ 
          telegramId: user.id,
          taskId 
        })
      });

      if (response.ok) {
        const updatedUser = await response.json();
        
        // Обновляем баланс пользователя
        useUserStore.getState().setUserData({
          balance: updatedUser.balance,
          level: updatedUser.level,
          experience: updatedUser.experience
        });

        // Обновляем список задач
        const tasksResponse = await fetch(`${API_BASE_URL}/tasks/${activeTab}`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ initData })
        });

        if (tasksResponse.ok) {
          const tasks = await tasksResponse.json();
          setTasks(tasks);
        }
      }
    } catch (error) {
      console.error('Error collecting reward:', error);
    }
  };

  return (
    <div className="tasks-container">
      <div className="tasks-tabs">
        <button 
          className={`tab ${activeTab === 'active' ? 'active' : ''}`}
          onClick={() => setActiveTab('active')}
        >
          {t('pages.income.tasks.active')}
        </button>
        <button 
          className={`tab ${activeTab === 'completed' ? 'active' : ''}`}
          onClick={() => setActiveTab('completed')}
        >
          {t('pages.income.tasks.completed')}
        </button>
      </div>
      
      {loading ? (
        <div className="tasks-loading">{t('common.loading')}</div>
      ) : tasks.length === 0 ? (
        <div className="tasks-empty">
          {activeTab === 'active' 
            ? t('pages.income.tasks.noActive')
            : t('pages.income.tasks.noCompleted')}
        </div>
      ) : (
        <div className="tasks-list">
          {tasks.map(task => (
            <div key={task._id} className={`task-card ${!task.isActive ? 'completed' : ''}`}>
              <div className="task-info">
                <h3>{task.type === 'FIRST_GAME' ? t('pages.income.tasks.firstTask.title') : task.title}</h3>
              </div>
              <div className="task-reward">
                <Icon 
                  icon="material-symbols:diamond-rounded" 
                  className="reward-icon"
                />
                <span>{task.reward}</span>
                {activeTab === 'active' && (
                  <button 
                    className="collect-button"
                    onClick={() => handleCollect(task._id)}
                  >
                    {t('pages.income.tasks.collect')}
                  </button>
                )}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
} 
