const mongoose = require("mongoose");

const answerSchema = new mongoose.Schema({
  questionId: {
    type: mongoose.Schema.Types.ObjectId,
    required: true,
  },
  answer: {
    type: String,
    default: "",
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

const proctoringEventSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: [
      "tab_switch",
      "fullscreen_exit",
      "face_not_detected",
      "multiple_faces",
      "audio_detected",
      "copy_paste",
      "right_click",
      "suspicious_movement",
      "browser_resize",
      "dev_tools_opened",
    ],
    required: true,
  },
  timestamp: {
    type: Date,
    default: Date.now,
  },
  severity: {
    type: String,
    enum: ["low", "medium", "high"],
    default: "medium",
  },
  details: {
    type: String,
  },
  screenshot: {
    type: String, // Base64 encoded screenshot
  },
});

const submissionSchema = new mongoose.Schema({
  examId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "Exam",
    required: true,
  },
  studentId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  answers: [answerSchema],
  score: {
    type: Number,
    default: 0,
  },
  maxScore: {
    type: Number,
    default: 0,
  },
  percentage: {
    type: Number,
    default: 0,
  },
  status: {
    type: String,
    enum: ["in_progress", "submitted", "graded", "flagged"],
    default: "in_progress",
  },
  startedAt: {
    type: Date,
    default: Date.now,
  },
  submittedAt: {
    type: Date,
  },
  // Proctoring data
  tabSwitchCount: {
    type: Number,
    default: 0,
  },
  fullscreenExitCount: {
    type: Number,
    default: 0,
  },
  proctoringEvents: [proctoringEventSchema],
  proctoringScore: {
    type: Number,
    default: 100, // Trust score starts at 100
  },
  // Webcam snapshots during exam
  webcamSnapshots: [
    {
      timestamp: Date,
      image: String, // Base64 encoded
    },
  ],
  // Auto-save tracking
  lastAutoSave: {
    type: Date,
  },
  autoSaveCount: {
    type: Number,
    default: 0,
  },
  // Review by proctor
  reviewedBy: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
  },
  reviewedAt: {
    type: Date,
  },
  reviewNotes: {
    type: String,
  },
  isFlagged: {
    type: Boolean,
    default: false,
  },
  flagReason: {
    type: String,
  },
});

// Calculate percentage before saving
submissionSchema.pre("save", function (next) {
  if (this.maxScore > 0) {
    this.percentage = Math.round((this.score / this.maxScore) * 100);
  } else {
    this.percentage = 0;
  }
  // Guard against NaN
  if (isNaN(this.percentage)) {
    this.percentage = 0;
  }
  if (isNaN(this.score)) {
    this.score = 0;
  }
  next();
});

module.exports = mongoose.model("Submission", submissionSchema);
