/**
 * Optional add-ons an instance may or may not have configured. The backend
 * reports them at GET /features; `useFeatures` reads it.
 */
export interface Features {
  lineBot: boolean;
}
