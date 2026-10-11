import type { I18n } from "@lingui/core";
import { t } from "@lingui/core/macro";
import type { FollowState } from "./follow";

export function followStatus(i18n: I18n, state: FollowState): string {
  switch (state) {
    case "following":
      return t(i18n)`Following`;
    case "lookingAround":
      return t(i18n)`Looking around`;
    case "waiting":
      return t(i18n)`Waiting for signal…`;
    case "lost":
      return t(i18n)`Live position lost; showing schedule`;
  }
}
