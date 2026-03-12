import React, { createContext, useContext, useState, useEffect } from 'react';
import { 
  signInWithEmailAndPassword, 
  createUserWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  signInWithPopup
} from 'firebase/auth';
import { auth, googleProvider } from '../config/firebase';
import axios from 'axios';

const AuthContext = createContext();

export const useAuth = () => useContext(AuthContext);

export const AuthProvider = ({ children }) => {
  const [currentUser, setCurrentUser] = useState(null);
  const [userProfile, setUserProfile] = useState(null);
  const [loading, setLoading] = useState(true);

  const API_URL = import.meta.env.VITE_API_URL || 'http://localhost:5000/api';

  // REQ-18: Check if email is locked for registration
  const checkRegistrationLock = async (email) => {
    try {
      const response = await axios.post(`${API_URL}/auth/check-registration`, { email });
      return response.data;
    } catch (error) {
      if (error.response?.status === 429) {
        return error.response.data;
      }
      throw error;
    }
  };

  // REQ-19: Check if account is locked for login
  const checkLoginLock = async (email) => {
    try {
      const response = await axios.post(`${API_URL}/auth/login-status`, { email });
      return response.data;
    } catch (error) {
      if (error.response?.status === 423) {
        return error.response.data;
      }
      throw error;
    }
  };

  // REQ-19: Record a failed login attempt
  const recordLoginFailure = async (email) => {
    try {
      const response = await axios.post(`${API_URL}/auth/login-failure`, { email });
      return response.data;
    } catch (error) {
      if (error.response?.status === 423) {
        return error.response.data;
      }
      return null;
    }
  };

  // REQ-19: Record a successful login
  const recordLoginSuccess = async (token) => {
    try {
      await axios.post(`${API_URL}/auth/login-success`, {}, {
        headers: { Authorization: `Bearer ${token}` }
      });
    } catch (error) {
      // Non-critical, don't block login flow
      console.error('Error recording login success:', error);
    }
  };

  const signup = async (email, password, name, role) => {
    // REQ-18: Check registration lock before attempting
    const lockStatus = await checkRegistrationLock(email);
    if (lockStatus.locked) {
      const error = new Error(lockStatus.message);
      error.lockData = lockStatus;
      throw error;
    }

    const userCredential = await createUserWithEmailAndPassword(auth, email, password);
    const token = await userCredential.user.getIdToken();

    // Register user in backend
    const response = await axios.post(`${API_URL}/auth/register`,
      { email, name, role },
      { headers: { Authorization: `Bearer ${token}` } }
    );

    setUserProfile(response.data.user);
    return userCredential;
  };

  const login = async (email, password) => {
    // REQ-19: Check lock status before attempting login
    const lockStatus = await checkLoginLock(email);
    if (lockStatus.locked) {
      const error = new Error(lockStatus.message);
      error.lockData = lockStatus;
      throw error;
    }

    try {
      const userCredential = await signInWithEmailAndPassword(auth, email, password);
      const token = await userCredential.user.getIdToken();
      await recordLoginSuccess(token);
      return userCredential;
    } catch (firebaseError) {
      // Record failure in backend for auth-related errors
      if (
        firebaseError.code === 'auth/wrong-password' ||
        firebaseError.code === 'auth/invalid-credential' ||
        firebaseError.code === 'auth/user-not-found' ||
        firebaseError.code === 'auth/invalid-email'
      ) {
        const failureResult = await recordLoginFailure(email);
        if (failureResult?.locked) {
          const lockError = new Error(failureResult.message);
          lockError.lockData = failureResult;
          throw lockError;
        }
        if (failureResult?.remainingAttempts !== undefined) {
          firebaseError.remainingAttempts = failureResult.remainingAttempts;
        }
      }
      throw firebaseError;
    }
  };

  const loginWithGoogle = async (role = 'student') => {
    const userCredential = await signInWithPopup(auth, googleProvider);
    const token = await userCredential.user.getIdToken();
    
    // Check if user exists in backend, if not register them
    try {
      const response = await axios.get(`${API_URL}/auth/me`, {
        headers: { Authorization: `Bearer ${token}` }
      });
      setUserProfile(response.data.user);
      return userCredential;
    } catch (error) {
      // User doesn't exist in backend, register them
      if (error.response?.status === 404 || error.response?.status === 401) {
        const response = await axios.post(`${API_URL}/auth/register`, 
          { 
            email: userCredential.user.email, 
            name: userCredential.user.displayName || userCredential.user.email.split('@')[0], 
            role 
          },
          { headers: { Authorization: `Bearer ${token}` } }
        );
        setUserProfile(response.data.user);
        return userCredential;
      }
      throw error;
    }
  };

  const logout = () => {
    setUserProfile(null);
    return signOut(auth);
  };

  const getAuthToken = async () => {
    if (currentUser) {
      return await currentUser.getIdToken();
    }
    return null;
  };

  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      setCurrentUser(user);
      
      if (user) {
        try {
          const token = await user.getIdToken();
          const response = await axios.get(`${API_URL}/auth/me`, {
            headers: { Authorization: `Bearer ${token}` }
          });
          setUserProfile(response.data.user);
        } catch (error) {
          console.error('Error fetching user profile:', error);
        }
      } else {
        setUserProfile(null);
      }
      
      setLoading(false);
    });

    return unsubscribe;
  }, []);

  const value = {
    currentUser,
    userProfile,
    signup,
    login,
    loginWithGoogle,
    logout,
    getAuthToken,
    checkRegistrationLock,
    checkLoginLock,
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
