import { describe, expect, it } from 'vitest';
import { distroIcon, distroIcons } from '../distroIcons';

describe('distroIcon', () => {
  // Strings as real servers report them in /etc/os-release PRETTY_NAME.
  it.each([
    ['Ubuntu 24.04 LTS', 'Ubuntu'],
    ['Debian GNU/Linux 12 (bookworm)', 'Debian'],
    ['CentOS Linux 7 (Core)', 'CentOS'],
    ['Alpine Linux v3.19', 'Alpine Linux'],
    ['Arch Linux', 'Arch Linux'],
    ['Rocky Linux 9.3', 'Rocky Linux'],
    ['AlmaLinux 9.4', 'AlmaLinux'],
    ['openSUSE Leap 15.5', 'openSUSE'],
    ['SLES 15', 'openSUSE'],
    ['Fedora Linux 40', 'Fedora'],
  ])('matches %s', (reported, expected) => {
    expect(distroIcon(reported).title).toBe(expected);
  });

  // These three are why the matcher is ordered rather than a plain lookup: each contains
  // the name of a different distribution.
  it('prefers the more specific name when two could match', () => {
    expect(distroIcon('Linux Mint 21.3').title).toBe('Linux Mint');
    expect(distroIcon('Kali GNU/Linux Rolling').title).toBe('Kali Linux');
    expect(distroIcon('Raspbian GNU/Linux 11').title).toBe('Raspberry Pi');
  });

  it('matches Red Hat across its spellings', () => {
    for (const name of ['Red Hat Enterprise Linux 9.3', 'RedHat', 'RHEL 8']) {
      expect(distroIcon(name).title).toBe('Red Hat');
    }
  });

  it('falls back to the penguin for anything unrecognised', () => {
    for (const name of ['FreeBSD 14', 'Something Unknown', '', undefined]) {
      expect(distroIcon(name).title).toBe('Linux');
    }
  });

  it('gives every icon a path and a dark-surface colour', () => {
    for (const [slug, icon] of Object.entries(distroIcons)) {
      expect(icon.path.length, slug).toBeGreaterThan(0);
      expect(icon.hex, slug).toMatch(/^#[0-9a-fA-F]{6}$/);
      expect(icon.hexDark, slug).toMatch(/^#[0-9a-fA-F]{6}$/);
    }
  });
});
