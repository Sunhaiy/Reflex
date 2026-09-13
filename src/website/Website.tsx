import { useEffect, useState } from 'react';
import { Download01Icon, GithubIcon } from '@hugeicons/core-free-icons';
import { HugeiconsIcon } from '@hugeicons/react';
import { Button } from '../components/ui/button';
import { ShaderBackground } from '../components/ui/shadow-blending';

const LATEST_RELEASE_URL = 'https://github.com/Sunhaiy/Reflex/releases/latest';
const LATEST_RELEASE_API_URL = 'https://api.github.com/repos/Sunhaiy/Reflex/releases/latest';
const GITHUB_URL = 'https://github.com/Sunhaiy/Reflex';
const BASE_URL = import.meta.env.BASE_URL;

type OperatingSystem = 'windows' | 'macos' | 'linux';
type CpuArchitecture = 'x64' | 'arm64';

type InstallerTarget = {
  operatingSystem: OperatingSystem;
  architecture: CpuArchitecture;
};

type GitHubRelease = {
  assets?: Array<{
    name?: string;
    browser_download_url?: string;
  }>;
};

type NavigatorUserAgentData = {
  platform?: string;
  getHighEntropyValues?: (hints: string[]) => Promise<{
    architecture?: string;
    bitness?: string;
    platform?: string;
  }>;
};

type ShowcaseMedia = {
  src: string;
  alt: string;
  durationMs: number;
};

const SHOWCASE_MEDIA: ShowcaseMedia[] = [
  {
    src: `${BASE_URL}reflex-demo.gif`,
    alt: 'Reflex connecting to a server and opening its SSH workspace',
    durationMs: 9070,
  },
  {
    src: `${BASE_URL}reflex-showcase/agent.gif`,
    alt: 'The Reflex agent running visible server operations',
    durationMs: 22190,
  },
  {
    src: `${BASE_URL}reflex-showcase/workspace-real.png`,
    alt: 'The complete Reflex SSH workspace',
    durationMs: 4500,
  },
  {
    src: `${BASE_URL}reflex-showcase/docker.png`,
    alt: 'Docker management inside Reflex',
    durationMs: 4500,
  },
  {
    src: `${BASE_URL}reflex-showcase/appearance-settings.png`,
    alt: 'Reflex appearance and theme settings',
    durationMs: 4500,
  },
];

function navigateTo(url: string) {
  window.location.assign(url);
}

function detectOperatingSystem(platform: string, userAgent: string): OperatingSystem | null {
  const fingerprint = `${platform} ${userAgent}`.toLowerCase();

  if (/iphone|ipad|ipod/.test(fingerprint)) return null;
  if (/windows|win32|win64/.test(fingerprint)) return 'windows';
  if (/macos|macintosh|macintel/.test(fingerprint)) return 'macos';
  if (/linux|x11/.test(fingerprint)) return 'linux';

  return null;
}

function detectAppleSilicon(): boolean {
  try {
    const canvas = document.createElement('canvas');
    const context = canvas.getContext('webgl');
    const rendererInfo = context?.getExtension('WEBGL_debug_renderer_info');
    const renderer = context && rendererInfo
      ? String(context.getParameter(rendererInfo.UNMASKED_RENDERER_WEBGL))
      : '';

    return /\bApple (?:M\d|GPU)\b/i.test(renderer);
  } catch {
    return false;
  }
}

function detectArchitecture(
  architecture: string,
  bitness: string,
  fallbackFingerprint: string,
  operatingSystem: OperatingSystem,
): CpuArchitecture | null {
  const highEntropyArchitecture = `${architecture} ${bitness}`.toLowerCase();

  if (/arm|aarch64/.test(highEntropyArchitecture)) return 'arm64';
  if (/(x86|x64|amd64)/.test(highEntropyArchitecture) && bitness === '64') return 'x64';

  if (/arm64|aarch64/.test(fallbackFingerprint)) return 'arm64';
  if (operatingSystem === 'macos' && detectAppleSilicon()) return 'arm64';
  if (/x86_64|x64|win64|wow64|amd64|macintel|intel mac/.test(fallbackFingerprint)) {
    return 'x64';
  }

  return null;
}

