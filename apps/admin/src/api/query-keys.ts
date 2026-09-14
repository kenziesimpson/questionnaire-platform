export const queryKeys = {
  questionnaires: {
    all: ["questionnaires"] as const,
    list: () => ["questionnaires", "list"] as const,
    one: (questionnaireId: string) => ["questionnaires", questionnaireId] as const,
    draft: (questionnaireId: string) => ["questionnaires", questionnaireId, "draft"] as const,
    draftValidation: (questionnaireId: string) => ["questionnaires", questionnaireId, "draft", "validation"] as const,
    versions: (questionnaireId: string) => ["questionnaires", questionnaireId, "versions"] as const,
    version: (questionnaireId: string, version: number) =>
      ["questionnaires", questionnaireId, "versions", version] as const,
  },
  questions: {
    all: ["questions"] as const,
    list: (includeArchived: boolean) => ["questions", "list", { includeArchived }] as const,
    one: (questionId: string) => ["questions", questionId] as const,
    versions: (questionId: string) => ["questions", questionId, "versions"] as const,
    version: (questionId: string, version: number) => ["questions", questionId, "versions", version] as const,
    usage: (questionId: string) => ["questions", questionId, "usage"] as const,
  },
};

export const draftWriteScope = (questionnaireId: string) => `draft-write:${questionnaireId}`;
