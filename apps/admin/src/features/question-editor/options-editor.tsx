import type { UniqueIdentifier } from "@dnd-kit/core";
import { arrayMove, verticalListSortingStrategy } from "@dnd-kit/sortable";
import { OTHER_OPTION_ID } from "@qp/shared";
import { Button } from "@qp/ui/primitives/button";
import { Checkbox } from "@qp/ui/primitives/checkbox";
import { Input } from "@qp/ui/primitives/input";
import { useId, useState, type ReactNode } from "react";
import { describedByFor, errorIdFor, FieldMessages } from "../../components/field";
import { GripIcon, LockIcon, PlusIcon, RemoveIcon } from "../../components/icons";
import { Pill } from "../../components/pill";
import { SortableList, SortableRow, useSortableList } from "../../components/sortable-list";
import { optionPointer, type FieldErrors } from "./field-errors";
import { addOption, edits } from "./form-edits";
import type { EditableOption, QuestionForm } from "./form-state";

interface OptionsEditorProps {
  form: QuestionForm;
  errors: FieldErrors;
  onChange: (form: QuestionForm) => void;
  onDraggingChange: (dragging: boolean) => void;
}

function OptionIdChip({ optionId, id }: { optionId: string; id: string }) {
  return (
    <span
      id={id}
      className="inline-flex h-6 min-w-30 shrink-0 items-center gap-1.5 rounded-md border border-border bg-muted px-2 font-mono text-[11px] text-muted-foreground"
    >
      <LockIcon size={10} />
      <span className="sr-only">Option id </span>
      {optionId}
    </span>
  );
}

const nameOf = ({ optionId, label }: EditableOption) => (label.trim() === "" ? optionId : label.trim());

interface RowProps {
  option: EditableOption;
  errors: FieldErrors;
  pointer: string;
  onLabel: (label: string) => void;
  onRemove?: () => void;
  canRemove: boolean;
  autoFocus: boolean;
  handle: ReactNode;
  badge?: ReactNode;
}

function OptionRowContent({ option, errors, pointer, onLabel, onRemove, canRemove, autoFocus, handle, badge }: RowProps) {
  const id = useId();
  const chipId = `${id}-id`;
  const errorId = errorIdFor(id);
  return (
    <>
      <div className="flex items-center gap-2.5">
        {handle}
        <OptionIdChip optionId={option.optionId} id={chipId} />
        <Input
          aria-label={`Label for ${option.optionId}`}
          aria-describedby={describedByFor(errors, pointer, errorId, chipId)}
          aria-invalid={errors[pointer] !== undefined || undefined}
          value={option.label}
          placeholder="Option label"
          autoFocus={autoFocus}
          onChange={(event) => onLabel(event.target.value)}
        />
        {badge}
        {onRemove !== undefined && (
          <Button
            type="button"
            variant="outline"
            size="icon-sm"
            aria-label={`Remove option ${nameOf(option)}`}
            disabled={!canRemove}
            onClick={onRemove}
          >
            <RemoveIcon />
          </Button>
        )}
      </div>
      <FieldMessages id={errorId} messages={errors[pointer]} />
    </>
  );
}

function SortableOptionRow(props: Omit<RowProps, "handle">) {
  return (
    <SortableRow id={props.option.optionId}>
      {({ setNodeRef, setActivatorNodeRef, attributes, listeners, style, isDragging }) => (
        <li
          ref={setNodeRef}
          data-option-id={props.option.optionId}
          style={style}
          className={`flex flex-col gap-1 rounded-lg ${isDragging ? "relative z-10 bg-background shadow-md ring-1 ring-foreground/10" : ""}`}
        >
          <OptionRowContent
            {...props}
            handle={
              <button
                type="button"
                ref={setActivatorNodeRef}
                aria-label={`Reorder option ${nameOf(props.option)}`}
                className="inline-flex size-7 shrink-0 cursor-grab touch-none items-center justify-center rounded-md text-muted-foreground/70 outline-none hover:bg-muted focus-visible:ring-3 focus-visible:ring-ring/50 active:cursor-grabbing"
                {...attributes}
                {...listeners}
              >
                <GripIcon />
              </button>
            }
          />
        </li>
      )}
    </SortableRow>
  );
}

function positionOf(options: readonly EditableOption[], id: UniqueIdentifier | undefined) {
  return options.findIndex(({ optionId }) => optionId === id) + 1;
}

