export const ITEM_ERROR_MESSAGES = {
  required: "Answer this question.",
  notInFuture: "Enter a date that is not in the future.",
  otherTextRequired: (otherLabel: string) => `Enter your answer for "${otherLabel}".`,
  textTooLong: (maxLength: number) => `Enter no more than ${maxLength} characters.`,
  tooFewChoices: (minSelections: number) => `Choose at least ${minSelections} options.`,
  tooManyChoices: (maxSelections: number) => `Choose no more than ${maxSelections} options.`,
  notWholeNumber: "Enter a whole number.",
  numberBetween: (min: string, max: string) => `Enter a number between ${min} and ${max}.`,
  dateBetween: (min: string, max: string) => `Enter a date between ${min} and ${max}.`,
} as const;

export const ERROR_SUMMARY_TITLES = {
  oneAnswer: "1 answer needs attention",
  answers: (count: number) => `${count} answers need attention`,
  unplaced: "Your answers could not be submitted",
} as const;

export const UNPLACED_ERRORS_MESSAGE = "Some answers could not be accepted. Check your answers and submit again.";

export const SUBMIT_FAILED_MESSAGE = "Your answers were not submitted.";

export const ALREADY_SUBMITTED_NOTE = /This form had already been submitted, perhaps in another tab or window/;

export const RETRY_PENDING_LABEL = "Trying again…";
