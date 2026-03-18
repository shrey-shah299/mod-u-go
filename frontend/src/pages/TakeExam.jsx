import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import * as faceapi from "face-api.js";
import { useAuth } from "../contexts/AuthContext";
import { examService } from "../services/examService";
import CalibrationScreen from "../components/CalibrationScreen";
import "./TakeExam.css";

const TakeExam = () => {
  const { examId } = useParams();
  const { getAuthToken } = useAuth();
  const navigate = useNavigate();

  const [exam, setExam] = useState(null);
  const [submission, setSubmission] = useState(null);
  const [proctoringSession, setProctoringSession] = useState(null);
  const [answers, setAnswers] = useState({});
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [timeRemaining, setTimeRemaining] = useState(0);
  const [tabSwitchCount, setTabSwitchCount] = useState(0);
  const [fullscreenExitCount, setFullscreenExitCount] = useState(0);
  const [isFullscreen, setIsFullscreen] = useState(false);
  const [focusWarning, setFocusWarning] = useState(null);
  const [lastAutoSave, setLastAutoSave] = useState(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState("");
  const [webcamEnabled, setWebcamEnabled] = useState(false);
  const [trustScore, setTrustScore] = useState(100);
  const [trustScoreFlash, setTrustScoreFlash] = useState(false);
  const [showInstructions, setShowInstructions] = useState(true);
  const [currentQuestion, setCurrentQuestion] = useState(0);
  const [calibrationRequired, setCalibrationRequired] = useState(false);
  const [calibrationComplete, setCalibrationComplete] = useState(false);
  const [faceStatus, setFaceStatus] = useState("idle"); // idle|ok|no_face|multiple_faces|looking_away
  const [isLocked, setIsLocked] = useState(false);
  const [lockReason, setLockReason] = useState("");

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const autoSaveIntervalRef = useRef(null);
  const webcamIntervalRef = useRef(null);
  const focusWarningTimerRef = useRef(null);
  const examRef = useRef(null);
  const submittingRef = useRef(false);
  const proctoringSessionRef = useRef(null);
  const focusLostAtRef = useRef(null);
  const monitoringEnabledRef = useRef(false);
  const streamRef = useRef(null); // Holds the raw MediaStream so we can stop it reliably
  const faceDetectionIntervalRef = useRef(null);
  const faceModelsLoadedRef = useRef(false); // Tracks whether face-api models are loaded
  const lastFaceEventRef = useRef({}); // Per-event cooldown timestamps

  // Load exam data on mount (for instructions screen)
  useEffect(() => {
    loadExamData();
    return () => {
      cleanup();
    };
  }, [examId]);

  // Start the exam when user dismisses instructions
  useEffect(() => {
    if (!showInstructions && exam) {
      startExamSession();
    }
  }, [showInstructions]);

  useEffect(() => {
    examRef.current = exam;
  }, [exam]);

  useEffect(() => {
    proctoringSessionRef.current = proctoringSession;
  }, [proctoringSession]);

  useEffect(() => {
    submittingRef.current = submitting;
  }, [submitting]);

  useEffect(() => {
    if (exam && timeRemaining > 0 && !showInstructions) {
      const timer = setInterval(() => {
        setTimeRemaining((prev) => {
          if (prev <= 1) {
            handleSubmit(true);
            return 0;
          }
          if (prev === 300) {
            alert("Warning: 5 minutes remaining!");
          }
          if (prev === 60) {
            alert("Warning: 1 minute remaining!");
          }
          return prev - 1;
        });
      }, 1000);

      return () => clearInterval(timer);
    }
  }, [exam, timeRemaining, showInstructions]);

  // Load exam data for instructions screen
  const loadExamData = async () => {
    try {
      const token = await getAuthToken();
      const examData = await examService.getExam(token, examId);
      setExam(examData.exam);
    } catch (error) {
      console.error("Error loading exam:", error);
      alert(
        "Error loading exam: " +
          (error.response?.data?.message || error.message),
      );
      navigate("/dashboard");
    } finally {
      setLoading(false);
    }
  };

  // Start the actual exam session after instructions
  const startExamSession = async () => {
    try {
      setLoading(true);
      const token = await getAuthToken();

      const submissionData = await examService.startExam(token, examId);
      setSubmission(submissionData.submission);

      const now = new Date();
      const endTime = new Date(exam.endTime);
      const remainingSeconds = Math.floor((endTime - now) / 1000);
      setTimeRemaining(Math.max(0, remainingSeconds));

      const initialAnswers = {};
      if (
        submissionData.submission.answers &&
        submissionData.submission.answers.length > 0
      ) {
        submissionData.submission.answers.forEach((a) => {
          initialAnswers[a.questionId] = a.answer || "";
        });
      } else {
        exam.questions.forEach((q) => {
          initialAnswers[q._id] = "";
        });
      }
      setAnswers(initialAnswers);
      setTabSwitchCount(submissionData.submission.tabSwitchCount || 0);
      setFullscreenExitCount(
        submissionData.submission.fullscreenExitCount || 0,
      );

      // Check if submission is already locked (page reload scenario)
      if (submissionData.submission.status === "locked") {
        setIsLocked(true);
        setLockReason(
          submissionData.submission.lockInfo?.lockReason ||
            "Your exam has been locked due to violations.",
        );
        return;
      }

      if (exam.settings?.requireWebcam !== false) {
        await startProctoring(token, exam._id, submissionData.submission._id);
      }

      // Always request fullscreen for proctored exams
      requestFullscreen();

      setupMonitoring();

      autoSaveIntervalRef.current = setInterval(() => {
        performAutoSave();
      }, 30000);
    } catch (error) {
      console.error("Error starting exam:", error);
      alert(
        "Error starting exam: " +
          (error.response?.data?.message || error.message),
      );
      navigate("/dashboard");
    } finally {
      setLoading(false);
    }
  };

  const startProctoring = async (token, examIdParam, submissionId) => {
    try {
      const deviceInfo = {
        browser: navigator.userAgent,
        os: navigator.platform,
        screenResolution: `${window.screen.width}x${window.screen.height}`,
      };

      const response = await examService.startProctoringSession(
        token,
        examIdParam,
        submissionId,
        deviceInfo,
      );
      setProctoringSession(response.session);

      // Show calibration screen if camera is required
      if (exam.settings?.requireWebcam !== false) {
        setCalibrationRequired(true);
      } else {
        // Skip calibration if camera not required
        setCalibrationComplete(true);
        await startWebcam();
        webcamIntervalRef.current = setInterval(() => {
          captureAndUploadScreenshot();
        }, 60000);
      }
    } catch (error) {
      console.error("Error starting proctoring:", error);
    }
  };

  const startWebcam = async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: "user", width: 320, height: 240 },
        audio: false,
      });

      // Keep the stream in a ref so cleanup() can always stop it,
      // even if videoRef.current becomes null during navigation.
      streamRef.current = stream;

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setWebcamEnabled(true);
      }
    } catch (error) {
      console.error("Error starting webcam:", error);
      logProctoringEvent("webcam_disabled", "high", "Failed to access webcam");
    }
  };

  // ─── Live AI Face Detection ─────────────────────────────────────────────────

  const ensureModelsLoaded = async () => {
    if (faceModelsLoadedRef.current) return;
    const MODEL_URL = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api/model/";
    await Promise.all([
      faceapi.nets.tinyFaceDetector.load(MODEL_URL),
      faceapi.nets.faceLandmark68Net.load(MODEL_URL),
    ]);
    faceModelsLoadedRef.current = true;
  };

  const analyzeFaceDetection = async () => {
    if (!videoRef.current || submittingRef.current) return;
    try {
      const detections = await faceapi
        .detectAllFaces(videoRef.current, new faceapi.TinyFaceDetectorOptions({ inputSize: 224, scoreThreshold: 0.5 }))
        .withFaceLandmarks();

      const count = detections.length;
      const now = Date.now();

      // Log an event type at most once per cooldown period
      const canLog = (type, ms = 15000) => {
        const last = lastFaceEventRef.current[type] || 0;
        if (now - last >= ms) { lastFaceEventRef.current[type] = now; return true; }
        return false;
      };

      if (count === 0) {
        setFaceStatus("no_face");
        if (canLog("face_not_detected"))
          logProctoringEvent("face_not_detected", "high", "No face detected in frame");
      } else if (count > 1) {
        setFaceStatus("multiple_faces");
        if (canLog("multiple_faces"))
          logProctoringEvent("multiple_faces", "high", `${count} faces detected simultaneously`);
      } else {
        const pts = detections[0].landmarks.positions;
        const box = detections[0].detection.box;

        // Eye centers (left: 36-41, right: 42-47)
        const mx = (idx) => idx.reduce((s, i) => s + pts[i].x, 0) / idx.length;
        const eyeMidX = (mx([36,37,38,39,40,41]) + mx([42,43,44,45,46,47])) / 2;
        const headTurnRatio = Math.abs(pts[33].x - eyeMidX) / box.width;

        // Eye Aspect Ratio – detects closed/downcast eyes
        const d = (a, b) => Math.hypot(pts[a].x - pts[b].x, pts[a].y - pts[b].y);
        const leftEAR  = (d(37,41) + d(38,40)) / (2 * d(36,39));
        const rightEAR = (d(43,47) + d(44,46)) / (2 * d(42,45));
        const avgEAR = (leftEAR + rightEAR) / 2;

        if (headTurnRatio > 0.18) {
          setFaceStatus("looking_away");
          if (canLog("suspicious_movement", 20000))
            logProctoringEvent("suspicious_movement", "medium", `Head turned away (${Math.round(headTurnRatio*100)}% offset)`);
        } else if (avgEAR < 0.15) {
          setFaceStatus("looking_away");
          if (canLog("suspicious_movement", 20000))
            logProctoringEvent("suspicious_movement", "medium", `Eyes closed/downcast (EAR: ${avgEAR.toFixed(2)})`);
        } else {
          setFaceStatus("ok");
        }
      }
    } catch (err) {
      console.warn("Face detection frame error:", err.message);
    }
  };

  const startLiveFaceDetection = async () => {
    try {
      await ensureModelsLoaded();
      setFaceStatus("ok");
      faceDetectionIntervalRef.current = setInterval(analyzeFaceDetection, 5000);
    } catch (err) {
      console.error("Failed to start live face detection:", err);
    }
  };

  // ────────────────────────────────────────────────────────────────────────────

  const captureAndUploadScreenshot = async () => {
    if (!videoRef.current || !canvasRef.current || !proctoringSession) return;

    try {
      const canvas = canvasRef.current;
      const video = videoRef.current;
      const ctx = canvas.getContext("2d");

      canvas.width = video.videoWidth || 320;
      canvas.height = video.videoHeight || 240;
      ctx.drawImage(video, 0, 0);

      const image = canvas.toDataURL("image/jpeg", 0.5);

      const token = await getAuthToken();
      await examService.uploadScreenshot(
        token,
        proctoringSession._id,
        image,
        "periodic",
      );
    } catch (error) {
      console.error("Error capturing screenshot:", error);
    }
  };

  const logProctoringEvent = async (eventType, severity, details) => {
    if (!proctoringSessionRef.current) return null;

    // Optimistic update: deduct immediately so the score updates without
    // waiting for the network round-trip.
    const penalty = { low: 2, medium: 5, high: 10 }[severity] || 5;
    setTrustScore((prev) => Math.max(0, prev - penalty));
    setTrustScoreFlash(true);
    setTimeout(() => setTrustScoreFlash(false), 800);

    try {
      const token = await getAuthToken();
      const response = await examService.logProctoringEvent(
        token,
        proctoringSessionRef.current._id,
        eventType,
        severity,
        details,
      );
      // Reconcile with the authoritative server value
      if (response.session?.trustScore !== undefined) {
        setTrustScore(response.session.trustScore);
      }

      // Check if the server locked the exam
      if (response.locked) {
        setIsLocked(true);
        setLockReason(response.lockReason || "Your exam has been locked due to excessive violations.");
        // Auto-submit the exam when locked
        handleSubmit(true);
        return response.session?.trustScore ?? null;
      }

      return response.session?.trustScore ?? null;
    } catch (error) {
      console.error("Error logging proctoring event:", error);
    }
    return null;
  };

  const handleCalibrationComplete = async (calibrationData) => {
    console.log("Calibration completed:", calibrationData);
    setCalibrationRequired(false);
    setCalibrationComplete(true);

    // Start webcam after calibration
    await startWebcam();

    // Enable proctoring monitoring NOW
    monitoringEnabledRef.current = true;

    // Start periodic screenshot uploads
    webcamIntervalRef.current = setInterval(() => {
      captureAndUploadScreenshot();
    }, 60000);

    // Start live AI face detection
    startLiveFaceDetection();
  };

  const handleCalibrationFailed = (error) => {
    console.error("Calibration failed:", error);
    alert(`Calibration failed: ${error}. Please try again or contact support.`);
    // Could optionally retry or allow exam without full calibration
    setCalibrationRequired(false);
    // Proceed with exam but flag it
    logProctoringEvent(
      "calibration_failed",
      "high",
      `Camera calibration failed: ${error}`
    );
  };

  const performAutoSave = async () => {
    if (!submission || submittingRef.current) return;

    try {
      setAutoSaveStatus("Saving...");
      const token = await getAuthToken();

      const answersArray = Object.entries(answers).map(
        ([questionId, answer]) => ({
          questionId,
          answer,
        }),
      );

      const response = await examService.autoSave(
        token,
        submission._id,
        answersArray,
        tabSwitchCount,
        fullscreenExitCount,
      );

      setLastAutoSave(new Date(response.lastAutoSave));
      setAutoSaveStatus("Saved");

      setTimeout(() => setAutoSaveStatus(""), 2000);
    } catch (error) {
      console.error("Error auto-saving:", error);
      setAutoSaveStatus("Save failed");
    }
  };

  const requestFullscreen = async () => {
    try {
      const elem = document.documentElement;
      if (elem.requestFullscreen) {
        await elem.requestFullscreen();
      } else if (elem.webkitRequestFullscreen) {
        await elem.webkitRequestFullscreen();
      } else if (elem.msRequestFullscreen) {
        await elem.msRequestFullscreen();
      }
      setIsFullscreen(true);
    } catch (error) {
      console.error("Error requesting fullscreen:", error);
    }
  };

  const exitFullscreen = () => {
    try {
      if (document.exitFullscreen) {
        document.exitFullscreen().catch(() => {});
      } else if (document.webkitExitFullscreen) {
        document.webkitExitFullscreen();
      } else if (document.msExitFullscreen) {
        document.msExitFullscreen();
      }
    } catch (e) {
      // Ignore errors
    }
  };

  const handleFullscreenChange = useCallback(() => {
    const isCurrentlyFullscreen = !!(
      document.fullscreenElement ||
      document.webkitFullscreenElement ||
      document.msFullscreenElement
    );

    setIsFullscreen(isCurrentlyFullscreen);

    // Only log fullscreen exit if monitoring is enabled (not during calibration)
    // and if the page is not hidden, and exam is active, and not already submitting
    if (!isCurrentlyFullscreen && examRef.current && !submittingRef.current && !document.hidden && monitoringEnabledRef.current) {
      setFullscreenExitCount((prev) => {
        const newCount = prev + 1;
        const remaining = 5 - newCount;
        logProctoringEvent(
          "fullscreen_exit",
          "high",
          `Exited fullscreen (count: ${newCount})`,
        );
        if (remaining > 0) {
          alert(
            `Warning: You exited fullscreen mode (${newCount}/5). ${remaining} more and your exam will be auto-locked!`,
          );
        }
        return newCount;
      });
      if (!isLocked) {
        setTimeout(() => requestFullscreen(), 500);
      }
    }
  }, []);

  // EventMonitor: showFocusWarning
  // Displays a timed on-screen warning banner and auto-dismisses after 5 s.
  const showFocusWarning = useCallback((message) => {
    setFocusWarning(message);
    if (focusWarningTimerRef.current) clearTimeout(focusWarningTimerRef.current);
    focusWarningTimerRef.current = setTimeout(() => setFocusWarning(null), 5000);
  }, []);

  // EventMonitor: handleVisibilityChange
  // Detects tab switches via the Page Visibility API (document.hidden).
  // On hide: logs tab_switch, records timestamp. On return: logs duration away.
  const handleVisibilityChange = useCallback(async () => {
    if (!examRef.current || submittingRef.current || !monitoringEnabledRef.current) return;

    if (document.hidden) {
      focusLostAtRef.current = Date.now();
      setTabSwitchCount((prev) => prev + 1);
      const remaining = 5 - (tabSwitchCount + 1);
      const newScore = await logProctoringEvent(
        "tab_switch",
        "high",
        `Tab switched (count: ${tabSwitchCount + 1})`,
      );
      const scoreInfo = newScore !== null ? ` Trust score: ${newScore}%` : "";
      const lockWarning = remaining > 0 ? ` ${remaining} more and your exam will be auto-locked!` : "";
      showFocusWarning(
        `Warning: Tab switch detected (${tabSwitchCount + 1}/5).${scoreInfo}${lockWarning}`,
      );
    } else {
      // User returned to the exam tab
      if (focusLostAtRef.current) {
        const durationSec = Math.round((Date.now() - focusLostAtRef.current) / 1000);
        focusLostAtRef.current = null;
        logProctoringEvent(
          "tab_returned",
          "low",
          `Returned to exam after ${durationSec}s away`,
        );
      }
    }
  }, [showFocusWarning, tabSwitchCount]);

  // EventMonitor: handleBlur / handleFocus (window focus listeners)
  // handleBlur: window lost OS focus (but tab is still active).
  // handleFocus: window regained OS focus — logs how long the student was away.
  const handleBlur = useCallback(async () => {
    if (examRef.current && !submittingRef.current && !document.hidden && monitoringEnabledRef.current) {
      focusLostAtRef.current = Date.now();
      const newScore = await logProctoringEvent(
        "focus_lost",
        "medium",
        "Window lost focus",
      );
      const scoreInfo = newScore !== null ? ` Trust score: ${newScore}%` : "";
      showFocusWarning(
        `Warning: Focus loss detected (-5 trust score points).${scoreInfo} This event has been queued for teacher review.`,
      );
    }
  }, [showFocusWarning]);

  const handleFocus = useCallback(() => {
    if (examRef.current && !submittingRef.current && focusLostAtRef.current) {
      const durationSec = Math.round((Date.now() - focusLostAtRef.current) / 1000);
      focusLostAtRef.current = null;
      logProctoringEvent(
        "focus_returned",
        "low",
        `Returned to exam window after ${durationSec}s away`,
      );
    }
  }, []);

  const handleCopyPaste = useCallback((e) => {
    if (examRef.current) {
      e.preventDefault();
      logProctoringEvent("copy_paste", "high", `${e.type} attempt detected`);
    }
  }, []);

  const handleContextMenu = useCallback((e) => {
    if (examRef.current) {
      e.preventDefault();
      logProctoringEvent("right_click", "medium", "Right-click attempt");
    }
  }, []);

  const blockRestrictedInputs = useCallback((e) => {
    if (!examRef.current) return;

    // Block PrintScreen (screenshot_attempt)
    if (e.key === "PrintScreen") {
      e.preventDefault();
      // Try to clear clipboard to ruin the screenshot if it bypassed e.preventDefault()
      try { navigator.clipboard.writeText(""); } catch (err) {}
      logProctoringEvent(
        "screenshot_attempt",
        "high",
        "Attempted to take a screenshot",
      );
      showFocusWarning("Warning: Taking screenshots is strictly prohibited (-10 trust score).");
      return;
    }

    // Block keyboard shortcuts: Ctrl/Cmd + C, V, P, A
    if (
      (e.ctrlKey || e.metaKey) &&
      ["c", "v", "p", "a"].includes(e.key.toLowerCase())
    ) {
      e.preventDefault();
      const shortcut = `Ctrl+${e.key.toUpperCase()}`;
      logProctoringEvent(
        "keyboard_shortcut",
        "medium",
        `Blocked shortcut: ${shortcut}`,
      );
      showFocusWarning(`Warning: Keyboard shortcut ${shortcut} is disabled (-5 trust score).`);
      return;
    }

    // Block Developer Tools: F12 or Ctrl+Shift+I
    if (e.key === "F12" || (e.ctrlKey && e.shiftKey && e.key.toLowerCase() === "i")) {
      e.preventDefault();
      logProctoringEvent(
        "dev_tools_opened",
        "high",
        "Attempted to open developer tools",
      );
      showFocusWarning("Warning: Opening developer tools is strictly prohibited (-10 trust score).");
      return;
    }
  }, [showFocusWarning]);

  const setupMonitoring = () => {
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("copy", handleCopyPaste);
    document.addEventListener("paste", handleCopyPaste);
    document.addEventListener("cut", handleCopyPaste);
    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("keydown", blockRestrictedInputs);
    window.addEventListener("blur", handleBlur);
    window.addEventListener("focus", handleFocus);
  };

  const removeMonitoring = () => {
    document.removeEventListener("fullscreenchange", handleFullscreenChange);
    document.removeEventListener(
      "webkitfullscreenchange",
      handleFullscreenChange,
    );
    document.removeEventListener("visibilitychange", handleVisibilityChange);
    document.removeEventListener("copy", handleCopyPaste);
    document.removeEventListener("paste", handleCopyPaste);
    document.removeEventListener("cut", handleCopyPaste);
    document.removeEventListener("contextmenu", handleContextMenu);
    document.removeEventListener("keydown", blockRestrictedInputs);
    window.removeEventListener("blur", handleBlur);
    window.removeEventListener("focus", handleFocus);
  };

  const cleanup = () => {
    removeMonitoring();
    exitFullscreen();

    if (autoSaveIntervalRef.current) {
      clearInterval(autoSaveIntervalRef.current);
    }
    if (webcamIntervalRef.current) {
      clearInterval(webcamIntervalRef.current);
    }
    if (faceDetectionIntervalRef.current) {
      clearInterval(faceDetectionIntervalRef.current);
      faceDetectionIntervalRef.current = null;
    }
    if (focusWarningTimerRef.current) {
      clearTimeout(focusWarningTimerRef.current);
    }

    // Stop via the dedicated stream ref first (reliable even after navigation).
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    }

    // Also clear the video element's srcObject so the browser releases the device.
    if (videoRef.current) {
      videoRef.current.srcObject = null;
    }
  };

  const handleAnswerChange = (questionId, value) => {
    setAnswers((prev) => ({
      ...prev,
      [questionId]: value,
    }));
  };

  const getWordCount = (text) => {
    return text ? text.trim().split(/\s+/).filter(word => word.length > 0).length : 0;
  };

  const validateWordLimits = () => {
    for (let i = 0; i < exam.questions.length; i++) {
      const q = exam.questions[i];
      // Only validate word limits for short_answer and essay questions
      if ((q.type === "short_answer" || q.type === "essay") && q.constraints?.wordLimit) {
        const answer = answers[q._id] || "";
        const wordCount = getWordCount(answer);
        if (wordCount > q.constraints.wordLimit) {
          return {
            valid: false,
            message: `Question ${i + 1} exceeds word limit of ${q.constraints.wordLimit} words (current: ${wordCount} words)`,
          };
        }
      }
    }
    return { valid: true };
  };

  const handleSubmit = async (autoSubmit = false) => {
    if (submitting) return;

    // Validate word limits
    if (!autoSubmit) {
      const wordLimitValidation = validateWordLimits();
      if (!wordLimitValidation.valid) {
        alert(wordLimitValidation.message);
        return;
      }
    }

    if (!autoSubmit) {
      const unansweredCount = Object.values(answers).filter(
        (a) => !a || a.trim() === "",
      ).length;
      if (unansweredCount > 0) {
        const confirmed = window.confirm(
          `You have ${unansweredCount} unanswered question(s). Are you sure you want to submit?`,
        );
        if (!confirmed) return;
      } else {
        const confirmed = window.confirm(
          "Are you sure you want to submit your exam?",
        );
        if (!confirmed) return;
      }
    }

    try {
      setSubmitting(true);

      // Stop webcam, clear intervals, remove monitoring, and exit fullscreen
      // immediately so the camera turns off as soon as the student submits.
      cleanup();

      const token = await getAuthToken();

      if (proctoringSession) {
        try {
          await examService.endProctoringSession(token, proctoringSession._id);
        } catch (e) {
          console.error("Error ending proctoring session:", e);
        }
      }

      const submissionData = {
        examId,
        submissionId: submission?._id,
        answers: Object.entries(answers).map(([questionId, answer]) => ({
          questionId,
          answer: answer || "",
        })),
        tabSwitchCount,
        fullscreenExitCount,
      };

      const result = await examService.submitExam(token, submissionData);

      alert(
        `Exam submitted successfully!\nScore: ${result.score}/${result.maxScore} (${result.percentage}%)`,
      );
      navigate("/dashboard", { replace: true });
    } catch (error) {
      console.error("Error submitting exam:", error);
      alert(
        "Error submitting exam: " +
          (error.response?.data?.message || error.message),
      );
      setSubmitting(false);
    }
  };

  const formatTime = (seconds) => {
    const hours = Math.floor(seconds / 3600);
    const minutes = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${hours.toString().padStart(2, "0")}:${minutes.toString().padStart(2, "0")}:${secs.toString().padStart(2, "0")}`;
  };

  const goToQuestion = (index) => {
    if (
      exam?.settings?.allowBackNavigation !== false ||
      index > currentQuestion
    ) {
      setCurrentQuestion(index);
    }
  };

  if (loading) {
    return <div className="loading">Loading exam...</div>;
  }

  if (showInstructions && exam) {
    return (
      <div className="exam-instructions">
        <h1>{exam.title}</h1>
        <div className="instructions-content">
          <h2>Exam Instructions</h2>
          <div className="instructions-text">
            {exam.instructions ||
              "Please read the following instructions carefully before starting the exam."}
          </div>

          <div className="exam-info">
            <p>
              <strong>Duration:</strong> {exam.duration} minutes
            </p>
            <p>
              <strong>Total Questions:</strong> {exam.questions.length}
            </p>
            <p>
              <strong>Total Points:</strong>{" "}
              {exam.questions.reduce((sum, q) => sum + q.points, 0)}
            </p>
            {exam.settings?.passingScore && (
              <p>
                <strong>Passing Score:</strong> {exam.settings.passingScore}%
              </p>
            )}
          </div>

          <div className="proctoring-notice">
            <h3>Proctoring Notice</h3>
            <ul>
              <li>Your webcam will be enabled during the exam</li>
              <li>Tab switching and window focus will be monitored</li>
              <li>Fullscreen mode is required</li>
              <li>Copy/paste and right-click are disabled</li>
              <li>Your answers are auto-saved every 30 seconds</li>
            </ul>
          </div>

          <button
            onClick={() => setShowInstructions(false)}
            className="btn-start-exam"
          >
            I Understand, Start Exam
          </button>
        </div>
      </div>
    );
  }

  if (!exam) {
    return <div className="error">Exam not found</div>;
  }

  if (calibrationRequired && proctoringSession) {
    return (
      <CalibrationScreen
        onCalibrationComplete={handleCalibrationComplete}
        onCalibrationFailed={handleCalibrationFailed}
        token={getAuthToken}
        sessionId={proctoringSession._id}
      />
    );
  }

  if (!calibrationComplete && exam.settings?.requireWebcam !== false && !showInstructions) {
    return <div className="loading">Initializing proctoring session...</div>;
  }

  // Show locked overlay
  if (isLocked) {
    return (
      <div className="exam-locked-overlay">
        <div className="locked-content">
          <div className="locked-icon">🔒</div>
          <h1>Exam Locked</h1>
          <p className="locked-reason">{lockReason}</p>
          <div className="locked-details">
            <p>Your answers have been automatically submitted.</p>
            <p>Your teacher has been notified and will review your submission.</p>
          </div>
          <div className="locked-stats">
            <div className="locked-stat">
              <span className="stat-label">Tab Switches</span>
              <span className="stat-value">{tabSwitchCount}</span>
            </div>
            <div className="locked-stat">
              <span className="stat-label">Fullscreen Exits</span>
              <span className="stat-value">{fullscreenExitCount}</span>
            </div>
            <div className="locked-stat">
              <span className="stat-label">Trust Score</span>
              <span className="stat-value">{trustScore}%</span>
            </div>
          </div>
          <button
            className="btn-return-dashboard"
            onClick={() => navigate("/dashboard", { replace: true })}
          >
            Return to Dashboard
          </button>
        </div>
      </div>
    );
  }

  const currentQ = exam.questions[currentQuestion];

  return (
    <div className="take-exam">
      <div className="exam-header">
        <h1>{exam.title}</h1>
        <div className="exam-status">
          <div className="exam-timer">
            Time:{" "}
            <span className={timeRemaining < 300 ? "time-warning" : ""}>
              {formatTime(timeRemaining)}
            </span>
          </div>
          <div className="trust-score">
            Trust:{" "}
            <span className={`${trustScore < 50 ? "score-warning" : ""} ${trustScoreFlash ? "score-flash" : ""}`}>
              {trustScore}%
            </span>
          </div>
          {webcamEnabled && faceStatus !== "idle" && (
            <div style={{ fontSize: "0.78rem", display: "flex", alignItems: "center", gap: "4px", fontWeight: 600 }}>
              {faceStatus === "ok"             && <span style={{ color: "#22c55e" }}>🟢 Face OK</span>}
              {faceStatus === "no_face"        && <span style={{ color: "#ef4444" }}>🔴 No Face!</span>}
              {faceStatus === "multiple_faces" && <span style={{ color: "#ef4444" }}>🔴 Multiple Faces!</span>}
              {faceStatus === "looking_away"   && <span style={{ color: "#f59e0b" }}>🟡 Look at screen</span>}
            </div>
          )}
        </div>
      </div>

      {focusWarning && (
        <div className="focus-warning-banner" role="alert">
          <span className="focus-warning-icon">&#9888;</span>
          <span className="focus-warning-text">{focusWarning}</span>
          <button
            className="focus-warning-close"
            onClick={() => setFocusWarning(null)}
            aria-label="Dismiss warning"
          >
            &times;
          </button>
        </div>
      )}

      <div className="exam-warnings">
        <span>
          Tab: {tabSwitchCount} | FS Exit: {fullscreenExitCount}
        </span>
        {!isFullscreen && (
          <button className="btn-fullscreen" onClick={requestFullscreen}>
            Return to fullscreen
          </button>
        )}
        {autoSaveStatus && (
          <span className="auto-save-status"> | {autoSaveStatus}</span>
        )}
      </div>

      <div className="webcam-container">
        <video
          ref={videoRef}
          autoPlay
          muted
          playsInline
          className="webcam-preview"
          style={{
            width: "160px",
            height: "120px",
            objectFit: "cover",
            borderRadius: "8px",
            background: "#000",
          }}
        />
        <canvas ref={canvasRef} style={{ display: "none" }} />
        {!webcamEnabled && <span className="webcam-warning">No webcam</span>}
      </div>

      <div className="question-nav">
        {exam.questions.map((q, index) => (
          <button
            key={q._id}
            onClick={() => goToQuestion(index)}
            className={`nav-btn ${index === currentQuestion ? "active" : ""} ${answers[q._id] ? "answered" : ""}`}
            disabled={
              exam.settings?.allowBackNavigation === false &&
              index < currentQuestion
            }
          >
            {index + 1}
          </button>
        ))}
      </div>

      <div className="question-container">
        <div className="question-card">
          <h3>
            Question {currentQuestion + 1} of {exam.questions.length} (
            {currentQ.points} pt{currentQ.points !== 1 ? "s" : ""})
          </h3>
          
          {currentQ.constraints && (
            <div className="question-constraints">
              <span className={`constraint-badge difficulty-${currentQ.constraints.difficultyLevel}`}>
                {currentQ.constraints.difficultyLevel.charAt(0).toUpperCase() + currentQ.constraints.difficultyLevel.slice(1)}
              </span>
              {currentQ.type !== "mcq" && currentQ.type !== "fill_blank" && currentQ.constraints.wordLimit && (
                <span className="constraint-badge word-limit">
                  Max {currentQ.constraints.wordLimit} words
                </span>
              )}
            </div>
          )}
          
          <p className="question-text">{currentQ.question}</p>

          {currentQ.type === "mcq" && (
            <div className="mcq-options">
              {currentQ.options?.map((option, optIndex) => (
                <label key={optIndex} className="mcq-option">
                  <input
                    type="radio"
                    name={`question-${currentQ._id}`}
                    value={option}
                    checked={answers[currentQ._id] === option}
                    onChange={(e) =>
                      handleAnswerChange(currentQ._id, e.target.value)
                    }
                  />
                  <span>{option}</span>
                </label>
              ))}
            </div>
          )}

          {currentQ.type === "true_false" && (
            <div className="mcq-options">
              {["True", "False"].map((option) => (
                <label key={option} className="mcq-option">
                  <input
                    type="radio"
                    name={`question-${currentQ._id}`}
                    value={option}
                    checked={answers[currentQ._id] === option}
                    onChange={(e) =>
                      handleAnswerChange(currentQ._id, e.target.value)
                    }
                  />
                  <span>{option}</span>
                </label>
              ))}
            </div>
          )}

          {(currentQ.type === "short_answer" || currentQ.type === "essay") && (
            <div className="text-input-container">
              <textarea
                key={`answer-${currentQ._id}`}
                className="answer-input"
                value={answers[currentQ._id] || ""}
                onChange={(e) => handleAnswerChange(currentQ._id, e.target.value)}
                placeholder="Type your answer here..."
                rows={currentQ.type === "essay" ? 8 : 4}
              />
              <div className="word-count-info">
                <span className={`word-count ${getWordCount(answers[currentQ._id]) > (currentQ.constraints?.wordLimit || Infinity) ? 'exceeded' : ''}`}>
                  Words: {getWordCount(answers[currentQ._id])}
                  {currentQ.constraints?.wordLimit && ` / ${currentQ.constraints.wordLimit}`}
                </span>
              </div>
            </div>
          )}

          {currentQ.type === "fill_blank" && (
            <input
              type="text"
              className="answer-input fill-blank"
              value={answers[currentQ._id] || ""}
              onChange={(e) => handleAnswerChange(currentQ._id, e.target.value)}
              placeholder="Fill in the blank"
            />
          )}
        </div>

        <div className="question-actions">
          <button
            onClick={() => goToQuestion(Math.max(0, currentQuestion - 1))}
            disabled={
              currentQuestion === 0 ||
              exam.settings?.allowBackNavigation === false
            }
            className="btn-nav"
          >
            Previous
          </button>

          {currentQuestion < exam.questions.length - 1 ? (
            <button
              onClick={() => goToQuestion(currentQuestion + 1)}
              className="btn-nav btn-next"
            >
              Next
            </button>
          ) : (
            <button
              onClick={() => handleSubmit(false)}
              className="btn-submit"
              disabled={submitting || timeRemaining === 0}
            >
              {submitting ? "Submitting..." : "Submit Exam"}
            </button>
          )}
        </div>
      </div>

      <div className="exam-footer">
        <div className="answered-count">
          Answered:{" "}
          {Object.values(answers).filter((a) => a && a.trim() !== "").length} /{" "}
          {exam.questions.length}
        </div>
        {lastAutoSave && (
          <div className="last-save">
            Saved: {lastAutoSave.toLocaleTimeString()}
          </div>
        )}
      </div>
    </div>
  );
};

export default TakeExam;
