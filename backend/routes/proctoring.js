const express = require("express");
const router = express.Router();
const ProctoringSession = require("../models/ProctoringSession");
const Submission = require("../models/Submission");
const User = require("../models/User");
const Exam = require("../models/Exam");
const Notification = require("../models/Notification");
const verifyFirebaseToken = require("../middleware/auth");

// Start a proctoring session
router.post("/start", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || user.role !== "student") {
      return res
        .status(403)
        .json({ message: "Only students can start proctoring sessions" });
    }

    const { examId, submissionId, deviceInfo } = req.body;

    // Fetch exam for proctoring window settings (REQ-16)
    const exam = await Exam.findById(examId);
    if (!exam) {
      return res.status(404).json({ message: "Exam not found" });
    }

    // REQ-16: Validate that the current time is within the proctoring window
    const proctoringSettings = exam.settings && exam.settings.proctoringWindow
      ? exam.settings.proctoringWindow
      : {};
    const preBuffer = Math.min(
      15,
      Math.max(0, proctoringSettings.preExamBufferMinutes != null ? proctoringSettings.preExamBufferMinutes : 5)
    );
    const windowStart = new Date(
      new Date(exam.scheduledAt).getTime() - preBuffer * 60 * 1000
    );
    const now = new Date();
    if (now < windowStart) {
      return res.status(403).json({
        message: `Proctoring has not started yet. It begins ${preBuffer} minute(s) before the exam at ${windowStart.toISOString()}.`,
        windowStart,
      });
    }

    // Check if session already exists
    let session = await ProctoringSession.findOne({
      studentId: user._id,
      examId,
      status: "active",
    });

    if (session) {
      return res.json({ session, message: "Existing session found" });
    }

    session = new ProctoringSession({
      submissionId,
      studentId: user._id,
      examId,
      deviceInfo,
      status: "active",
    });

    // REQ-16: Compute and store the proctoring window boundaries
    session.initProctoringWindow(exam);

    await session.save();
    res.status(201).json({ session, message: "Proctoring session started" });
  } catch (error) {
    console.error("Error starting proctoring session:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Log a proctoring event
router.post("/event", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const { sessionId, eventType, severity, details, screenshot } = req.body;

    const session = await ProctoringSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    // Add event
    session.events.push({
      type: eventType,
      severity: severity || "medium",
      details,
      screenshot,
      timestamp: new Date(),
    });

    // Update trust score
    const severityPenalty = { low: 2, medium: 5, high: 10 };
    session.trustScore = Math.max(
      0,
      session.trustScore - (severityPenalty[severity] || 5),
    );

    session.trustScoreHistory.push({
      timestamp: new Date(),
      score: session.trustScore,
      reason: `${eventType}: ${details || "Event recorded"}`,
    });

    // Flag session if trust score drops below threshold
    if (session.trustScore < 50 && session.status !== "flagged") {
      session.status = "flagged";

      // Notify proctors
      const proctors = await User.find({ role: "proctor", isActive: true });
      const notifications = proctors.map((proctor) => ({
        userId: proctor._id,
        type: "proctoring_alert",
        title: "Low Trust Score Alert",
        message: `Student session flagged with trust score: ${session.trustScore}`,
        data: { sessionId: session._id, examId: session.examId },
        priority: "high",
      }));
      await Notification.insertMany(notifications);
    }

    await session.save();

    // Also update submission
    const submissionUpdate = {
      $push: {
        proctoringEvents: {
          type: eventType,
          severity,
          details,
          timestamp: new Date(),
        },
      },
      proctoringScore: session.trustScore,
      $inc: {
        tabSwitchCount: eventType === "tab_switch" ? 1 : 0,
        fullscreenExitCount: eventType === "fullscreen_exit" ? 1 : 0,
      },
    };

    const updatedSubmission = await Submission.findByIdAndUpdate(
      session.submissionId,
      submissionUpdate,
      { new: true },
    );

    // ── Auto-lock check ──────────────────────────────────────────────────
    const MAX_TAB_SWITCHES = 5;
    const MAX_FULLSCREEN_EXITS = 5;
    let locked = false;
    let lockReason = "";

    if (updatedSubmission && updatedSubmission.status !== "locked") {
      if (updatedSubmission.tabSwitchCount >= MAX_TAB_SWITCHES) {
        lockReason = `Exceeded maximum tab switches (${updatedSubmission.tabSwitchCount}/${MAX_TAB_SWITCHES})`;
      } else if (updatedSubmission.fullscreenExitCount >= MAX_FULLSCREEN_EXITS) {
        lockReason = `Exceeded maximum fullscreen exits (${updatedSubmission.fullscreenExitCount}/${MAX_FULLSCREEN_EXITS})`;
      }

      if (lockReason) {
        locked = true;

        // Lock the submission
        updatedSubmission.status = "locked";
        updatedSubmission.isFlagged = true;
        updatedSubmission.flagReason = lockReason;
        updatedSubmission.lockInfo = {
          lockedAt: new Date(),
          lockReason,
          lockedBySystem: true,
        };
        await updatedSubmission.save();

        // Notify the exam's teacher
        const exam = await Exam.findById(session.examId);
        const student = await User.findById(session.studentId);
        if (exam) {
          await Notification.create({
            userId: exam.teacherId,
            type: "exam_locked",
            title: "Exam Auto-Locked",
            message: `${student?.name || "A student"}'s exam "${exam.title}" has been auto-locked: ${lockReason}`,
            data: {
              examId: exam._id,
              submissionId: updatedSubmission._id,
            },
            priority: "urgent",
          });
        }
      }
    }

    res.json({ session, message: "Event logged", locked, lockReason });
  } catch (error) {
    console.error("Error logging proctoring event:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// End proctoring session
router.post("/end", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const { sessionId } = req.body;

    const session = await ProctoringSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    const now = new Date();

    // REQ-16: Compute windowEnd = submittedAt + postSubmissionBufferMinutes
    const postBuffer = session.proctoringWindow && session.proctoringWindow.postSubmissionBufferMinutes != null
      ? session.proctoringWindow.postSubmissionBufferMinutes
      : 2;
    const windowEnd = new Date(now.getTime() + postBuffer * 60 * 1000);

    session.endedAt = now;
    session.status = "ended";
    if (session.proctoringWindow) {
      session.proctoringWindow.windowEnd = windowEnd;
    } else {
      session.proctoringWindow = { windowEnd };
    }

    await session.save();

    res.json({
      session,
      message: "Proctoring session ended",
      proctoringWindow: {
        windowEnd,
        postSubmissionBufferMinutes: postBuffer,
        note: `Proctoring data retained until ${windowEnd.toISOString()} (${postBuffer} min after submission).`,
      },
    });
  } catch (error) {
    console.error("Error ending proctoring session:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get active sessions (for proctors)
router.get("/active", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || !["proctor", "admin", "teacher"].includes(user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const sessions = await ProctoringSession.find({ status: "active" })
      .populate("studentId", "name email")
      .populate("examId", "title")
      .sort({ startedAt: -1 });

    res.json({ sessions });
  } catch (error) {
    console.error("Error fetching active sessions:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get flagged sessions (for proctors)
router.get("/flagged", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || !["proctor", "admin", "teacher"].includes(user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const sessions = await ProctoringSession.find({
      $or: [{ status: "flagged" }, { reviewStatus: "pending" }],
    })
      .populate("studentId", "name email")
      .populate("examId", "title")
      .sort({ startedAt: -1 });

    res.json({ sessions });
  } catch (error) {
    console.error("Error fetching flagged sessions:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get session details
router.get("/:id", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const session = await ProctoringSession.findById(req.params.id)
      .populate("studentId", "name email")
      .populate("examId", "title")
      .populate("reviewedBy", "name");

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    // Students can only view their own sessions
    if (
      user.role === "student" &&
      session.studentId._id.toString() !== user._id.toString()
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    res.json({ session });
  } catch (error) {
    console.error("Error fetching session:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Review session (proctor only)
router.put("/:id/review", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || !["proctor", "admin"].includes(user.role)) {
      return res
        .status(403)
        .json({ message: "Only proctors can review sessions" });
    }

    const { reviewStatus, reviewNotes } = req.body;

    const session = await ProctoringSession.findByIdAndUpdate(
      req.params.id,
      {
        reviewStatus,
        reviewNotes,
        reviewedBy: user._id,
        reviewedAt: new Date(),
      },
      { new: true },
    ).populate("studentId", "name email");

    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    // Update submission if flagged
    if (reviewStatus === "flagged") {
      await Submission.findByIdAndUpdate(session.submissionId, {
        isFlagged: true,
        flagReason: reviewNotes,
        reviewedBy: user._id,
        reviewedAt: new Date(),
      });

      // Notify the student
      await Notification.create({
        userId: session.studentId._id,
        type: "flagged_submission",
        title: "Submission Flagged",
        message: "Your exam submission has been flagged for review.",
        data: { submissionId: session.submissionId },
        priority: "high",
      });
    }

    res.json({ session, message: "Review submitted" });
  } catch (error) {
    console.error("Error reviewing session:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Upload screenshot
router.post("/screenshot", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const { sessionId, image, reason } = req.body;

    const session = await ProctoringSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    session.screenshots.push({
      timestamp: new Date(),
      image,
      reason: reason || "periodic",
    });

    await session.save();
    res.json({ message: "Screenshot uploaded" });
  } catch (error) {
    console.error("Error uploading screenshot:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Log face detection result
router.post("/face-detection", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const { sessionId, facesDetected, screenshot } = req.body;  

    const session = await ProctoringSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    session.faceDetectionResults.push({
      timestamp: new Date(),
      facesDetected,
      screenshot,
    });

    // Log event if faces detected is not 1
    if (facesDetected === 0) {
      session.events.push({
        type: "face_not_detected",
        severity: "high",
        details: "No face detected in frame",
        timestamp: new Date(),
      });
      session.trustScore = Math.max(0, session.trustScore - 10);
    } else if (facesDetected > 1) {
      session.events.push({
        type: "multiple_faces",
        severity: "high",
        details: `${facesDetected} faces detected`,
        timestamp: new Date(),
      });
      session.trustScore = Math.max(0, session.trustScore - 15);
    }

    await session.save();
    res.json({ trustScore: session.trustScore });
  } catch (error) {
    console.error("Error logging face detection:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Camera calibration endpoint
router.post("/:id/calibrate", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || user.role !== "student") {
      return res.status(403).json({ message: "Only students can calibrate" });
    }

    const { id: sessionId } = req.params;
    const calibrationData = req.body;

    const session = await ProctoringSession.findById(sessionId);
    if (!session) {
      return res.status(404).json({ message: "Session not found" });
    }

    // Verify that the student owns this session
    if (session.studentId.toString() !== user._id.toString()) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Store calibration data
    session.calibration = {
      status: calibrationData.status || "calibrated",
      timestamp: new Date(),
      duration: calibrationData.duration || 30,
      framesAnalyzed: calibrationData.framesAnalyzed || 0,
      facesDetected: calibrationData.facesDetected || 0,
      detectionRate: calibrationData.detectionRate || 0,
      thresholds: {
        minFaceDistance: calibrationData.thresholds?.minFaceDistance || 50,
        maxFaceDistance: calibrationData.thresholds?.maxFaceDistance || 150,
        minLighting: calibrationData.thresholds?.minLighting || 50,
        maxLighting: calibrationData.thresholds?.maxLighting || 200,
      },
      environment: {
        lighting: calibrationData.environment?.lighting || {},
        distance: calibrationData.environment?.distance || {},
      },
    };

    // Log calibration event
    session.events.push({
      type: "calibration_completed",
      severity: "low",
      details: `Calibration completed - Detection rate: ${calibrationData.detectionRate}%`,
      timestamp: new Date(),
    });

    await session.save();

    res.json({
      message: "Calibration data saved successfully",
      session,
    });
  } catch (error) {
    console.error("Error calibrating session:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
