import type { Option } from "@qp/shared";
import { Input } from "@qp/ui/primitives/input";

export function OtherTextInput({
  option,
  value,
  readOnly,
  onChange,
}: {
  option: Option;
  value: string;
  readOnly: boolean;
  onChange: (text: string) => void;
}) {
  return (
    <Input
      className="max-w-xs focus:placeholder:text-transparent"
      placeholder={option.label}
      aria-label={`${option.label}, please specify`}
      value={value}
      readOnly={readOnly}
      onChange={(event) => {
        if (!readOnly) onChange(event.target.value);
      }}
    />
  );
}
