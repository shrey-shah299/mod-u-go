const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

let mongoServer;

beforeAll(async () => {
  mongoServer = await MongoMemoryServer.create();
  await mongoose.connect(mongoServer.getUri());
});

afterAll(async () => {
  await mongoose.disconnect();
  await mongoServer.stop();
});

afterEach(async () => {
  const collections = mongoose.connection.collections;
  for (const key in collections) {
    await collections[key].deleteMany({});
  }
});

const Exam = require("../models/Exam");
const User = require("../models/User");

// ═══════════════════════════════════════════════════════════════════
// EXAM MODEL TESTS
// ═══════════════════════════════════════════════════════════════════

describe("Exam Model", () => {
  let teacherId;

  beforeEach(async () => {
    const teacher = await User.create({
      firebaseUid: "teacher_uid",
      email: "teacher@test.com",
      name: "Teacher",
      role: "teacher",
    });
    teacherId = teacher._id;
  });

  // ─── OO Checks: Schema structure ─────────────────────────────────
  describe("OO Checks: Schema and subdocuments", () => {
    test("should create an exam with all required fields", async () => {
      const exam = await Exam.create({
        title: "Math Exam",
        teacherId,
        questions: [
          {
            type: "mcq",
            question: "What is 2+2?",
            options: ["3", "4", "5"],
            correctAnswer: "4",
            points: 5,
          },
        ],
        scheduledAt: new Date("2026-04-01T10:00:00Z"),
        duration: 60,
        endTime: new Date("2026-04-01T11:00:00Z"),
      });

      expect(exam.title).toBe("Math Exam");
      expect(exam.teacherId.toString()).toBe(teacherId.toString());
      expect(exam.questions).toHaveLength(1);
      expect(exam.duration).toBe(60);
    });

    test("should apply default settings", async () => {
      const exam = await Exam.create({
        title: "Defaults Exam",
        teacherId,
        questions: [
          {
            type: "true_false",
            question: "Is Earth round?",
            correctAnswer: "True",
          },
        ],
        scheduledAt: new Date(),
        duration: 30,
        endTime: new Date(Date.now() + 30 * 60000),
      });

      expect(exam.settings.shuffleQuestions).toBe(false);
      expect(exam.settings.shuffleOptions).toBe(false);
      expect(exam.settings.showResultsImmediately).toBe(true);
      expect(exam.settings.allowBackNavigation).toBe(true);
      expect(exam.settings.requireWebcam).toBe(true);
      expect(exam.settings.requireFullscreen).toBe(true);
      expect(exam.settings.maxAttempts).toBe(1);
      expect(exam.settings.passingScore).toBe(50);
      expect(exam.settings.autoSubmitOnTimeUp).toBe(true);
    });

  });

  // ─── Logic Checks: Virtual totalPoints ─────────────────────────
  describe("Logic Checks: Virtual totalPoints calculation", () => {
    test("should calculate total points from questions", async () => {
      const exam = await Exam.create({
        title: "Points Exam",
        teacherId,
        questions: [
          { type: "mcq", question: "Q1?", correctAnswer: "A", options: ["A"], points: 10 },
          { type: "mcq", question: "Q2?", correctAnswer: "B", options: ["B"], points: 20 },
          { type: "mcq", question: "Q3?", correctAnswer: "C", options: ["C"], points: 30 },
        ],
        scheduledAt: new Date(),
        duration: 60,
        endTime: new Date(Date.now() + 60 * 60000),
      });

      expect(exam.totalPoints).toBe(60);
    });
  });

  // ─── Error Handling: Required field validation ──────────────────
  describe("Error Handling: Required fields", () => {
    test("should fail without title", async () => {
      await expect(
        Exam.create({
          teacherId,
          questions: [],
          scheduledAt: new Date(),
          duration: 30,
          endTime: new Date(),
        })
      ).rejects.toThrow(mongoose.Error.ValidationError);
    });
  });

  // ─── Boundary Checks ─────────────────────────────────────────────
  describe("Boundary Checks: Edge case values", () => {
    test("should handle an exam with many questions", async () => {
      const questions = Array.from({ length: 100 }, (_, i) => ({
        type: "mcq",
        question: `Question ${i + 1}?`,
        correctAnswer: "A",
        options: ["A", "B", "C", "D"],
        points: 1,
      }));

      const exam = await Exam.create({
        title: "100 Questions",
        teacherId,
        questions,
        scheduledAt: new Date(),
        duration: 180,
        endTime: new Date(Date.now() + 180 * 60000),
      });

      expect(exam.questions).toHaveLength(100);
      expect(exam.totalPoints).toBe(100);
    });
  });
});