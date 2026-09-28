// The Italian texts of the main process (issue #301): errors, Activity rows, notices, status lines and recaps that the person
// sees. The keys start with `main.` and the module that writes the text. Text written for the model is not here.
import { mainControllerAIt } from "./main.controllerA.it";
import { mainControllerBIt } from "./main.controllerB.it";
import { mainDutiesIt } from "./main.duties.it";
import { mainProvidersIt } from "./main.providers.it";
import { mainQualityIt } from "./main.quality.it";
import { mainCoordinatorIt } from "./main.coordinator.it";
import { mainPlanningIt } from "./main.planning.it";
import { mainRepositoryIt } from "./main.repository.it";

export const mainIt = {
  ...mainControllerAIt,
  ...mainControllerBIt,
  ...mainDutiesIt,
  ...mainProvidersIt,
  ...mainQualityIt,
  ...mainCoordinatorIt,
  ...mainPlanningIt,
  ...mainRepositoryIt,
} satisfies Record<string, string>;
