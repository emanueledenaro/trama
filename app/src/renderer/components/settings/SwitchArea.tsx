import { Toggle } from "@/components/ui/toggle";

/**
 * A switch with a click area of 32 px (the switch itself is 18 px tall). A click on the area around the switch
 * flips it, as a click on the switch does; the switch keeps its own name and role for assistive technology.
 */
export function SwitchArea({ checked, onChange, label }: { checked: boolean; onChange: (value: boolean) => void; label: string }) {
  return (
    <span
      className="flex h-8 min-w-8 cursor-pointer items-center justify-center"
      data-testid="switch-area"
      onClick={(event) => {
        if (event.target === event.currentTarget) onChange(!checked);
      }}
    >
      <Toggle checked={checked} onChange={onChange} label={label} />
    </span>
  );
}
