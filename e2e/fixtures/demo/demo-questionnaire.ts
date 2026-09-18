import { isChoiceQuestion, questionInputOf, type Item, type PublishedDefinition, type Question } from "@qp/shared";
import {
  INTAKE_ITEM_IDS,
  INTAKE_OPTION_IDS,
  INTAKE_QUESTION_IDS,
  INTAKE_QUESTION_ROLES,
  INTAKE_QUESTIONNAIRE_ID,
  intakeDefinition,
  type IntakeOptionId,
  type IntakeQuestionRole,
  type IntakeVersion,
} from "@qp/shared/demo";
import { uniqueName, type DefinitionApi, type Placement, type PublishedQuestionnaire } from "../api/definition-api";

export const DEMO_QUESTIONNAIRE_ID = INTAKE_QUESTIONNAIRE_ID;

export const DEMO_SEEDED_QUESTION_IDS = INTAKE_QUESTION_IDS;

export const DEMO_ITEM_IDS = INTAKE_ITEM_IDS;

export type DemoQuestionRole = IntakeQuestionRole;

export const DEMO_QUESTION_ROLES = INTAKE_QUESTION_ROLES;

export const DEMO_OPTION_IDS = INTAKE_OPTION_IDS;

export type DemoOptionId = IntakeOptionId;

export interface DemoDescription {
  readonly questionnaireId: string;
  readonly version: IntakeVersion;
  readonly title: string;
  readonly definition: PublishedDefinition;
  readonly prompts: Readonly<Record<DemoQuestionRole, string>>;
  readonly optionLabel: (optionId: DemoOptionId) => string;
}

export function demoItem(definition: PublishedDefinition, role: DemoQuestionRole): Item {
  const item = definition.items.find((candidate) => candidate.itemId === DEMO_ITEM_IDS[role]);
  if (item === undefined) throw new Error(`The demo definition has no item ${DEMO_ITEM_IDS[role]}`);
  return item;
}

function optionLabelIn(definition: PublishedDefinition, optionId: DemoOptionId): string {
  for (const item of definition.items) {
    if (!isChoiceQuestion(item.question)) continue;
    const option = item.question.options.find((candidate) => candidate.optionId === optionId);
    if (option !== undefined) return option.label;
  }
  throw new Error(`The demo definition has no option ${optionId}`);
}

function describeDemo(version: IntakeVersion): DemoDescription {
  const definition = intakeDefinition(version);
  const promptOf = (role: DemoQuestionRole) => demoItem(definition, role).question.prompt;
  return {
    questionnaireId: DEMO_QUESTIONNAIRE_ID,
    version,
    title: definition.title,
    definition,
    prompts: {
      hasCondition: promptOf("hasCondition"),
      whichCondition: promptOf("whichCondition"),
      diagnosedOn: promptOf("diagnosedOn"),
      pharmacy: promptOf("pharmacy"),
    },
    optionLabel: (optionId) => optionLabelIn(definition, optionId),
  };
}

export const DEMO_V1 = describeDemo(1);

export const DEMO_V2 = describeDemo(2);

export interface DemoShapedQuestionnaire extends PublishedQuestionnaire {
  readonly questionnaireId: string;
  readonly questions: Readonly<Record<DemoQuestionRole, Question>>;
}

export interface DemoShapedOptions {
  readonly name?: string;
  readonly title?: string;
}

function placementsFor(definition: PublishedDefinition, pin: (role: DemoQuestionRole) => Placement["question"]): Placement[] {
  return DEMO_QUESTION_ROLES.map((role) => {
    const item = demoItem(definition, role);
    return { itemId: item.itemId, question: pin(role), required: item.required, visibleWhen: item.visibleWhen };
  });
}

export async function createDemoShapedQuestionnaire(api: DefinitionApi, options: DemoShapedOptions = {}): Promise<DemoShapedQuestionnaire> {
  const definition = intakeDefinition(1);
  const createFor = (role: DemoQuestionRole) => api.createQuestion(questionInputOf(demoItem(definition, role).question));
  const [hasCondition, whichCondition, diagnosedOn, pharmacy] = await Promise.all(DEMO_QUESTION_ROLES.map(createFor));
  if (hasCondition === undefined || whichCondition === undefined || diagnosedOn === undefined || pharmacy === undefined) {
    throw new Error("Creating the demo-shaped bank questions returned fewer questions than requested");
  }
  const questions = { hasCondition, whichCondition, diagnosedOn, pharmacy };
  const published = await api.createPublishedQuestionnaire(
    { name: options.name ?? uniqueName("E2E demo-shaped"), title: options.title ?? definition.title },
    placementsFor(definition, (role) => questions[role]),
  );
  return { ...published, questionnaireId: published.questionnaire.questionnaireId, questions };
}

export async function publishDemoHypertensionRelabel(api: DefinitionApi, demo: DemoShapedQuestionnaire): Promise<PublishedQuestionnaire> {
  const relabeled = demoItem(intakeDefinition(2), "whichCondition").question;
  const whichCondition = await api.createQuestionVersion(demo.questions.whichCondition.questionId, questionInputOf(relabeled));
  const pin = (role: DemoQuestionRole) => (role === "whichCondition" ? whichCondition : demo.questions[role]);
  return api.publishNextVersion(demo.questionnaireId, placementsFor(demo.definition, pin));
}