async function detectInstallerTarget(): Promise<InstallerTarget | null> {
  const userAgentData = (navigator as Navigator & {
    userAgentData?: NavigatorUserAgentData;
  }).userAgentData;
  let highEntropyValues: Awaited<ReturnType<NonNullable<NavigatorUserAgentData['getHighEntropyValues']>>> = {};

  try {
    highEntropyValues = await userAgentData?.getHighEntropyValues?.([
      'architecture',
      'bitness',
      'platform',
    ]) ?? {};
  } catch {
    // Browser privacy settings may block high-entropy client hints.
  }

  const platform = highEntropyValues.platform
    ?? userAgentData?.platform
    ?? navigator.platform
    ?? '';
  const operatingSystem = detectOperatingSystem(platform, navigator.userAgent);
  if (!operatingSystem) return null;

  const architecture = detectArchitecture(
    highEntropyValues.architecture ?? '',
    highEntropyValues.bitness ?? '',
    `${navigator.platform} ${navigator.userAgent}`.toLowerCase(),
    operatingSystem,
  );

  return architecture ? { operatingSystem, architecture } : null;
}

function findInstallerUrl(release: GitHubRelease, target: InstallerTarget): string | null {
  const suffixes: Record<OperatingSystem, Record<CpuArchitecture, string>> = {
    windows: {
      x64: '-win-x64.exe',
      arm64: '-win-arm64.exe',
    },
    macos: {
      x64: '-mac-x64.dmg',
      arm64: '-mac-arm64.dmg',
    },
    linux: {
      x64: '-linux-x86_64.appimage',
      arm64: '-linux-arm64.appimage',
    },
  };
  const suffix = suffixes[target.operatingSystem][target.architecture];
  const installer = release.assets?.find((asset) => (
    asset.name?.toLowerCase().endsWith(suffix)
    && typeof asset.browser_download_url === 'string'
  ));

  return installer?.browser_download_url ?? null;
}

