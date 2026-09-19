export const queryKeys = {
  questionnaires: {
    list: () => ["questionnaires", "list"] as const,
    draft: (questionnaireId: string) => ["questionnaires", questionnaireId, "draft"] as const,
    draftValidation: (questionnaireId: string) => ["questionnaires", questionnaireId, "draft", "validation"] as const,
    versions: (questionnaireId: string) => ["questionnaires", questionnaireId, "versions"] as const,
    version: (questionnaireId: string, version: number) =>
      ["questionnaires", questionnaireId, "versions", version] as const,
  },
  questions: {
    all: ["questions"] as const,
    list: (includeArchived: boolean) => ["questions", "list", { includeArchived }] as const,
    usage: (questionId: string) => ["questions", questionId, "usage"] as const,
  },
  responses: {
    list: (questionnaireId: string, filters: { version?: number; status?: string }, cursor?: string) =>
      ["responses", questionnaireId, "list", filters, cursor ?? null] as const,
    session: (questionnaireId: string, sessionId: string) => ["responses", questionnaireId, "session", sessionId] as const,
  },
};

export const draftWriteScope = (questionnaireId: string) => `draft-write:${questionnaireId}`;
