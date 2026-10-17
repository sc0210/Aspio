// Must be a module (not ambient script) so declare module augmentations merge instead of replace
export {};

declare global {
  interface Window {
    gtag?: (...args: unknown[]) => void;
  }
  interface Navigator {
    msDoNotTrack?: string | null;
  }
}
