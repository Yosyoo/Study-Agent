import type { StudyAPI } from "../../shared/contracts";

declare global {
  interface Window {
    study?: StudyAPI;
  }
}
