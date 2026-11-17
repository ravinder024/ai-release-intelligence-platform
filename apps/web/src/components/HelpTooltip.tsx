import { useId } from "react";

type HelpTooltipProps = {
  label: string;
  children: string;
};

export function HelpTooltip({ label, children }: HelpTooltipProps) {
  const tooltipId = useId();
  return (
    <span className="help-tip">
      <button type="button" className="help-icon" aria-label={label} aria-describedby={tooltipId}>?</button>
      <span className="help-tooltip" id={tooltipId} role="tooltip">{children}</span>
    </span>
  );
}