function YesNoOptions({ form, errors, onChange }: Omit<OptionsEditorProps, "onDraggingChange">) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-2">
      <legend className="mb-2 text-sm font-medium">Options</legend>
      <ul aria-label="Options, in order" className="flex flex-col gap-2">
        {form.options.map((option, index) => (
          <li key={option.optionId} data-option-id={option.optionId} className="flex flex-col gap-1">
            <OptionRowContent
              option={option}
              errors={errors}
              pointer={optionPointer(index)}
              onLabel={(label) => onChange(edits.optionLabel(form, option.optionId, label))}
              canRemove={false}
              autoFocus={false}
              handle={null}
            />
          </li>
        ))}
      </ul>
      <p className="text-xs leading-normal text-muted-foreground">
        A yes / no question always has exactly these two options. Relabel them to read True / False or Agree / Disagree.
      </p>
    </fieldset>
  );
}

export function OptionsEditor({ form, errors, onChange, onDraggingChange }: OptionsEditorProps) {
  if (form.yesNo) return <YesNoOptions form={form} errors={errors} onChange={onChange} />;
  return <EditableOptions form={form} errors={errors} onChange={onChange} onDraggingChange={onDraggingChange} />;
}

function EditableOptions({ form, errors, onChange, onDraggingChange }: OptionsEditorProps) {
  const [lastAdded, setLastAdded] = useState<string | null>(null);
  const checkboxId = useId();
  const listErrorId = errorIdFor(useId());
  const { options } = form;
  const onlyOneOption = options.length + (form.otherEnabled ? 1 : 0) <= 1;

  const relabel = (optionId: string, label: string) => onChange(edits.optionLabel(form, optionId, label));

  const remove = (optionId: string) =>
    onChange(edits.options(form, options.filter((option) => option.optionId !== optionId)));

  const controls = useSortableList({
    noun: "option",
    total: options.length,
    nameOf: (id) => {
      const option = options.find(({ optionId }) => optionId === id);
      return option === undefined ? String(id) : nameOf(option);
    },
    positionOf: (id) => positionOf(options, id),
    onDragStart: () => onDraggingChange(true),
    onDragCancel: () => onDraggingChange(false),
    onDragEnd: ({ active, over }) => {
      onDraggingChange(false);
      if (over === null || active.id === over.id) return;
      const from = positionOf(options, active.id) - 1;
      const to = positionOf(options, over.id) - 1;
      onChange(edits.options(form, arrayMove(options, from, to)));
    },
  });

  const other: EditableOption = { optionId: OTHER_OPTION_ID, label: form.otherLabel };

  return (
    <fieldset className="flex min-w-0 flex-col gap-2" aria-describedby={describedByFor(errors, "/options", listErrorId)}>
      <legend className="mb-2 text-sm font-medium">Options</legend>
      <SortableList ids={options.map(({ optionId }) => optionId)} controls={controls} strategy={verticalListSortingStrategy}>
        <ul aria-label="Options, in order" className="flex flex-col gap-2">
          {options.map((option, index) => (
            <SortableOptionRow
              key={option.optionId}
              option={option}
              errors={errors}
              pointer={optionPointer(index)}
              onLabel={(label) => relabel(option.optionId, label)}
              onRemove={() => remove(option.optionId)}
              canRemove={!onlyOneOption}
              autoFocus={option.optionId === lastAdded}
            />
          ))}
        </ul>
      </SortableList>
      {form.otherEnabled && (
        <div data-option-id={OTHER_OPTION_ID} className="flex flex-col gap-1">
          <OptionRowContent
            option={other}
            errors={errors}
            pointer={optionPointer(options.length)}
            onLabel={(otherLabel) => onChange(edits.otherLabel(form, otherLabel))}
            onRemove={() => onChange(edits.otherEnabled(form, false))}
            canRemove={!onlyOneOption}
            autoFocus={false}
            handle={<span className="inline-flex size-7 shrink-0" />}
            badge={<Pill className="text-muted-foreground">Freeform</Pill>}
          />
        </div>
      )}
      <FieldMessages id={listErrorId} messages={errors["/options"]} />
      <div className="flex flex-wrap items-center justify-between gap-3 pt-0.5">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={() => {
            const { form: next, added } = addOption(form);
            setLastAdded(added);
            onChange(next);
          }}
        >
          <PlusIcon />
          Add option
        </Button>
        <span className="text-right text-xs leading-normal text-muted-foreground">
          Ids are set once and never change. Relabelling is safe — answers already collected keep their meaning.
        </span>
      </div>
      <div className="flex items-center gap-2 pt-1">
        <Checkbox
          id={checkboxId}
          checked={form.otherEnabled}
          onCheckedChange={(checked) => onChange(edits.otherEnabled(form, checked === true))}
        />
        <label htmlFor={checkboxId} className="text-sm">
          Allow a freeform “Other” option
        </label>
      </div>
    </fieldset>
  );
}