export function ReflexWebsite() {
  const [currentMedia, setCurrentMedia] = useState(0);
  const [firstMediaLoaded, setFirstMediaLoaded] = useState(false);
  const [firstPlaybackFinished, setFirstPlaybackFinished] = useState(false);
  const [remainingMediaReady, setRemainingMediaReady] = useState(false);
  const [carouselStarted, setCarouselStarted] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const [reducedMotion] = useState(() => (
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  ));

  useEffect(() => {
    if (!firstMediaLoaded) return undefined;

    let cancelled = false;
    const playbackTimer = window.setTimeout(
      () => setFirstPlaybackFinished(true),
      SHOWCASE_MEDIA[0].durationMs,
    );

    const preloaders = SHOWCASE_MEDIA.slice(1).map((media) => new Promise<void>((resolve) => {
      const image = new Image();
      image.onload = () => resolve();
      image.onerror = () => resolve();
      image.src = media.src;
    }));

    void Promise.all(preloaders).then(() => {
      if (!cancelled) setRemainingMediaReady(true);
    });

    return () => {
      cancelled = true;
      window.clearTimeout(playbackTimer);
    };
  }, [firstMediaLoaded]);

  useEffect(() => {
    if (
      reducedMotion ||
      carouselStarted ||
      !firstPlaybackFinished ||
      !remainingMediaReady
    ) return;

    setCurrentMedia(1);
    setCarouselStarted(true);
  }, [carouselStarted, firstPlaybackFinished, reducedMotion, remainingMediaReady]);

  useEffect(() => {
    if (!carouselStarted) return undefined;

    const timer = window.setTimeout(() => {
      setCurrentMedia((current) => (current + 1) % SHOWCASE_MEDIA.length);
    }, SHOWCASE_MEDIA[currentMedia].durationMs);

    return () => window.clearTimeout(timer);
  }, [carouselStarted, currentMedia]);

  const activeMedia = SHOWCASE_MEDIA[currentMedia];

  async function downloadLatestInstaller() {
    if (downloading) return;
    setDownloading(true);

    try {
      const target = await detectInstallerTarget();
      if (!target) {
        navigateTo(LATEST_RELEASE_URL);
        return;
      }

      const response = await fetch(LATEST_RELEASE_API_URL, {
        headers: { Accept: 'application/vnd.github+json' },
      });
      if (!response.ok) throw new Error(`GitHub API returned ${response.status}`);

      const installerUrl = findInstallerUrl(await response.json() as GitHubRelease, target);
      if (!installerUrl) throw new Error('No compatible installer was found in the latest release');

      navigateTo(installerUrl);
    } catch (error) {
      console.warn('Unable to resolve the latest Reflex installer', error);
      navigateTo(LATEST_RELEASE_URL);
    } finally {
      setDownloading(false);
    }
  }

  return (
    <div className="website-shell">
      <div className="website-background" aria-hidden="true">
        <div className="cover-fallback absolute inset-0" />
        <ShaderBackground className="absolute inset-0 size-full" />
        <div className="website-vignette absolute inset-0" />
      </div>

      <header className="website-topbar" aria-label="Product information">
        <div className="website-meta-group">
          <span className="website-status-dot" aria-hidden="true" />
          <span>Open source SSH client</span>
        </div>
        <div className="website-platforms" aria-label="Supported platforms">
          <span>Windows</span>
          <span>macOS</span>
          <span>Linux</span>
        </div>
      </header>

      <main className="website-hero" aria-labelledby="website-title">
        <div className="website-copy">
          <div className="website-copy-inner">
            <h1 id="website-title">Reflex</h1>
            <p>
              A modern SSH operations workspace for terminals, files, Docker,
              monitoring, and agent-native workflows.
            </p>

            <div className="website-actions" aria-label="Get Reflex">
              <Button
                className="website-action website-action-primary beam-line"
                size="lg"
                type="button"
                disabled={downloading}
                aria-busy={downloading}
                onClick={() => void downloadLatestInstaller()}
              >
                <span className="website-action-label">
                  <HugeiconsIcon icon={Download01Icon} data-icon="inline-start" />
                  Download
                </span>
              </Button>
              <Button
                className="website-action website-action-secondary"
                variant="outline"
                size="lg"
                type="button"
                onClick={() => navigateTo(GITHUB_URL)}
              >
                <span className="website-action-label">
                  <HugeiconsIcon icon={GithubIcon} data-icon="inline-start" />
                  GitHub Star
                </span>
              </Button>
            </div>
          </div>
        </div>

        <figure className="website-demo">
          <div className="website-demo-frame">
            <img
              key={activeMedia.src}
              className="website-demo-media"
              src={activeMedia.src}
              alt={activeMedia.alt}
              width="2340"
              height="1337"
              decoding="async"
              onLoad={currentMedia === 0 ? () => setFirstMediaLoaded(true) : undefined}
            />
          </div>
          <figcaption className="website-demo-caption">
            <span className="website-demo-quote">
              Great software is the sum of every thoughtfully designed detail.
            </span>
            <span className="website-demo-count" aria-label={`Slide ${currentMedia + 1} of ${SHOWCASE_MEDIA.length}`}>
              {String(currentMedia + 1).padStart(2, '0')} / {String(SHOWCASE_MEDIA.length).padStart(2, '0')}
            </span>
          </figcaption>
        </figure>
      </main>

      <footer className="website-footer">
        <span>Terminal · Files · Docker · Agent</span>
        <span>Local-first / v1.0.24</span>
      </footer>
    </div>
  );
}
