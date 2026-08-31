import { criterionDescription } from "@prompt-playground/shared";

export function CriterionName({ name }: { name: string }) {
  const description = criterionDescription(name);
  if (!description) return <>{name}</>;
  return (
    <span className="criterion-name">
      {name}
      <span
        className="criterion-info"
        title={description}
        tabIndex={0}
        aria-label={`${name}: ${description}`}
      >
        ⓘ
      </span>
    </span>
  );
}
