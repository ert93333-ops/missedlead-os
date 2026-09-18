/**
 * 인테이크 채팅의 공유 타입: 메시지, 후보 이슈, 안전 질문, 평가 결과, 확인 페이로드.
 */
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
  materialsHint?: string[];
  uncertaintyWarning?: string;
  assessmentToken?: string;
};

