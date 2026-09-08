export type IntakeLocale = "en" | "es";

export type IntakeMessage = {
  role: "user" | "assistant";
  content: string;
};

export type IssueCandidate = {
  id: string;
  label: string;
  likelihood: "low" | "medium" | "high";
  reason: string;
  evidenceNeeded: string[];
};

export type IntakeQuestion = {
  id: string;
  prompt: string;
  requiredForSafety: boolean;
};

export type IntakeAssessment = {
  reply: string;
  locale: IntakeLocale;
  issueCandidates: IssueCandidate[];
  questions: IntakeQuestion[];
  safety: {
    level: "normal" | "urgent" | "emergency";
    guidance: string;
  };
  readyToConfirm: boolean;
  uncertaintyWarning?: string;
  assessmentToken?: string;
};

