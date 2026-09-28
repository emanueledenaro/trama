// The English texts of the main process (issue #301): the same keys and placeholders as `main.it.ts`, in plain English.
import type { mainIt } from "./main.it";
import { mainControllerAEn } from "./main.controllerA.en";
import { mainControllerBEn } from "./main.controllerB.en";
import { mainDutiesEn } from "./main.duties.en";
import { mainProvidersEn } from "./main.providers.en";
import { mainQualityEn } from "./main.quality.en";
import { mainCoordinatorEn } from "./main.coordinator.en";
import { mainPlanningEn } from "./main.planning.en";
import { mainRepositoryEn } from "./main.repository.en";

export const mainEn: Record<keyof typeof mainIt, string> = {
  ...mainControllerAEn,
  ...mainControllerBEn,
  ...mainDutiesEn,
  ...mainProvidersEn,
  ...mainQualityEn,
  ...mainCoordinatorEn,
  ...mainPlanningEn,
  ...mainRepositoryEn,
};
