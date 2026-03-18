const mongoose = require("mongoose");
const { MongoMemoryServer } = require("mongodb-memory-server");

let mongoServer;

// ─── Test Setup ─────────────────────────────────────────────────────
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

const User = require("../models/User");

// ═══════════════════════════════════════════════════════════════════
// USER MODEL TESTS
// ═══════════════════════════════════════════════════════════════════

describe("User Model", () => {
  // ─── Object-Oriented Checks: Schema & Defaults ──────────────────
  describe("OO Checks: Schema structure and defaults", () => {
    test("should create a user with all required fields", async () => {
      const user = await User.create({
        firebaseUid: "uid_001",
        email: "student@test.com",
        name: "Test Student",
      });

      expect(user).toBeDefined();
      expect(user._id).toBeDefined();
      expect(user.firebaseUid).toBe("uid_001");
      expect(user.email).toBe("student@test.com");
      expect(user.name).toBe("Test Student");
    });

    test("should reject an invalid role via enum validation", async () => {
      await expect(
        User.create({
          firebaseUid: "uid_bad_role",
          email: "badrole@test.com",
          name: "Bad Role",
          role: "superadmin",
        })
      ).rejects.toThrow(mongoose.Error.ValidationError);
    });
  });

  // ─── Error Handling: Required fields ────────────────────────────
  describe("Error Handling: Missing required fields", () => {
    test("should fail when firebaseUid is missing", async () => {
      await expect(
        User.create({ email: "no-uid@test.com", name: "No UID" })
      ).rejects.toThrow(mongoose.Error.ValidationError);
    });
  });

  // ─── Error Handling: Unique constraints ─────────────────────────
  describe("Error Handling: Unique constraints", () => {
    test("should reject duplicate email", async () => {
      await User.create({
        firebaseUid: "uid_a",
        email: "dup@test.com",
        name: "First",
      });

      await expect(
        User.create({
          firebaseUid: "uid_b",
          email: "dup@test.com",
          name: "Second",
        })
      ).rejects.toThrow();
    });
  });

  // ─── Logic Checks: Pre-save hook ───────────────────────────────
  describe("Logic Checks: Pre-save hook updates updatedAt", () => {
    test("should update updatedAt on save", async () => {
      const user = await User.create({
        firebaseUid: "uid_ts",
        email: "ts@test.com",
        name: "Timestamp",
      });

      const initialUpdatedAt = user.updatedAt;

      // Wait a small amount and save again
      await new Promise((r) => setTimeout(r, 50));
      user.name = "Updated Name";
      await user.save();

      expect(user.updatedAt.getTime()).toBeGreaterThanOrEqual(
        initialUpdatedAt.getTime()
      );
    });
  });
});
