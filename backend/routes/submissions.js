const express = require("express");
const router = express.Router();
const Submission = require("../models/Submission");
const Exam = require("../models/Exam");
const User = require("../models/User");
const Notification = require("../models/Notification");
const verifyFirebaseToken = require("../middleware/auth");
const { submissionLimiter } = require("../middleware/rateLimiter");

// Start an exam (creates in-progress submission)
router.post("/start", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || user.role !== "student") {
      return res.status(403).json({ message: "Only students can start exams" });
    }

    const { examId } = req.body;
    const exam = await Exam.findById(examId);

    if (!exam) {
      return res.status(404).json({ message: "Exam not found" });
    }

    // Check if exam is active
    const now = new Date();
    if (now < exam.scheduledAt) {
      return res.status(400).json({ message: "Exam has not started yet" });
    }
    if (now > exam.endTime) {
      return res.status(400).json({ message: "Exam time has ended" });
    }

    // Check for existing submission
    let submission = await Submission.findOne({
      examId,
      studentId: user._id,
    });

    if (submission) {
      if (submission.status === "submitted") {
        return res
          .status(400)
          .json({ message: "You have already submitted this exam" });
      }
      // Return existing in-progress submission
      return res.json({ submission, message: "Resuming exam" });
    }

    // Calculate max score
    const maxScore = exam.questions.reduce((sum, q) => sum + q.points, 0);

    // Create new submission
    submission = new Submission({
      examId,
      studentId: user._id,
      status: "in_progress",
      maxScore,
      startedAt: new Date(),
      answers: exam.questions.map((q) => ({
        questionId: q._id,
        answer: "",
      })),
    });

    await submission.save();
    res.status(201).json({ submission, message: "Exam started" });
  } catch (error) {
    console.error("Error starting exam:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Auto-save answers
router.post("/auto-save", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || user.role !== "student") {
      return res
        .status(403)
        .json({ message: "Only students can save answers" });
    }

    const { submissionId, answers, tabSwitchCount, fullscreenExitCount } =
      req.body;

    const submission = await Submission.findOne({
      _id: submissionId,
      studentId: user._id,
      status: "in_progress",
    });

    if (!submission) {
      return res
        .status(404)
        .json({ message: "Submission not found or already submitted" });
    }

    // Update answers
    if (answers && Array.isArray(answers)) {
      answers.forEach((newAnswer) => {
        const existingAnswer = submission.answers.find(
          (a) => a.questionId.toString() === newAnswer.questionId,
        );
        if (existingAnswer) {
          existingAnswer.answer = newAnswer.answer;
          existingAnswer.updatedAt = new Date();
        }
      });
    }

    // Update proctoring counts
    if (tabSwitchCount !== undefined) {
      submission.tabSwitchCount = tabSwitchCount;
    }
    if (fullscreenExitCount !== undefined) {
      submission.fullscreenExitCount = fullscreenExitCount;
    }

    submission.lastAutoSave = new Date();
    submission.autoSaveCount += 1;

    await submission.save();
    res.json({ message: "Auto-saved", lastAutoSave: submission.lastAutoSave });
  } catch (error) {
    console.error("Error auto-saving:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Submit an exam (Student only)
router.post("/", submissionLimiter, verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });

    if (!user || user.role !== "student") {
      return res
        .status(403)
        .json({ message: "Only students can submit exams" });
    }

    const {
      examId,
      answers,
      tabSwitchCount,
      fullscreenExitCount,
      submissionId,
    } = req.body;

    const exam = await Exam.findById(examId);

    if (!exam) {
      return res.status(404).json({ message: "Exam not found" });
    }

    // Check if exam time has ended (with grace period of 5 minutes)
    const now = new Date();
    const graceEndTime = new Date(exam.endTime.getTime() + 5 * 60 * 1000);
    if (now > graceEndTime) {
      return res
        .status(400)
        .json({ message: "Exam submission time has ended" });
    }

    // Find or create submission
    let submission;
    if (submissionId) {
      submission = await Submission.findOne({
        _id: submissionId,
        studentId: user._id,
      });
      if (!submission) {
        return res.status(404).json({ message: "Submission not found" });
      }
      if (submission.status === "submitted") {
        return res
          .status(400)
          .json({ message: "You have already submitted this exam" });
      }
    } else {
      // Check if already submitted
      const existingSubmission = await Submission.findOne({
        examId,
        studentId: user._id,
        status: "submitted",
      });
      if (existingSubmission) {
        return res
          .status(400)
          .json({ message: "You have already submitted this exam" });
      }

      // Create new submission if none exists
      submission = new Submission({
        examId,
        studentId: user._id,
        maxScore: exam.questions.reduce((sum, q) => sum + q.points, 0),
      });
    }

    // Calculate score
    let score = 0;
    const processedAnswers = answers.map((answer) => {
      const question = exam.questions.id(answer.questionId);
      if (question) {
        const isCorrect =
          question.correctAnswer.toLowerCase().trim() ===
          (answer.answer || "").toLowerCase().trim();
        if (isCorrect) {
          score += question.points;
        }
      }
      return {
        questionId: answer.questionId,
        answer: answer.answer || "",
        updatedAt: new Date(),
      };
    });

    submission.answers = processedAnswers;
    submission.score = score;
    submission.status = "submitted";
    submission.submittedAt = new Date();
    submission.tabSwitchCount =
      tabSwitchCount || submission.tabSwitchCount || 0;
    submission.fullscreenExitCount =
      fullscreenExitCount || submission.fullscreenExitCount || 0;

    // Flag if too many violations
    if ((tabSwitchCount || 0) > 5 || (fullscreenExitCount || 0) > 3) {
      submission.isFlagged = true;
      submission.flagReason = `High violation count: ${tabSwitchCount} tab switches, ${fullscreenExitCount} fullscreen exits`;
    }

    await submission.save();

    // Update exam statistics
    const allSubmissions = await Submission.find({
      examId,
      status: "submitted",
    });
    const avgScore =
      allSubmissions.length > 0
        ? allSubmissions.reduce((sum, s) => sum + (s.percentage || 0), 0) /
          allSubmissions.length
        : 0;
    await Exam.findByIdAndUpdate(examId, {
      totalSubmissions: allSubmissions.length,
      averageScore: Math.round(avgScore) || 0,
    });

    // Create notification for student
    await Notification.create({
      userId: user._id,
      type: "exam_submitted",
      title: "Exam Submitted",
      message: `Your submission for "${exam.title}" has been received. Score: ${submission.percentage}%`,
      data: { examId, submissionId: submission._id },
      priority: "medium",
    });

    // Notify teacher if submission is flagged
    if (submission.isFlagged) {
      await Notification.create({
        userId: exam.teacherId,
        type: "flagged_submission",
        title: "Flagged Submission",
        message: `A submission for "${exam.title}" has been flagged for review`,
        data: { examId, submissionId: submission._id },
        priority: "high",
      });
    }

    res.status(201).json({
      submission,
      message: "Exam submitted successfully",
      score: submission.score,
      maxScore: submission.maxScore,
      percentage: submission.percentage,
    });
  } catch (error) {
    console.error("Error submitting exam:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get submissions for an exam (Teacher only)
router.get("/exam/:examId", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });

    if (!user || !["teacher", "admin", "proctor"].includes(user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const exam = await Exam.findById(req.params.examId);

    if (!exam) {
      return res.status(404).json({ message: "Exam not found" });
    }

    // Teachers can only see their own exam submissions
    if (
      user.role === "teacher" &&
      exam.teacherId.toString() !== user._id.toString()
    ) {
      return res
        .status(403)
        .json({ message: "You can only view submissions for your own exams" });
    }

    const submissions = await Submission.find({ examId: req.params.examId })
      .populate("studentId", "name email")
      .sort({ submittedAt: -1 });

    // Calculate statistics
    const submittedSubmissions = submissions.filter(
      (s) => s.status === "submitted",
    );
    const stats = {
      total: submissions.length,
      submitted: submittedSubmissions.length,
      inProgress: submissions.filter((s) => s.status === "in_progress").length,
      flagged: submissions.filter((s) => s.isFlagged).length,
      averageScore:
        submittedSubmissions.length > 0
          ? Math.round(
              submittedSubmissions.reduce((sum, s) => sum + s.percentage, 0) /
                submittedSubmissions.length,
            )
          : 0,
      highestScore:
        submittedSubmissions.length > 0
          ? Math.max(...submittedSubmissions.map((s) => s.percentage))
          : 0,
      lowestScore:
        submittedSubmissions.length > 0
          ? Math.min(...submittedSubmissions.map((s) => s.percentage))
          : 0,
    };

    res.json({ submissions, stats });
  } catch (error) {
    console.error("Error getting submissions:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get student's own submissions
router.get("/my-submissions", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const submissions = await Submission.find({
      studentId: user._id,
      status: { $in: ["submitted", "graded"] },
    })
      .populate("examId", "title description duration settings")
      .sort({ submittedAt: -1 })
      .lean();

    // Filter out submissions with deleted exams and sanitize data
    const cleanSubmissions = submissions
      .filter((s) => s.examId != null)
      .map((s) => ({
        ...s,
        percentage: isNaN(s.percentage) ? 0 : s.percentage,
        score: isNaN(s.score) ? 0 : s.score,
      }));

    res.json({ submissions: cleanSubmissions });
  } catch (error) {
    console.error("Error getting submissions:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get single submission details
router.get("/:id", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    const submission = await Submission.findById(req.params.id)
      .populate("studentId", "name email")
      .populate("examId")
      .populate("reviewedBy", "name");

    if (!submission) {
      return res.status(404).json({ message: "Submission not found" });
    }

    // Students can only view their own submissions
    if (
      user.role === "student" &&
      submission.studentId._id.toString() !== user._id.toString()
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Teachers can only view submissions for their exams
    if (
      user.role === "teacher" &&
      submission.examId.teacherId.toString() !== user._id.toString()
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    res.json({ submission });
  } catch (error) {
    console.error("Error getting submission:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Review/Grade submission (Teacher only)
router.put("/:id/review", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || !["teacher", "admin"].includes(user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const { score, reviewNotes, isFlagged, flagReason } = req.body;

    const submission = await Submission.findById(req.params.id).populate(
      "examId",
    );

    if (!submission) {
      return res.status(404).json({ message: "Submission not found" });
    }

    // Teachers can only review their own exam submissions
    if (
      user.role === "teacher" &&
      submission.examId.teacherId.toString() !== user._id.toString()
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    if (score !== undefined) {
      submission.score = score;
    }
    if (reviewNotes) {
      submission.reviewNotes = reviewNotes;
    }
    if (isFlagged !== undefined) {
      submission.isFlagged = isFlagged;
    }
    if (flagReason) {
      submission.flagReason = flagReason;
    }

    submission.reviewedBy = user._id;
    submission.reviewedAt = new Date();
    submission.status = "graded";

    await submission.save();

    // Notify student
    await Notification.create({
      userId: submission.studentId,
      type: "exam_graded",
      title: "Exam Graded",
      message: `Your submission for "${submission.examId.title}" has been reviewed`,
      data: { submissionId: submission._id },
      priority: "medium",
    });

    res.json({ submission, message: "Submission reviewed" });
  } catch (error) {
    console.error("Error reviewing submission:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Unlock a locked submission (Teacher/Admin only)
router.put("/:id/unlock", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user || !["teacher", "admin"].includes(user.role)) {
      return res.status(403).json({ message: "Access denied" });
    }

    const submission = await Submission.findById(req.params.id).populate(
      "examId",
    );

    if (!submission) {
      return res.status(404).json({ message: "Submission not found" });
    }

    if (submission.status !== "locked") {
      return res
        .status(400)
        .json({ message: "Submission is not locked" });
    }

    // Teachers can only unlock submissions for their own exams
    if (
      user.role === "teacher" &&
      submission.examId.teacherId.toString() !== user._id.toString()
    ) {
      return res.status(403).json({ message: "Access denied" });
    }

    // Unlock the submission — set to "submitted" so the teacher can grade it
    submission.status = "submitted";
    submission.lockInfo.unlockedAt = new Date();
    submission.lockInfo.unlockedBy = user._id;

    await submission.save();

    // Notify the student
    await Notification.create({
      userId: submission.studentId,
      type: "exam_graded",
      title: "Exam Unlocked",
      message: `Your locked exam "${submission.examId.title}" has been reviewed by your teacher. You may view your results.`,
      data: {
        examId: submission.examId._id,
        submissionId: submission._id,
      },
      priority: "high",
    });

    res.json({ submission, message: "Submission unlocked successfully" });
  } catch (error) {
    console.error("Error unlocking submission:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
