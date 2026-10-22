import type { ModelConfig } from "../../shared/contracts";
import deepseek from "./assets/providers/deepseek-color.svg";
import kimi from "./assets/providers/kimi-color.svg";
import glm from "./assets/providers/zhipu-color.svg";
import openai from "./assets/providers/openai.svg";
import claude from "./assets/providers/claude-color.svg";
import gemini from "./assets/providers/gemini-color.svg";
import { Plus } from "lucide-react";

const providerIcons = { deepseek, kimi, glm, openai, claude, gemini };

export function ProviderIcon({
  provider,
}: {
  provider: ModelConfig["provider"];
}) {
  return (
    <span className={`provider-icon provider-${provider}`} aria-hidden="true">
      {provider === "custom" ? (
        <Plus size={22} />
      ) : (
        <img src={providerIcons[provider]} alt="" />
      )}
    </span>
  );
}

export function StudyMark() {
  return (
    <svg
      width="32"
      height="32"
      viewBox="0 0 32 32"
      fill="none"
      aria-hidden="true"
    >
      <rect x="1" y="1" width="30" height="30" rx="9" fill="#4964D8" />
      <path
        d="M8 9.5h5a4 4 0 0 1 3 1.4 4 4 0 0 1 3-1.4h5v13h-5a4 4 0 0 0-3 1.4 4 4 0 0 0-3-1.4H8v-13Z"
        stroke="white"
        strokeWidth="1.6"
        strokeLinejoin="round"
      />
      <path
        d="M16 11v12M11 14h2M19 14h2M11 17.5h2M19 17.5h2"
        stroke="white"
        strokeWidth="1.4"
        strokeLinecap="round"
      />
    </svg>
  );
}

/** An empty-state illustration, never presented as a captured learning page. */
export function StudyIllustration() {
  return (
    <svg
      className="study-illustration"
      width="264"
      height="174"
      viewBox="0 0 264 174"
      fill="none"
      aria-hidden="true"
    >
      <ellipse cx="132" cy="156" rx="87" ry="8" fill="#E8ECF5" />
      <path
        d="m44 26 80-8 14 127-80 8L44 26Z"
        fill="#E4EAFE"
        stroke="#CFD8F7"
      />
      <rect
        x="66"
        y="12"
        width="140"
        height="140"
        rx="9"
        fill="white"
        stroke="#D9DFEC"
        strokeWidth="1.5"
      />
      <path
        d="M66 22a10 10 0 0 1 10-10h120a10 10 0 0 1 10 10v18H66V22Z"
        fill="#F5F7FC"
      />
      <path d="M66 40h140" stroke="#E3E7F0" />
      <circle cx="79" cy="26" r="2.5" fill="#B9C5DE" />
      <circle cx="88" cy="26" r="2.5" fill="#CFD7E7" />
      <circle cx="97" cy="26" r="2.5" fill="#CFD7E7" />
      <path d="M171 12h15v48l-7.5-5-7.5 5V12Z" fill="#4964D8" />
      <rect x="83" y="59" width="62" height="6" rx="3" fill="#A7B7DF" />
      <rect x="83" y="76" width="97" height="4" rx="2" fill="#E1E6F1" />
      <rect x="83" y="87" width="81" height="4" rx="2" fill="#E1E6F1" />
      <rect x="83" y="107" width="43" height="27" rx="5" fill="#EEF2FF" />
      <path d="m101 115 9 5.5-9 5.5v-11Z" fill="#4964D8" />
      <path
        d="M137 115h34M137 125h23"
        stroke="#D0D8E9"
        strokeWidth="4"
        strokeLinecap="round"
      />
      <rect
        x="190"
        y="108"
        width="37"
        height="37"
        rx="12"
        fill="#4964D8"
        stroke="white"
        strokeWidth="3"
      />
      <path
        d="m201 126 5 5 10-11"
        stroke="white"
        strokeWidth="2.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
