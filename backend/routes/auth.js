const express = require("express");
const router = express.Router();
const crypto = require("crypto");
const User = require("../models/User");
const RegistrationAttempt = require("../models/RegistrationAttempt");
const LoginAttempt = require("../models/LoginAttempt");
const Notification = require("../models/Notification");
const verifyFirebaseToken = require("../middleware/auth");
const { authLimiter } = require("../middleware/rateLimiter");

const MAX_REGISTRATION_ATTEMPTS = 3;
const REGISTRATION_WINDOW_MS = 24 * 60 * 60 * 1000; // 24 hours
const MAX_LOGIN_FAILURES = 5;
const LOGIN_LOCK_DURATION_MS = 15 * 60 * 1000; // 15 minutes
const ADMIN_ALERT_THRESHOLD = 10;
const ADMIN_ALERT_WINDOW_MS = 60 * 60 * 1000; // 1 hour

// Generate 2FA secret
const generate2FASecret = () => {
  return crypto.randomBytes(20).toString("hex");
};

// Generate TOTP code (simplified version)
const generateTOTP = (secret) => {
  const time = Math.floor(Date.now() / 30000);
  const hmac = crypto.createHmac("sha1", secret);
  hmac.update(Buffer.from(time.toString()));
  const hash = hmac.digest("hex");
  const offset = parseInt(hash.slice(-1), 16);
  const code =
    (parseInt(hash.substr(offset * 2, 8), 16) & 0x7fffffff) % 1000000;
  return code.toString().padStart(6, "0");
};

