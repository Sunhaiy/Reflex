import { distroIcon } from '../shared/distroIcons';
import { useThemeStore } from '../store/themeStore';

interface DistroLogoProps {
  /** The distro string as reported by the server, e.g. "Ubuntu 24.04 LTS". */
  distro: string | undefined;
  className?: string;
}

/**
 * The brand mark of whatever the server actually runs. Falls back to the Linux penguin
 * for anything unrecognised, so there is always a glyph in the slot.
 */
export function DistroLogo({ distro, className }: DistroLogoProps) {
  const appearance = useThemeStore((state) => state.resolvedAppearance);
  const icon = distroIcon(distro);

  return (
    <svg
      role="img"
      viewBox="0 0 24 24"
      className={className}
      fill={appearance === 'dark' ? icon.hexDark : icon.hex}
      aria-label={icon.title}
    >
      <path d={icon.path} />
    </svg>
  );
}
