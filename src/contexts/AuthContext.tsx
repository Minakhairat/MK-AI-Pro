import React, { createContext, useContext, useEffect, useState } from 'react';
import {
  createUserWithEmailAndPassword,
  onAuthStateChanged,
  sendEmailVerification,
  sendPasswordResetEmail,
  signInWithEmailAndPassword,
  signInWithPopup,
  signOut as firebaseSignOut,
  updateProfile,
  type User,
} from 'firebase/auth';
import { auth, googleAuthProvider } from '../lib/firebase';
import {
  ensureUserProfileAndWorkspace,
  subscribeUserProfile,
} from '../services/firestoreService';
import type { UserProfile } from '../types/domain';
import { useI18n } from './I18nContext';
import { useTheme } from './ThemeContext';

interface AuthContextValue {
  user: User | null;
  profile: UserProfile | null;
  loading: boolean;
  authError: string | null;
  clearAuthError: () => void;
  signInWithGoogle: () => Promise<void>;
  signInWithEmail: (email: string, password: string) => Promise<void>;
  registerWithEmail: (name: string, email: string, password: string) => Promise<void>;
  requestPasswordReset: (email: string) => Promise<void>;
  resendVerificationEmail: () => Promise<void>;
  signOut: () => Promise<void>;
}

const AuthContext = createContext<AuthContextValue | undefined>(undefined);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const { locale, setLocale } = useI18n();
  const { theme, setTheme } = useTheme();
  const [user, setUser] = useState<User | null>(null);
  const [profile, setProfile] = useState<UserProfile | null>(null);
  const [loading, setLoading] = useState(true);
  const [authError, setAuthError] = useState<string | null>(null);

  useEffect(() => {
    let unsubProfile: (() => void) | null = null;

    const unsubAuth = onAuthStateChanged(auth, async (currentUser) => {
      if (unsubProfile) {
        unsubProfile();
        unsubProfile = null;
      }

      setUser(currentUser);
      if (!currentUser) {
        setProfile(null);
        setLoading(false);
        return;
      }

      if (currentUser.emailVerified) {
        try {
          const { profile: ensured } = await ensureUserProfileAndWorkspace(
            currentUser,
            locale,
            theme
          );
          setProfile(ensured);
          if (ensured.preferredLocale) setLocale(ensured.preferredLocale);
          if (ensured.preferredTheme) setTheme(ensured.preferredTheme);
        } catch (err) {
          console.error('Failed to initialize user profile:', err);
        }

        unsubProfile = subscribeUserProfile(currentUser.uid, (nextProfile) => {
          setProfile(nextProfile);
        });
      }

      setLoading(false);
    });

    return () => {
      unsubAuth();
      if (unsubProfile) unsubProfile();
    };
  }, []);

  const formatAuthError = (err: unknown): string => {
    const code =
      typeof err === 'object' && err !== null && 'code' in err
        ? String((err as { code?: unknown }).code)
        : '';
    if (code === 'auth/operation-not-allowed') {
      return 'OPERATION_NOT_ALLOWED';
    }
    if (code === 'auth/popup-closed-by-user') {
      return 'Sign-in popup was closed before completion.';
    }
    return err instanceof Error ? err.message : 'Authentication failed.';
  };

  const signInWithGoogle = async () => {
    setAuthError(null);
    try {
      await signInWithPopup(auth, googleAuthProvider);
    } catch (err) {
      setAuthError(formatAuthError(err));
      throw err;
    }
  };

  const signInWithEmail = async (email: string, password: string) => {
    setAuthError(null);
    try {
      await signInWithEmailAndPassword(auth, email.trim(), password);
    } catch (err) {
      setAuthError(formatAuthError(err));
      throw err;
    }
  };

  const registerWithEmail = async (name: string, email: string, password: string) => {
    setAuthError(null);
    try {
      const cred = await createUserWithEmailAndPassword(auth, email.trim(), password);
      if (name.trim()) {
        await updateProfile(cred.user, { displayName: name.trim() });
      }
      await sendEmailVerification(cred.user);
    } catch (err) {
      setAuthError(formatAuthError(err));
      throw err;
    }
  };

  const requestPasswordReset = async (email: string) => {
    setAuthError(null);
    try {
      await sendPasswordResetEmail(auth, email.trim());
    } catch (err) {
      setAuthError(formatAuthError(err));
      throw err;
    }
  };

  const resendVerificationEmail = async () => {
    if (!auth.currentUser) return;
    setAuthError(null);
    try {
      await sendEmailVerification(auth.currentUser);
    } catch (err) {
      setAuthError(formatAuthError(err));
      throw err;
    }
  };

  const signOut = async () => {
    setAuthError(null);
    await firebaseSignOut(auth);
  };

  return (
    <AuthContext.Provider
      value={{
        user,
        profile,
        loading,
        authError,
        clearAuthError: () => setAuthError(null),
        signInWithGoogle,
        signInWithEmail,
        registerWithEmail,
        requestPasswordReset,
        resendVerificationEmail,
        signOut,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}
