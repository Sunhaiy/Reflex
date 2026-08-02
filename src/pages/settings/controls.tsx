import { cn } from '../../lib/utils';

/** The small building blocks every settings tab is assembled from. */
export function ToggleSwitch({ checked, onChange }: { checked: boolean; onChange: (value: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative h-6 w-11 shrink-0 rounded-full border transition-colors',
        checked ? 'border-primary/50 bg-primary' : 'border-border bg-foreground/10',
      )}
    >
      <span className={cn(
        'absolute left-0.5 top-0.5 h-[18px] w-[18px] rounded-full bg-primary-foreground transition-transform',
        checked ? 'translate-x-5' : 'translate-x-0',
      )} />
    </button>
  );
}

export function SettingsCard({ title, description, children }: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="glass-panel overflow-visible rounded-2xl">
      <div className="border-b border-border/55 px-4 py-3.5">
        <h3 className="text-sm font-semibold tracking-tight">{title}</h3>
        {description && <p className="mt-0.5 text-[11px] leading-4 text-muted-foreground">{description}</p>}
      </div>
      <div className="space-y-4 p-4">{children}</div>
    </section>
  );
}

export function FieldLabel({ title, description }: { title: string; description?: string }) {
  return (
    <div>
      <div className="text-sm font-medium">{title}</div>
      {description && <div className="mt-1 text-xs leading-5 text-muted-foreground">{description}</div>}
    </div>
  );
}
