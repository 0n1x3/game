'use client';

import React, { useState, useEffect } from 'react';
import { Icon } from '@iconify/react';
import { useTranslation } from '@/providers/i18n';
import { useModal } from '@/providers/modal';
import type { Language } from '@/types/i18n';
import { UserData } from '@/types/user';
import './style.css';
import { AvatarSelector } from '../AvatarSelector';
import { API_BASE_URL } from '@/config';

export function Settings() {
  const { setShowSettings } = useModal();
  const { t, language, setLanguage } = useTranslation();
  const [userData, setUserData] = useState<UserData | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    const initUser = async () => {
      try {
        const webApp = window.Telegram?.WebApp;
        if (!webApp) return;

        const initData = (webApp as any).initData;
        
        const response = await fetch(`${API_BASE_URL}/users/init`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            initData
          }),
        });
        
        if (response.ok) {
          const data = await response.json();
          setUserData(data);
        }
      } catch (error) {
        console.error('Error initializing user:', error);
      } finally {
        setIsLoading(false);
      }
    };

    initUser();
  }, []);

  useEffect(() => {
    document.body.classList.add('settings-open');
    return () => {
      document.body.classList.remove('settings-open');
    };
  }, []);

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      setShowSettings(false);
    }
  };

  const handleLanguageChange = (lang: Language) => {
    setLanguage(lang);
    localStorage.setItem('language', lang);
  };

  const handleAvatarSelect = async (avatarUrl: string) => {
    try {
      console.log('Updating avatar for user:', {
        telegramId: userData?.telegramId,
        avatarUrl
      });

      const response = await fetch(`${API_BASE_URL}/users/update-avatar`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          telegramId: userData?.telegramId,
          avatarUrl
        }),
      });

      console.log('Response status:', response.status);
      
      if (!response.ok) {
        const errorText = await response.text();
        console.error('Error details:', {
          status: response.status,
          statusText: response.statusText,
          body: errorText
        });
        return;
      }

      const updatedUser = await response.json();
      console.log('Updated user data:', updatedUser);
      setUserData(updatedUser);
    } catch (error) {
      console.error('Error updating avatar:', error);
    }
  };

  return (
    <div className="settings-modal" onClick={handleBackdropClick}>
      <div className="settings-popup">
        {isLoading ? (
          <div className="settings-loading">
            <Icon icon="solar:spinner-line-duotone" className="spinner" />
          </div>
        ) : (
          <>
            <div className="settings-profile">
              <AvatarSelector 
                currentAvatar={userData?.avatarUrl || '/avatars/nft1.png'} 
                onSelect={handleAvatarSelect}
              />
              <div className="profile-info">
                <div className="profile-name">
                  {userData?.username}
                </div>
                <div className="profile-id">
                  ID: {userData?.telegramId}
                </div>
              </div>
              <button className="close-button" onClick={() => setShowSettings(false)}>
                <Icon icon="solar:close-circle-linear" />
              </button>
            </div>

            <div className="settings-divider" />

            <div className="settings-content">
              <div className="settings-group">
                <div className="settings-item">
                  <span>{t('settings.music')}</span>
                  <label className="switch">
                    <input type="checkbox" />
                    <span className="slider" />
                  </label>
                </div>
                <div className="settings-item">
                  <span>{t('settings.sounds')}</span>
                  <label className="switch">
                    <input type="checkbox" />
                    <span className="slider" />
                  </label>
                </div>
                <div className="settings-item">
                  <span>{t('settings.vibration')}</span>
                  <label className="switch">
                    <input type="checkbox" />
                    <span className="slider" />
                  </label>
                </div>
              </div>

              <div className="settings-group">
                <div className="settings-item">
                  <span>{t('settings.language')}</span>
                  <div className="language-buttons">
                    <button 
                      className={`lang-button ${language === 'ru' ? 'active' : ''}`}
                      onClick={() => handleLanguageChange('ru')}
                    >
                      RU
                    </button>
                    <button 
                      className={`lang-button ${language === 'en' ? 'active' : ''}`}
                      onClick={() => handleLanguageChange('en')}
                    >
                      EN
                    </button>
                    <button 
                      className={`lang-button ${language === 'zh' ? 'active' : ''}`}
                      onClick={() => handleLanguageChange('zh')}
                    >
                      中文
                    </button>
                  </div>
                </div>
              </div>

              <button className="add-to-home">
                <Icon icon="solar:home-add-linear" />
                {t('settings.addToHome')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
} 
