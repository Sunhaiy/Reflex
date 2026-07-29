import { useThemeStore } from '../store/themeStore';

export function ThemeBackground() {
  const resolvedAppearance = useThemeStore((state) => state.resolvedAppearance);

  return (
    <div className="pointer-events-none fixed inset-0 z-0 overflow-hidden" aria-hidden="true">
      <div className="absolute inset-0 bg-background" />
      <div className="ambient-orb ambient-orb-primary" />
      <div className="ambient-orb ambient-orb-secondary" />
      <div className="ambient-orb ambient-orb-neutral" />
      <div className="absolute inset-0 opacity-[0.045] mix-blend-soft-light app-noise" />
      {resolvedAppearance === 'light' && (
        <div className="absolute inset-x-0 top-0 h-48 bg-gradient-to-b from-white/70 to-transparent" />
      )}
    </div>
  );
}
