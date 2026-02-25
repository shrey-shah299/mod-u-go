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

  const signup = async (email, password, name, role) => {
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
    return signInWithEmailAndPassword(auth, email, password);
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
  };

  return (
    <AuthContext.Provider value={value}>
      {!loading && children}
    </AuthContext.Provider>
  );
};
