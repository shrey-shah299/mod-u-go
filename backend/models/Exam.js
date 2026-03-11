const mongoose = require("mongoose");

const questionSchema = new mongoose.Schema({
  type: {
    type: String,
    enum: ["mcq", "short_answer", "fill_blank", "true_false", "essay"],
    required: true,
  },
  question: {
    type: String,
    required: true,
  },
  options: [
    {
      type: String,
    },
  ], // For MCQ and true_false
  correctAnswer: {
    type: String,
    required: true,
  },
  points: {
    type: Number,
    default: 1,
  },
  explanation: {
    type: String, // Optional explanation for the answer
  },
  order: {
    type: Number,
    default: 0,
  },
  // Question constraints
  constraints: {
    wordLimit: {
      type: Number,
      default: null, // No limit if null (applicable for essay, short_answer)
    },
    difficultyLevel: {
      type: String,
      enum: ["easy", "medium", "hard"],
      default: "medium",
    },
  },
});

const examSchema = new mongoose.Schema({
  title: {
    type: String,
    required: true,
  },
  description: {
    type: String,
  },
  instructions: {
    type: String,
  },
  teacherId: {
    type: mongoose.Schema.Types.ObjectId,
    ref: "User",
    required: true,
  },
  questions: [questionSchema],
  scheduledAt: {
    type: Date,
    required: true,
  },
  duration: {
    type: Number, // Duration in minutes
    required: true,
  },
  endTime: {
    type: Date,
    required: true,
  },
  isActive: {
    type: Boolean,
    default: true,
  },
  // Exam settings
  settings: {
    shuffleQuestions: {
      type: Boolean,
      default: false,
    },
    shuffleOptions: {
      type: Boolean,
      default: false,
    },
    showResultsImmediately: {
      type: Boolean,
      default: true,
    },
    allowBackNavigation: {
      type: Boolean,
      default: true,
    },
    requireWebcam: {
      type: Boolean,
      default: true,
    },
    requireFullscreen: {
      type: Boolean,
      default: true,
    },
    maxAttempts: {
      type: Number,
      default: 1,
    },
    passingScore: {
      type: Number,
      default: 50, // Percentage
    },
    autoSubmitOnTimeUp: {
      type: Boolean,
      default: true,
    },
  },
  // Access control
  allowedStudents: [
    {
      type: mongoose.Schema.Types.ObjectId,
      ref: "User",
    },
  ],
  isPublic: {
    type: Boolean,
    default: true,
  },
  accessCode: {
    type: String, // Optional access code for exam
  },
  // Statistics
  totalSubmissions: {
    type: Number,
    default: 0,
  },
  averageScore: {
    type: Number,
    default: 0,
  },
  createdAt: {
    type: Date,
    default: Date.now,
  },
  updatedAt: {
    type: Date,
    default: Date.now,
  },
});

// Calculate total points
examSchema.virtual("totalPoints").get(function () {
  return this.questions.reduce((sum, q) => sum + q.points, 0);
});

// Update timestamp on save
examSchema.pre("save", function (next) {
  this.updatedAt = Date.now();
  next();
});

// Include virtuals in JSON
examSchema.set("toJSON", { virtuals: true });
examSchema.set("toObject", { virtuals: true });

module.exports = mongoose.model("Exam", examSchema);
