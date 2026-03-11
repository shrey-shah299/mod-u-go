import React, { useState, useEffect, useRef, useCallback } from "react";
import { useParams, useNavigate } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { examService } from "../services/examService";
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
  const [lastAutoSave, setLastAutoSave] = useState(null);
  const [autoSaveStatus, setAutoSaveStatus] = useState("");
  const [webcamEnabled, setWebcamEnabled] = useState(false);
  const [trustScore, setTrustScore] = useState(100);
  const [showInstructions, setShowInstructions] = useState(true);
  const [currentQuestion, setCurrentQuestion] = useState(0);

  const videoRef = useRef(null);
  const canvasRef = useRef(null);
  const autoSaveIntervalRef = useRef(null);
  const webcamIntervalRef = useRef(null);
  const examRef = useRef(null);
  const submittingRef = useRef(false);

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

      if (exam.settings?.requireWebcam !== false) {
        await startProctoring(token, exam._id, submissionData.submission._id);
      }

      if (exam.settings?.requireFullscreen !== false) {
        requestFullscreen();
      }

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

      await startWebcam();

      webcamIntervalRef.current = setInterval(() => {
        captureAndUploadScreenshot();
      }, 60000);
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

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        setWebcamEnabled(true);
      }
    } catch (error) {
      console.error("Error starting webcam:", error);
      logProctoringEvent("webcam_disabled", "high", "Failed to access webcam");
    }
  };

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
    if (!proctoringSession) return;

    try {
      const token = await getAuthToken();
      const response = await examService.logProctoringEvent(
        token,
        proctoringSession._id,
        eventType,
        severity,
        details,
      );
      if (response.session?.trustScore !== undefined) {
        setTrustScore(response.session.trustScore);
      }
    } catch (error) {
      console.error("Error logging proctoring event:", error);
    }
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

    if (!isCurrentlyFullscreen && examRef.current && !submittingRef.current) {
      setFullscreenExitCount((prev) => {
        const newCount = prev + 1;
        logProctoringEvent(
          "fullscreen_exit",
          "high",
          `Exited fullscreen (count: ${newCount})`,
        );
        return newCount;
      });
      alert(
        "Warning: You exited fullscreen mode. This action has been recorded.",
      );
      setTimeout(() => requestFullscreen(), 500);
    }
  }, []);

  const handleVisibilityChange = useCallback(() => {
    if (document.hidden && examRef.current && !submittingRef.current) {
      setTabSwitchCount((prev) => {
        const newCount = prev + 1;
        logProctoringEvent(
          "tab_switch",
          "high",
          `Tab switched (count: ${newCount})`,
        );
        return newCount;
      });
    }
  }, []);

  const handleBlur = useCallback(() => {
    if (examRef.current && !submittingRef.current) {
      logProctoringEvent("focus_lost", "medium", "Window lost focus");
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

  const handleKeyDown = useCallback((e) => {
    if (!examRef.current) return;

    if (
      (e.ctrlKey || e.metaKey) &&
      ["c", "v", "p"].includes(e.key.toLowerCase())
    ) {
      e.preventDefault();
      logProctoringEvent(
        "keyboard_shortcut",
        "medium",
        `Blocked shortcut: Ctrl+${e.key}`,
      );
    }
    if (e.key === "F12" || (e.ctrlKey && e.shiftKey && e.key === "I")) {
      e.preventDefault();
      logProctoringEvent(
        "dev_tools_opened",
        "high",
        "Attempted to open dev tools",
      );
    }
  }, []);

  const setupMonitoring = () => {
    document.addEventListener("fullscreenchange", handleFullscreenChange);
    document.addEventListener("webkitfullscreenchange", handleFullscreenChange);
    document.addEventListener("visibilitychange", handleVisibilityChange);
    document.addEventListener("copy", handleCopyPaste);
    document.addEventListener("paste", handleCopyPaste);
    document.addEventListener("cut", handleCopyPaste);
    document.addEventListener("contextmenu", handleContextMenu);
    document.addEventListener("keydown", handleKeyDown);
    window.addEventListener("blur", handleBlur);
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
    document.removeEventListener("keydown", handleKeyDown);
    window.removeEventListener("blur", handleBlur);
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

    if (videoRef.current && videoRef.current.srcObject) {
      videoRef.current.srcObject.getTracks().forEach((track) => track.stop());
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

      cleanup();

      alert(
        `Exam submitted successfully!\nScore: ${result.score}/${result.maxScore} (${result.percentage}%)`,
      );
      navigate("/my-submissions");
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
            <span className={trustScore < 50 ? "score-warning" : ""}>
              {trustScore}%
            </span>
          </div>
        </div>
      </div>

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