// Register or login user (REQ-18: max 3 registration attempts per email per 24h)
router.post("/register", authLimiter, verifyFirebaseToken, async (req, res) => {
  try {
    const { email, name, role } = req.body;
    const firebaseUid = req.user.uid;

    let user = await User.findOne({ firebaseUid });

    if (user) {
      // Update last login
      user.lastLogin = new Date();
      await user.save();
      return res.json({ user, message: "User already exists" });
    }

    // Check registration attempts for this email
    const windowStart = new Date(Date.now() - REGISTRATION_WINDOW_MS);
    const attemptCount = await RegistrationAttempt.countDocuments({
      email: email.toLowerCase(),
      attemptedAt: { $gte: windowStart },
    });

    if (attemptCount >= MAX_REGISTRATION_ATTEMPTS) {
      // Find the oldest attempt in the window to calculate when it expires
      const oldestAttempt = await RegistrationAttempt.findOne({
        email: email.toLowerCase(),
        attemptedAt: { $gte: windowStart },
      }).sort({ attemptedAt: 1 });

      const retryAfter = new Date(oldestAttempt.attemptedAt.getTime() + REGISTRATION_WINDOW_MS);
      const remainingMs = retryAfter.getTime() - Date.now();

      return res.status(429).json({
        message: "Too many registration attempts. Please try again later.",
        locked: true,
        retryAfter: retryAfter.toISOString(),
        remainingMs,
      });
    }

    // Record this registration attempt
    await RegistrationAttempt.create({ email: email.toLowerCase() });

    // Validate role
    const validRoles = ["student", "teacher", "proctor", "admin"];
    const userRole = validRoles.includes(role) ? role : "student";

    user = new User({
      firebaseUid,
      email,
      name,
      role: userRole,
      lastLogin: new Date(),
    });

    await user.save();

    res.status(201).json({ user, message: "User registered successfully" });
  } catch (error) {
    console.error("Error in register:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Get current user
router.get("/me", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid }).select(
      "-twoFactorSecret",
    );

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Update last login
    user.lastLogin = new Date();
    await user.save();

    res.json({ user });
  } catch (error) {
    console.error("Error in me:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Update user profile
router.put("/profile", verifyFirebaseToken, async (req, res) => {
  try {
    const { name, profileImage, referenceImage } = req.body;

    const updateData = {};
    if (name) updateData.name = name;
    if (profileImage) updateData.profileImage = profileImage;
    if (referenceImage) updateData.referenceImage = referenceImage;

    const user = await User.findOneAndUpdate(
      { firebaseUid: req.user.uid },
      updateData,
      { new: true },
    ).select("-twoFactorSecret");

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({ user, message: "Profile updated" });
  } catch (error) {
    console.error("Error updating profile:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Enable 2FA
router.post("/2fa/enable", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (user.twoFactorEnabled) {
      return res.status(400).json({ message: "2FA is already enabled" });
    }

    // Generate secret
    const secret = generate2FASecret();
    user.twoFactorSecret = secret;
    await user.save();

    // In a real app, you would generate a QR code for authenticator apps
    // For simplicity, we'll return the secret directly
    const currentCode = generateTOTP(secret);

    res.json({
      secret,
      message: "Save this secret in your authenticator app",
      // In production, don't send currentCode - it's for testing only
      currentCode,
    });
  } catch (error) {
    console.error("Error enabling 2FA:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Verify and activate 2FA
router.post("/2fa/verify", verifyFirebaseToken, async (req, res) => {
  try {
    const { code } = req.body;
    const user = await User.findOne({ firebaseUid: req.user.uid });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!user.twoFactorSecret) {
      return res.status(400).json({ message: "Please enable 2FA first" });
    }

    const expectedCode = generateTOTP(user.twoFactorSecret);

    if (code !== expectedCode) {
      return res.status(400).json({ message: "Invalid verification code" });
    }

    user.twoFactorEnabled = true;
    await user.save();

    res.json({ message: "2FA enabled successfully" });
  } catch (error) {
    console.error("Error verifying 2FA:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Validate 2FA code during login
router.post("/2fa/validate", verifyFirebaseToken, async (req, res) => {
  try {
    const { code } = req.body;
    const user = await User.findOne({ firebaseUid: req.user.uid });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!user.twoFactorEnabled) {
      return res.json({ valid: true, message: "2FA not required" });
    }

    const expectedCode = generateTOTP(user.twoFactorSecret);
    const isValid = code === expectedCode;

    if (!isValid) {
      return res
        .status(401)
        .json({ valid: false, message: "Invalid 2FA code" });
    }

    res.json({ valid: true, message: "2FA verified" });
  } catch (error) {
    console.error("Error validating 2FA:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Disable 2FA
router.post("/2fa/disable", verifyFirebaseToken, async (req, res) => {
  try {
    const { code } = req.body;
    const user = await User.findOne({ firebaseUid: req.user.uid });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    if (!user.twoFactorEnabled) {
      return res.status(400).json({ message: "2FA is not enabled" });
    }

    const expectedCode = generateTOTP(user.twoFactorSecret);

    if (code !== expectedCode) {
      return res.status(400).json({ message: "Invalid verification code" });
    }

    user.twoFactorEnabled = false;
    user.twoFactorSecret = undefined;
    await user.save();

    res.json({ message: "2FA disabled successfully" });
  } catch (error) {
    console.error("Error disabling 2FA:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// Check 2FA status
router.get("/2fa/status", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });

    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    res.json({
      enabled: user.twoFactorEnabled,
      required: user.twoFactorEnabled,
    });
  } catch (error) {
    console.error("Error checking 2FA status:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ─── REQ-18: Check registration lock status ─────────────────────────
router.post("/check-registration", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const windowStart = new Date(Date.now() - REGISTRATION_WINDOW_MS);
    const attemptCount = await RegistrationAttempt.countDocuments({
      email: email.toLowerCase(),
      attemptedAt: { $gte: windowStart },
    });

    if (attemptCount >= MAX_REGISTRATION_ATTEMPTS) {
      const oldestAttempt = await RegistrationAttempt.findOne({
        email: email.toLowerCase(),
        attemptedAt: { $gte: windowStart },
      }).sort({ attemptedAt: 1 });

      const retryAfter = new Date(oldestAttempt.attemptedAt.getTime() + REGISTRATION_WINDOW_MS);
      const remainingMs = retryAfter.getTime() - Date.now();

      return res.status(429).json({
        locked: true,
        attemptsUsed: attemptCount,
        maxAttempts: MAX_REGISTRATION_ATTEMPTS,
        retryAfter: retryAfter.toISOString(),
        remainingMs,
        message: "Too many registration attempts. Please try again later.",
      });
    }

    res.json({
      locked: false,
      attemptsUsed: attemptCount,
      maxAttempts: MAX_REGISTRATION_ATTEMPTS,
      remainingAttempts: MAX_REGISTRATION_ATTEMPTS - attemptCount,
    });
  } catch (error) {
    console.error("Error checking registration status:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ─── REQ-19: Check login lock status ────────────────────────────────
router.post("/login-status", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    const user = await User.findOne({ email: email.toLowerCase() });

    if (!user) {
      // Don't reveal whether email exists
      return res.json({ locked: false });
    }

    if (user.accountLockedUntil && user.accountLockedUntil > new Date()) {
      const remainingMs = user.accountLockedUntil.getTime() - Date.now();
      return res.status(423).json({
        locked: true,
        lockedUntil: user.accountLockedUntil.toISOString(),
        remainingMs,
        message: "Account is temporarily locked due to too many failed login attempts.",
      });
    }

    res.json({
      locked: false,
      failedAttempts: user.failedLoginAttempts,
      maxAttempts: MAX_LOGIN_FAILURES,
    });
  } catch (error) {
    console.error("Error checking login status:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ─── REQ-19: Record login failure ───────────────────────────────────
router.post("/login-failure", async (req, res) => {
  try {
    const { email } = req.body;
    if (!email) {
      return res.status(400).json({ message: "Email is required" });
    }

    // Record in LoginAttempt collection (for hourly tracking)
    await LoginAttempt.create({ email: email.toLowerCase(), success: false });

    const user = await User.findOne({ email: email.toLowerCase() });
    if (!user) {
      return res.json({ message: "Failure recorded" });
    }

    // If currently locked, just return lock info
    if (user.accountLockedUntil && user.accountLockedUntil > new Date()) {
      const remainingMs = user.accountLockedUntil.getTime() - Date.now();
      return res.status(423).json({
        locked: true,
        lockedUntil: user.accountLockedUntil.toISOString(),
        remainingMs,
        message: "Account is temporarily locked due to too many failed login attempts.",
      });
    }

    // Increment failure count
    user.failedLoginAttempts = (user.failedLoginAttempts || 0) + 1;

    // Lock after 5 consecutive failures
    if (user.failedLoginAttempts >= MAX_LOGIN_FAILURES) {
      user.accountLockedUntil = new Date(Date.now() + LOGIN_LOCK_DURATION_MS);
      await user.save();

      const remainingMs = user.accountLockedUntil.getTime() - Date.now();
      // Check for persistent failures (>10 in 1 hour) → admin alert
      const hourAgo = new Date(Date.now() - ADMIN_ALERT_WINDOW_MS);
      const hourlyFailures = await LoginAttempt.countDocuments({
        email: email.toLowerCase(),
        success: false,
        attemptedAt: { $gte: hourAgo },
      });

      if (hourlyFailures >= ADMIN_ALERT_THRESHOLD) {
        // Send alert to all admin users
        const admins = await User.find({ role: "admin" });
        const notifications = admins.map((admin) => ({
          userId: admin._id,
          type: "account_update",
          title: "Suspicious Login Activity",
          message: `Account ${email} has had ${hourlyFailures} failed login attempts in the last hour. The account has been temporarily locked.`,
          priority: "urgent",
        }));
        if (notifications.length > 0) {
          await Notification.insertMany(notifications);
        }
      }

      return res.status(423).json({
        locked: true,
        lockedUntil: user.accountLockedUntil.toISOString(),
        remainingMs,
        failedAttempts: user.failedLoginAttempts,
        message: "Account locked for 15 minutes due to too many failed login attempts.",
      });
    }

    await user.save();

    res.json({
      locked: false,
      failedAttempts: user.failedLoginAttempts,
      maxAttempts: MAX_LOGIN_FAILURES,
      remainingAttempts: MAX_LOGIN_FAILURES - user.failedLoginAttempts,
      message: `Login failed. ${MAX_LOGIN_FAILURES - user.failedLoginAttempts} attempt(s) remaining before account lock.`,
    });
  } catch (error) {
    console.error("Error recording login failure:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

// ─── REQ-19: Record login success (reset failure count) ─────────────
router.post("/login-success", verifyFirebaseToken, async (req, res) => {
  try {
    const user = await User.findOne({ firebaseUid: req.user.uid });
    if (!user) {
      return res.status(404).json({ message: "User not found" });
    }

    // Reset failure tracking on successful login
    user.failedLoginAttempts = 0;
    user.accountLockedUntil = null;
    user.lastLogin = new Date();
    await user.save();

    // Record successful login attempt
    await LoginAttempt.create({ email: user.email.toLowerCase(), success: true });

    res.json({ message: "Login success recorded" });
  } catch (error) {
    console.error("Error recording login success:", error);
    res.status(500).json({ message: "Server error", error: error.message });
  }
});

module.exports = router;
