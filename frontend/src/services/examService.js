import axios from "axios";

const API_URL = import.meta.env.VITE_API_URL || "http://localhost:5000/api";

// Create axios instance with defaults
const api = axios.create({
  baseURL: API_URL,
  timeout: 30000,
});

// Helper to set auth header
const authHeader = (token) => ({
  headers: { Authorization: `Bearer ${token}` },
});

export const examService = {
  // Exam operations
  createExam: async (token, examData) => {
    const response = await api.post("/exams", examData, authHeader(token));
    return response.data;
  },

  getExams: async (token) => {
    const response = await api.get("/exams", authHeader(token));
    return response.data;
  },

  getExam: async (token, examId) => {
    const response = await api.get(`/exams/${examId}`, authHeader(token));
    return response.data;
  },

  updateExam: async (token, examId, examData) => {
    const response = await api.put(
      `/exams/${examId}`,
      examData,
      authHeader(token),
    );
    return response.data;
  },

  deleteExam: async (token, examId) => {
    const response = await api.delete(`/exams/${examId}`, authHeader(token));
    return response.data;
  },

  // Submission operations
  startExam: async (token, examId) => {
    const response = await api.post(
      "/submissions/start",
      { examId },
      authHeader(token),
    );
    return response.data;
  },

  autoSave: async (
    token,
    submissionId,
    answers,
    tabSwitchCount,
    fullscreenExitCount,
  ) => {
    const response = await api.post(
      "/submissions/auto-save",
      {
        submissionId,
        answers,
        tabSwitchCount,
        fullscreenExitCount,
      },
      authHeader(token),
    );
    return response.data;
  },

  submitExam: async (token, submissionData) => {
    const response = await api.post(
      "/submissions",
      submissionData,
      authHeader(token),
    );
    return response.data;
  },

  getSubmissions: async (token, examId) => {
    const response = await api.get(
      `/submissions/exam/${examId}`,
      authHeader(token),
    );
    return response.data;
  },

  getSubmission: async (token, submissionId) => {
    const response = await api.get(
      `/submissions/${submissionId}`,
      authHeader(token),
    );
    return response.data;
  },

  getMySubmissions: async (token) => {
    const response = await api.get(
      "/submissions/my-submissions",
      authHeader(token),
    );
    return response.data;
  },

  reviewSubmission: async (token, submissionId, reviewData) => {
    const response = await api.put(
      `/submissions/${submissionId}/review`,
      reviewData,
      authHeader(token),
    );
    return response.data;
  },

  unlockSubmission: async (token, submissionId) => {
    const response = await api.put(
      `/submissions/${submissionId}/unlock`,
      {},
      authHeader(token),
    );
    return response.data;
  },

  // Notification operations
  getNotifications: async (token, page = 1, unreadOnly = false) => {
    const response = await api.get(
      `/notifications?page=${page}&unreadOnly=${unreadOnly}`,
      authHeader(token),
    );
    return response.data;
  },

  markNotificationRead: async (token, notificationId) => {
    const response = await api.put(
      `/notifications/${notificationId}/read`,
      {},
      authHeader(token),
    );
    return response.data;
  },

  markAllNotificationsRead: async (token) => {
    const response = await api.put(
      "/notifications/read-all",
      {},
      authHeader(token),
    );
    return response.data;
  },

  // Proctoring operations
  startProctoringSession: async (token, examId, submissionId, deviceInfo) => {
    const response = await api.post(
      "/proctoring/start",
      {
        examId,
        submissionId,
        deviceInfo,
      },
      authHeader(token),
    );
    return response.data;
  },

  logProctoringEvent: async (
    token,
    sessionId,
    eventType,
    severity,
    details,
    screenshot,
  ) => {
    const response = await api.post(
      "/proctoring/event",
      {
        sessionId,
        eventType,
        severity,
        details,
        screenshot,
      },
      authHeader(token),
    );
    return response.data;
  },

  endProctoringSession: async (token, sessionId) => {
    const response = await api.post(
      "/proctoring/end",
      { sessionId },
      authHeader(token),
    );
    return response.data;
  },

  uploadScreenshot: async (token, sessionId, image, reason) => {
    const response = await api.post(
      "/proctoring/screenshot",
      {
        sessionId,
        image,
        reason,
      },
      authHeader(token),
    );
    return response.data;
  },

  logFaceDetection: async (
    token,
    sessionId,
    facesDetected,
    screenshot,
  ) => {
    const response = await api.post(
      "/proctoring/face-detection",
      {
        sessionId,
        facesDetected,
        screenshot,
      },
      authHeader(token),
    );
    return response.data;
  },

  getActiveSessions: async (token) => {
    const response = await api.get("/proctoring/active", authHeader(token));
    return response.data;
  },

  getFlaggedSessions: async (token) => {
    const response = await api.get("/proctoring/flagged", authHeader(token));
    return response.data;
  },

  getSessionDetails: async (token, sessionId) => {
    const response = await api.get(
      `/proctoring/${sessionId}`,
      authHeader(token),
    );
    return response.data;
  },

  reviewSession: async (token, sessionId, reviewStatus, reviewNotes) => {
    const response = await api.put(
      `/proctoring/${sessionId}/review`,
      {
        reviewStatus,
        reviewNotes,
      },
      authHeader(token),
    );
    return response.data;
  },

  // Reports
  getDashboardStats: async (token) => {
    const response = await api.get(
      "/reports/stats/dashboard",
      authHeader(token),
    );
    return response.data;
  },

  generateReport: async (token, type, startDate, endDate, format = "json") => {
    const response = await api.post(
      "/reports/generate",
      {
        type,
        startDate,
        endDate,
        format,
      },
      authHeader(token),
    );
    return response.data;
  },

  getReports: async (token) => {
    const response = await api.get("/reports", authHeader(token));
    return response.data;
  },

  getReport: async (token, reportId) => {
    const response = await api.get(`/reports/${reportId}`, authHeader(token));
    return response.data;
  },

  // Admin operations
  getUsers: async (token, page = 1, limit = 20, filters = {}) => {
    const params = new URLSearchParams({ page, limit, ...filters });
    const response = await api.get(`/admin/users?${params}`, authHeader(token));
    return response.data;
  },

  getUser: async (token, userId) => {
    const response = await api.get(`/admin/users/${userId}`, authHeader(token));
    return response.data;
  },

  updateUser: async (token, userId, userData) => {
    const response = await api.put(
      `/admin/users/${userId}`,
      userData,
      authHeader(token),
    );
    return response.data;
  },

  deleteUser: async (token, userId) => {
    const response = await api.delete(
      `/admin/users/${userId}`,
      authHeader(token),
    );
    return response.data;
  },

  getAdminExams: async (token, page = 1, limit = 20, filters = {}) => {
    const params = new URLSearchParams({ page, limit, ...filters });
    const response = await api.get(`/admin/exams?${params}`, authHeader(token));
    return response.data;
  },

  deleteExamAdmin: async (token, examId) => {
    const response = await api.delete(
      `/admin/exams/${examId}`,
      authHeader(token),
    );
    return response.data;
  },

  getSystemHealth: async (token) => {
    const response = await api.get("/admin/health", authHeader(token));
    return response.data;
  },

  // 2FA operations
  enable2FA: async (token) => {
    const response = await api.post("/auth/2fa/enable", {}, authHeader(token));
    return response.data;
  },

  verify2FA: async (token, code) => {
    const response = await api.post(
      "/auth/2fa/verify",
      { code },
      authHeader(token),
    );
    return response.data;
  },

  validate2FA: async (token, code) => {
    const response = await api.post(
      "/auth/2fa/validate",
      { code },
      authHeader(token),
    );
    return response.data;
  },

  disable2FA: async (token, code) => {
    const response = await api.post(
      "/auth/2fa/disable",
      { code },
      authHeader(token),
    );
    return response.data;
  },

  get2FAStatus: async (token) => {
    const response = await api.get("/auth/2fa/status", authHeader(token));
    return response.data;
  },

  // Profile
  updateProfile: async (token, profileData) => {
    const response = await api.put(
      "/auth/profile",
      profileData,
      authHeader(token),
    );
    return response.data;
  },

  // Calibration
  saveCalibration: async (token, sessionId, calibrationData) => {
    const response = await api.post(
      `/proctoring/${sessionId}/calibrate`,
      calibrationData,
      authHeader(token),
    );
    return response.data;
  },
};
