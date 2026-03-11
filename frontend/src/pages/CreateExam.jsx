import React, { useState, useEffect } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { useAuth } from "../contexts/AuthContext";
import { examService } from "../services/examService";
import "./CreateExam.css";

const CreateExam = () => {
  const { getAuthToken } = useAuth();
  const navigate = useNavigate();
  const { examId } = useParams();
  const isEditing = !!examId;

  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scheduledAt, setScheduledAt] = useState("");
  const [duration, setDuration] = useState(60);
  const [questions, setQuestions] = useState([
    {
      type: "mcq",
      question: "",
      options: ["", "", "", ""],
      correctAnswer: "",
      points: 1,
      constraints: {
        wordLimit: null,
        difficultyLevel: "medium",
      },
    },
  ]);
  const [settings, setSettings] = useState({
    shuffleQuestions: false,
    shuffleOptions: false,
    showResults: true,
    requireWebcam: false,
    requireFullscreen: false,
    allowBackNavigation: true,
    passingScore: 50,
    maxAttempts: 1,
    autoSubmit: true,
  });
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [loading, setLoading] = useState(isEditing);

  useEffect(() => {
    if (isEditing) {
      fetchExam();
    }
  }, [examId]);

  const fetchExam = async () => {
    try {
      const token = await getAuthToken();
      const data = await examService.getExam(token, examId);
      const exam = data.exam;

      setTitle(exam.title);
      setDescription(exam.description || "");
      setScheduledAt(new Date(exam.scheduledAt).toISOString().slice(0, 16));
      setDuration(exam.duration);
      setQuestions(
        exam.questions.map((q) => ({
          type: q.type,
          question: q.question,
          options: q.options?.length > 0 ? q.options : ["", "", "", ""],
          correctAnswer: q.correctAnswer,
          points: q.points || 1,
          constraints: q.constraints || {
            wordLimit: null,
            difficultyLevel: "medium",
          },
        })),
      );
      if (exam.settings) {
        setSettings({ ...settings, ...exam.settings });
      }
    } catch (error) {
      console.error("Error fetching exam:", error);
      setError("Error loading exam");
    } finally {
      setLoading(false);
    }
  };

  const updateSetting = (key, value) => {
    setSettings({ ...settings, [key]: value });
  };

  const addQuestion = () => {
    setQuestions([
      ...questions,
      {
        type: "mcq",
        question: "",
        options: ["", "", "", ""],
        correctAnswer: "",
        points: 1,
        constraints: {
          wordLimit: null,
          difficultyLevel: "medium",
        },
      },
    ]);
  };

  const removeQuestion = (index) => {
    if (questions.length > 1) {
      setQuestions(questions.filter((_, i) => i !== index));
    }
  };

  const updateQuestion = (index, field, value) => {
    const updatedQuestions = [...questions];
    updatedQuestions[index][field] = value;

    // Reset options if changing from MCQ to other types
    if (field === "type" && value !== "mcq") {
      updatedQuestions[index].options = [];
    } else if (
      field === "type" &&
      value === "mcq" &&
      updatedQuestions[index].options.length === 0
    ) {
      updatedQuestions[index].options = ["", "", "", ""];
    }

    setQuestions(updatedQuestions);
  };

  const updateOption = (qIndex, optIndex, value) => {
    const updatedQuestions = [...questions];
    updatedQuestions[qIndex].options[optIndex] = value;
    setQuestions(updatedQuestions);
  };

  const addOption = (qIndex) => {
    const updatedQuestions = [...questions];
    updatedQuestions[qIndex].options.push("");
    setQuestions(updatedQuestions);
  };

  const removeOption = (qIndex, optIndex) => {
    const updatedQuestions = [...questions];
    if (updatedQuestions[qIndex].options.length > 2) {
      updatedQuestions[qIndex].options.splice(optIndex, 1);
      setQuestions(updatedQuestions);
    }
  };

  const updateConstraint = (index, field, value) => {
    const updatedQuestions = [...questions];
    if (!updatedQuestions[index].constraints) {
      updatedQuestions[index].constraints = {
        wordLimit: null,
        difficultyLevel: "medium",
      };
    }
    updatedQuestions[index].constraints[field] = value;
    setQuestions(updatedQuestions);
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError("");

    // Validation
    if (!title || !scheduledAt || duration <= 0) {
      setError("Please fill in all required fields");
      return;
    }

    for (let i = 0; i < questions.length; i++) {
      const q = questions[i];
      if (!q.question || !q.correctAnswer) {
        setError(
          `Question ${i + 1}: Please fill in question text and correct answer`,
        );
        return;
      }
      if (q.type === "mcq") {
        const filledOptions = q.options.filter((opt) => opt.trim() !== "");
        if (filledOptions.length < 2) {
          setError(`Question ${i + 1}: MCQ must have at least 2 options`);
          return;
        }
        if (!filledOptions.includes(q.correctAnswer)) {
          setError(
            `Question ${i + 1}: Correct answer must be one of the options`,
          );
          return;
        }
      }
    }

    try {
      setSubmitting(true);
      const token = await getAuthToken();

      const examData = {
        title,
        description,
        scheduledAt,
        duration,
        settings,
        questions: questions.map((q) => ({
          type: q.type,
          question: q.question,
          options:
            q.type === "mcq"
              ? q.options.filter((opt) => opt.trim() !== "")
              : [],
          correctAnswer: q.correctAnswer,
          points: q.points,
          constraints: q.constraints || {
            wordLimit: null,
            difficultyLevel: "medium",
          },
        })),
      };

      if (isEditing) {
        await examService.updateExam(token, examId, examData);
        alert("Exam updated successfully!");
      } else {
        await examService.createExam(token, examData);
        alert("Exam created successfully!");
      }
      navigate("/dashboard");
    } catch (error) {
      console.error("Error creating exam:", error);
      setError(
        "Error creating exam: " +
          (error.response?.data?.message || error.message),
      );
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return <div className="loading">Loading exam...</div>;
  }

  return (
    <div className="create-exam">
      <div className="create-exam-header">
        <h1>{isEditing ? "Edit Exam" : "Create New Exam"}</h1>
        <button onClick={() => navigate("/dashboard")} className="btn-back">
          Back to Dashboard
        </button>
      </div>

      {error && <div className="error-message">{error}</div>}

      <form onSubmit={handleSubmit} className="exam-form">
        <div className="form-section">
          <h2>Exam Details</h2>

          <div className="form-group">
            <label>Title *</label>
            <input
              type="text"
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="Enter exam title"
              required
            />
          </div>

          <div className="form-group">
            <label>Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Enter exam description (optional)"
              rows={3}
            />
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Scheduled Date & Time *</label>
              <input
                type="datetime-local"
                value={scheduledAt}
                onChange={(e) => setScheduledAt(e.target.value)}
                required
              />
            </div>

            <div className="form-group">
              <label>Duration (minutes) *</label>
              <input
                type="number"
                value={duration}
                onChange={(e) => setDuration(parseInt(e.target.value) || 0)}
                min="1"
                required
              />
            </div>
          </div>
        </div>

        {/* Exam Settings Section */}
        <div className="form-section">
          <h2>Exam Settings</h2>

          <div className="settings-grid">
            <div className="setting-item">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.requireWebcam}
                  onChange={(e) =>
                    updateSetting("requireWebcam", e.target.checked)
                  }
                />
                <span>Require Webcam (Proctoring)</span>
              </label>
              <p className="setting-description">
                Enable webcam monitoring during the exam
              </p>
            </div>

            <div className="setting-item">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.requireFullscreen}
                  onChange={(e) =>
                    updateSetting("requireFullscreen", e.target.checked)
                  }
                />
                <span>Require Fullscreen</span>
              </label>
              <p className="setting-description">
                Exam must be taken in fullscreen mode
              </p>
            </div>

            <div className="setting-item">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.shuffleQuestions}
                  onChange={(e) =>
                    updateSetting("shuffleQuestions", e.target.checked)
                  }
                />
                <span>Shuffle Questions</span>
              </label>
              <p className="setting-description">
                Randomize the order of questions
              </p>
            </div>

            <div className="setting-item">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.shuffleOptions}
                  onChange={(e) =>
                    updateSetting("shuffleOptions", e.target.checked)
                  }
                />
                <span>Shuffle Options</span>
              </label>
              <p className="setting-description">
                Randomize the order of MCQ options
              </p>
            </div>

            <div className="setting-item">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.allowBackNavigation}
                  onChange={(e) =>
                    updateSetting("allowBackNavigation", e.target.checked)
                  }
                />
                <span>Allow Back Navigation</span>
              </label>
              <p className="setting-description">
                Allow students to go back to previous questions
              </p>
            </div>

            <div className="setting-item">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.showResults}
                  onChange={(e) =>
                    updateSetting("showResults", e.target.checked)
                  }
                />
                <span>Show Results</span>
              </label>
              <p className="setting-description">
                Show results immediately after submission
              </p>
            </div>

            <div className="setting-item">
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  checked={settings.autoSubmit}
                  onChange={(e) =>
                    updateSetting("autoSubmit", e.target.checked)
                  }
                />
                <span>Auto Submit</span>
              </label>
              <p className="setting-description">
                Automatically submit when time expires
              </p>
            </div>
          </div>

          <div className="form-row">
            <div className="form-group">
              <label>Passing Score (%)</label>
              <input
                type="number"
                value={settings.passingScore}
                onChange={(e) =>
                  updateSetting("passingScore", parseInt(e.target.value) || 0)
                }
                min="0"
                max="100"
              />
            </div>

            <div className="form-group">
              <label>Max Attempts</label>
              <input
                type="number"
                value={settings.maxAttempts}
                onChange={(e) =>
                  updateSetting("maxAttempts", parseInt(e.target.value) || 1)
                }
                min="1"
              />
            </div>
          </div>
        </div>

        <div className="form-section">
          <div className="section-header">
            <h2>Questions</h2>
            <button type="button" onClick={addQuestion} className="btn-add">
              + Add Question
            </button>
          </div>

          {questions.map((question, qIndex) => (
            <div key={qIndex} className="question-builder">
              <div className="question-header">
                <h3>Question {qIndex + 1}</h3>
                <button
                  type="button"
                  onClick={() => removeQuestion(qIndex)}
                  className="btn-remove"
                  disabled={questions.length === 1}
                >
                  Remove
                </button>
              </div>

              <div className="form-row">
                <div className="form-group" style={{ flex: 2 }}>
                  <label>Question Type</label>
                  <select
                    value={question.type}
                    onChange={(e) =>
                      updateQuestion(qIndex, "type", e.target.value)
                    }
                  >
                    <option value="mcq">Multiple Choice</option>
                    <option value="short_answer">Short Answer</option>
                    <option value="fill_blank">Fill in the Blank</option>
                  </select>
                </div>

                <div className="form-group" style={{ flex: 1 }}>
                  <label>Points (Marks)</label>
                  <input
                    type="number"
                    value={question.points}
                    onChange={(e) =>
                      updateQuestion(
                        qIndex,
                        "points",
                        parseInt(e.target.value) || 1,
                      )
                    }
                    min="1"
                  />
                </div>

                <div className="form-group" style={{ flex: 1 }}>
                  <label>Difficulty Level</label>
                  <select
                    value={question.constraints?.difficultyLevel || "medium"}
                    onChange={(e) =>
                      updateConstraint(qIndex, "difficultyLevel", e.target.value)
                    }
                  >
                    <option value="easy">Easy</option>
                    <option value="medium">Medium</option>
                    <option value="hard">Hard</option>
                  </select>
                </div>
              </div>

              {(question.type === "short_answer" || question.type === "essay") && (
                <div className="form-group">
                  <label>Word Limit (Optional)</label>
                  <input
                    type="number"
                    value={question.constraints?.wordLimit || ""}
                    onChange={(e) =>
                      updateConstraint(
                        qIndex,
                        "wordLimit",
                        e.target.value ? parseInt(e.target.value) : null,
                      )
                    }
                    placeholder="Leave empty for no limit"
                    min="1"
                  />
                </div>
              )}

              <div className="form-group">
                <label>Question Text *</label>
                <textarea
                  value={question.question}
                  onChange={(e) =>
                    updateQuestion(qIndex, "question", e.target.value)
                  }
                  placeholder="Enter your question"
                  rows={3}
                  required
                />
              </div>

              {question.type === "mcq" && (
                <div className="mcq-builder">
                  <label>Options *</label>
                  {question.options.map((option, optIndex) => (
                    <div key={optIndex} className="option-input">
                      <input
                        type="text"
                        value={option}
                        onChange={(e) =>
                          updateOption(qIndex, optIndex, e.target.value)
                        }
                        placeholder={`Option ${optIndex + 1}`}
                      />
                      <button
                        type="button"
                        onClick={() => removeOption(qIndex, optIndex)}
                        className="btn-remove-small"
                        disabled={question.options.length <= 2}
                      >
                        x
                      </button>
                    </div>
                  ))}
                  <button
                    type="button"
                    onClick={() => addOption(qIndex)}
                    className="btn-add-small"
                  >
                    + Add Option
                  </button>
                </div>
              )}

              <div className="form-group">
                <label>Correct Answer *</label>
                {question.type === "mcq" ? (
                  <select
                    value={question.correctAnswer}
                    onChange={(e) =>
                      updateQuestion(qIndex, "correctAnswer", e.target.value)
                    }
                    required
                  >
                    <option value="">Select correct answer</option>
                    {question.options
                      .filter((opt) => opt.trim() !== "")
                      .map((option, optIndex) => (
                        <option key={optIndex} value={option}>
                          {option}
                        </option>
                      ))}
                  </select>
                ) : (
                  <input
                    type="text"
                    value={question.correctAnswer}
                    onChange={(e) =>
                      updateQuestion(qIndex, "correctAnswer", e.target.value)
                    }
                    placeholder="Enter the correct answer"
                    required
                  />
                )}
              </div>
            </div>
          ))}
        </div>

        <div className="form-actions">
          <button type="submit" className="btn-submit" disabled={submitting}>
            {submitting
              ? isEditing
                ? "Updating..."
                : "Creating..."
              : isEditing
                ? "Update Exam"
                : "Create Exam"}
          </button>
          <button
            type="button"
            onClick={() => navigate("/dashboard")}
            className="btn-cancel"
          >
            Cancel
          </button>
        </div>
      </form>
    </div>
  );
};

export default CreateExam;
